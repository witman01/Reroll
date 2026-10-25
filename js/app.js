(function () {
  const C = window.CONFIG;
  const Chain = window.Chain;
  const $ = (id) => document.getElementById(id);
  const ZERO = "0x0000000000000000000000000000000000000000";
  const UNIT = 10n ** BigInt(C.token.decimals);
  const TOKEN = C.token.address.toLowerCase();
  const POOL = C.pool.address.toLowerCase();
  const BURN = C.burnAddress.toLowerCase();

  const state = {
    price: null, // USD
    market: null, // DexScreener pair
    totalSupply: null, // BigInt, onchain
    balances: new Map(), // addr -> BigInt, rebuilt from Transfer logs
    synced: 0, // last block applied to balances
    head: 0,
    lastTick: 0,
    poolQuote: null, // USDC in pool, onchain
    verifiedAt: 0,
    reported: null, // Reroll API (offchain custody)
    ath: null, // { price, time } from hourly candles
    chainOk: false,
    feed: [],
    tf: "1d",
  };

  // ---------- formatting ----------
  const tokens = (raw) => Number(raw) / Number(UNIT);
  const pct = (part, whole) => (whole ? Number((part * 1000000n) / whole) / 10000 : 0);
  const fmtUsd = (n, d) => {
    if (n == null || !isFinite(n)) return "—";
    if (d == null) d = Math.abs(n) >= 1000 ? 0 : 2;
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const fmtCompactUsd = (n) =>
    n == null || !isFinite(n) ? "—" : "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
  const fmtCompact = (n) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
  const fmtNum = (n, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtPrice = (p) => {
    if (p == null || !isFinite(p)) return "—";
    const d = p >= 1 ? 4 : Math.min(10, 2 - Math.floor(Math.log10(p)) + 2);
    return "$" + p.toFixed(d);
  };
  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
  const ago = (ts) => {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const label = (a) => C.labels[a.toLowerCase()];
  const addrLink = (a) => {
    const l = label(a);
    const text = l ? `<span class="tag tag-${l.kind}">${esc(l.name)}</span>` : `<span class="mono">${short(a)}</span>`;
    return `<a href="${C.explorer}/address/${a}" target="_blank" rel="noopener" title="${a}">${text}</a>`;
  };
  const txLink = (h) => `<a class="mono" href="${C.explorer}/tx/${h}" target="_blank" rel="noopener">${h.slice(0, 8)}…</a>`;
  const changeHtml = (v) => {
    if (v == null || !isFinite(v)) return `<span class="chg">—</span>`;
    const cls = v > 0 ? "up" : v < 0 ? "down" : "";
    return `<span class="chg ${cls}">${v > 0 ? "▲" : v < 0 ? "▼" : ""} ${Math.abs(v).toFixed(2)}%</span>`;
  };

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.hidden = true), 1600);
  }

  async function getJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(url + " " + res.status);
    return res.json();
  }

  // ---------- static bits ----------
  function setupStatic() {
    const tok = $("token-addr");
    tok.textContent = C.token.address;
    tok.href = `${C.explorer}/token/${C.token.address}`;
    const pool = $("pool-addr");
    pool.textContent = C.pool.address;
    pool.href = `${C.explorer}/address/${C.pool.address}`;
    $("link-dex").href = C.dexscreener;

    document.querySelectorAll("[data-copy-target]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText($(b.dataset.copyTarget).textContent);
          toast("Address copied");
        } catch {
          toast("Copy failed");
        }
      })
    );

    $("tf").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-tf]");
      if (!btn) return;
      document.querySelectorAll("#tf button").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
      state.tf = btn.dataset.tf;
      loadChart();
    });
  }

  // ---------- market (DexScreener) ----------
  async function loadMarket() {
    try {
      const json = await getJson(C.api.dexscreener);
      const p = json.pair || (json.pairs && json.pairs[0]);
      if (!p) throw new Error("no pair");
      state.market = p;
      state.price = parseFloat(p.priceUsd);
      renderMarket();
    } catch (err) {
      console.warn("market", err);
    }
  }

  function renderMarket() {
    const p = state.market;
    if (!p) return;
    $("price").textContent = fmtPrice(state.price);
    $("chg24").outerHTML = changeHtml(p.priceChange?.h24).replace('class="chg', 'id="chg24" class="chg');
    $("chg-strip").innerHTML = [
      ["5m", p.priceChange?.m5],
      ["1h", p.priceChange?.h1],
      ["6h", p.priceChange?.h6],
      ["24h", p.priceChange?.h24],
    ]
      .map(([k, v]) => `<span class="chip"><span class="muted">${k}</span>${changeHtml(v)}</span>`)
      .join("");
    document.title = `${fmtPrice(state.price)} · REROLL Onchain Dashboard`;

    $("k-vol").textContent = fmtCompactUsd(p.volume?.h24);
    const t = p.txns?.h24 || {};
    $("k-vol-h").textContent = `${fmtNum((t.buys || 0) + (t.sells || 0))} trades · ${t.buys || 0} buys / ${t.sells || 0} sells`;

    renderPressure();
    renderValuation();
  }

  // Market cap, FDV and liquidity combine the DEX price with onchain amounts.
  function renderValuation() {
    const price = state.price;
    if (price == null) return;
    if (state.totalSupply != null) $("k-fdv").textContent = fmtCompactUsd(tokens(state.totalSupply) * price);

    if (state.reported?.circulating) {
      $("k-mcap").textContent = fmtCompactUsd(state.reported.circulating * price);
      $("k-mcap-h").textContent = "Price × circulating supply";
      setSrc("k-mcap-src", "reroll", "Reroll");
    } else if (state.market?.marketCap) {
      $("k-mcap").textContent = fmtCompactUsd(state.market.marketCap);
      $("k-mcap-h").textContent = "As listed on DexScreener";
      setSrc("k-mcap-src", "dex", "DEX");
    }
    if (state.reported?.staked) $("k-staked-h").textContent = `${((state.reported.staked / state.reported.circulating) * 100).toFixed(2)}% of circulating · ${fmtCompactUsd(state.reported.staked * price)}`;
    if (state.ath) renderAth();

    const poolTokens = state.balances.get(POOL);
    if (poolTokens != null && state.poolQuote != null) {
      const quote = Number(state.poolQuote) / 10 ** C.pool.quote.decimals;
      const base = tokens(poolTokens);
      $("k-liq").textContent = fmtCompactUsd(quote + base * price);
      $("k-liq-h").textContent = `${fmtCompact(base)} REROLL + ${fmtCompact(quote)} USDC (onchain)`;
    } else if (state.market?.liquidity) {
      $("k-liq").textContent = fmtCompactUsd(state.market.liquidity.usd);
      $("k-liq-h").textContent = "DexScreener";
    }

    const burned = state.balances.get(BURN);
    if (burned != null && state.totalSupply) {
      $("k-burn-h").textContent = `${pct(burned, state.totalSupply).toFixed(2)}% of supply · ${fmtCompactUsd(tokens(burned) * price)}`;
    }
  }

  function setSrc(id, kind, text) {
    const el = $(id);
    el.className = "src src-" + kind;
    el.textContent = text;
  }

  // ---------- all-time high (GeckoTerminal hourly candles since launch) ----------
  async function loadAth() {
    try {
      const json = await getJson(`${C.api.gecko}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`);
      const list = json.data?.attributes?.ohlcv_list || [];
      if (!list.length) return;
      const top = list.reduce((m, c) => (c[2] > m[2] ? c : m));
      state.ath = { price: top[2], time: top[0] * 1000 };
      renderAth();
    } catch (err) {
      console.warn("ath", err);
    }
  }

  function renderAth() {
    let { price: ath, time } = state.ath;
    // A new high may not be in a closed candle yet.
    if (state.price > ath) {
      ath = state.price;
      time = Date.now();
    }
    $("k-ath").textContent = fmtPrice(ath);
    const from = state.price ? ((state.price - ath) / ath) * 100 : null;
    const date = new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    $("k-ath-h").innerHTML = from == null ? date : from > -0.005 ? `At all-time high now` : `${changeHtml(from)} from ATH · ${date}`;
  }

  function renderPressure() {
    const p = state.market;
    const rows = [
      ["5m", p.txns?.m5, p.volume?.m5],
      ["1h", p.txns?.h1, p.volume?.h1],
      ["6h", p.txns?.h6, p.volume?.h6],
      ["24h", p.txns?.h24, p.volume?.h24],
    ];
    $("pressure").innerHTML = rows
      .map(([k, t = {}, vol]) => {
        const b = t.buys || 0;
        const s = t.sells || 0;
        const tot = b + s;
        const bp = tot ? (b / tot) * 100 : 50;
        return `<div class="pr-row">
          <div class="pr-top">
            <span class="pr-k">${k}</span>
            <span class="pr-n"><b class="up">${b}</b> buys · <b class="down">${s}</b> sells</span>
            <span class="pr-v">${fmtCompactUsd(vol || 0)} <span class="muted">vol</span></span>
          </div>
          <div class="pr-bar" role="img" aria-label="${b} buys, ${s} sells">
            ${tot ? `<span class="pr-buy" style="width:${bp}%"></span><span class="pr-sell" style="width:${100 - bp}%"></span>` : `<span class="pr-none"></span>`}
          </div>
        </div>`;
      })
      .join("");
  }

  // ---------- price chart (GeckoTerminal OHLCV) ----------
  let chart, series;
  const TF = {
    "1h": { path: "minute", aggregate: 1, limit: 1000, span: 3600, label: "1 hour · 1m candles" },
    "1d": { path: "minute", aggregate: 15, limit: 1000, span: 86400, label: "24 hours · 15m candles" },
    "7d": { path: "hour", aggregate: 1, limit: 1000, span: 7 * 86400, label: "7 days · 1h candles" },
    all: { path: "hour", aggregate: 1, limit: 1000, span: Infinity, label: "Since launch · 1h candles" },
  };

  function setupChart() {
    if (!window.LightweightCharts) return;
    const el = $("chart");
    chart = LightweightCharts.createChart(el, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#a0acc7", fontFamily: "Inter, system-ui, sans-serif", fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(160,172,199,0.08)" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Magnet,
        vertLine: { color: "rgba(160,172,199,0.35)", labelBackgroundColor: "#262c3e" },
        horzLine: { color: "rgba(160,172,199,0.35)", labelBackgroundColor: "#262c3e" },
      },
      handleScroll: false,
      handleScale: false,
    });
    series = chart.addAreaSeries({
      lineColor: "#4aeea0",
      lineWidth: 2,
      topColor: "rgba(74,238,160,0.28)",
      bottomColor: "rgba(74,238,160,0.0)",
      priceLineVisible: false,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: "#16161b",
      priceFormat: { type: "custom", minMove: 1e-9, formatter: (v) => fmtPrice(v) },
    });
  }

  async function loadChart() {
    if (!series) return;
    const tf = TF[state.tf];
    try {
      const json = await getJson(`${C.api.gecko}/ohlcv/${tf.path}?aggregate=${tf.aggregate}&limit=${tf.limit}&currency=usd&token=base`);
      const all = (json.data?.attributes?.ohlcv_list || []).slice().sort((a, b) => a[0] - b[0]);
      // Candles only exist for intervals with trades, so clip to the window, start it at the
      // previous close, and extend the latest price to now.
      const now = Math.floor(Date.now() / 1000);
      const start = now - tf.span;
      const list = all.filter((c) => c[0] >= start);
      const before = all.filter((c) => c[0] < start).pop();
      const data = list.map((c) => ({ time: c[0], value: c[4] }));
      if (before && isFinite(start)) data.unshift({ time: start, value: before[4] });
      if (data.length && state.price && now > data[data.length - 1].time) data.push({ time: now, value: state.price });
      $("chart-empty").hidden = data.length > 0;
      series.setData(data);
      chart.timeScale().fitContent();
      if (data.length) {
        const first = before && isFinite(start) ? before[4] : list[0][1];
        const last = data[data.length - 1].value;
        const hi = Math.max(last, first, ...list.map((c) => c[2]));
        const lo = Math.min(last, first, ...list.map((c) => c[3]));
        const ch = ((last - first) / first) * 100;
        $("chart-meta").innerHTML = `<span>${tf.label}</span><span>Change ${changeHtml(ch)}</span><span>High <b>${fmtPrice(hi)}</b></span><span>Low <b>${fmtPrice(lo)}</b></span>`;
      }
    } catch (err) {
      console.warn("chart", err);
    }
  }

  // ---------- trades (GeckoTerminal) ----------
  async function loadTrades() {
    try {
      const json = await getJson(`${C.api.gecko}/trades`);
      const rows = (json.data || []).slice(0, 25).map((d) => d.attributes);
      const tb = $("trades").querySelector("tbody");
      if (!rows.length) {
        tb.innerHTML = `<tr><td colspan="7" class="empty">No trades yet.</td></tr>`;
        return;
      }
      tb.innerHTML = rows
        .map((t) => {
          const buy = t.kind === "buy";
          const amount = parseFloat(buy ? t.to_token_amount : t.from_token_amount);
          const price = parseFloat(buy ? t.price_to_in_usd : t.price_from_in_usd);
          const ts = Date.parse(t.block_timestamp);
          return `<tr>
            <td class="muted" data-ts="${ts}">${ago(ts)}</td>
            <td><span class="pill ${buy ? "pill-buy" : "pill-sell"}">${buy ? "Buy" : "Sell"}</span></td>
            <td class="r mono">${fmtNum(amount)}</td>
            <td class="r mono">${fmtUsd(parseFloat(t.volume_in_usd), 2)}</td>
            <td class="r mono">${fmtPrice(price)}</td>
            <td>${addrLink(t.tx_from_address)}</td>
            <td class="r">${txLink(t.tx_hash)}</td>
          </tr>`;
        })
        .join("");
      $("trades-meta").textContent = `Last ${rows.length} swaps on ${C.pool.dex}`;
    } catch (err) {
      console.warn("trades", err);
    }
  }

  // ---------- onchain: holders & supply ----------
  function applyTransfers(list) {
    for (const t of list) {
      state.balances.set(t.from, (state.balances.get(t.from) ?? 0n) - t.value);
      state.balances.set(t.to, (state.balances.get(t.to) ?? 0n) + t.value);
    }
  }

  async function loadSnapshot() {
    try {
      const res = await fetch("data/snapshot.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      const snap = await res.json();
      if (snap.token.toLowerCase() !== TOKEN) throw new Error("snapshot is for another token");
      for (const [a, v] of Object.entries(snap.balances)) state.balances.set(a, BigInt(v));
      // Snapshot omits the zero address; restore its negative balance so sums stay exact.
      const sum = [...state.balances.values()].reduce((s, v) => s + v, 0n);
      state.balances.set(ZERO, -sum);
      state.synced = snap.block;
    } catch (err) {
      console.warn("snapshot unavailable, scanning from deploy block", err);
      state.synced = C.token.deployBlock - 1;
    }
  }

  async function initialSync() {
    await loadSnapshot();
    const head = await Chain.blockNumber();
    const from = state.synced + 1;
    if (head >= from) {
      const list = await Chain.scanTransfers(from, head, (done, total) => {
        $("k-holders-h").textContent = `Syncing onchain… ${Math.floor((done / total) * 100)}%`;
        setStatus(`Syncing ${fmtNum(total - done)} blocks…`, "sync");
      });
      applyTransfers(list);
    }
    state.synced = head;
    state.head = head;
    await verify();
    state.chainOk = true;
    renderHolders();
    renderSupply();
    renderValuation();
  }

  // Re-read the balances that matter straight from the contract, so displayed figures
  // never depend on the log reconstruction alone.
  async function verify() {
    const top = topHolders(50).map(([a]) => a);
    const addrs = [...new Set([...top, ...Object.keys(C.labels)])];
    const [supply, live, quoteRes] = await Promise.all([
      Chain.totalSupply(),
      Chain.balancesOf(addrs),
      Chain.rpc("eth_call", [{ to: C.pool.quote.address, data: "0x70a08231" + POOL.slice(2).padStart(64, "0") }, "latest"]),
    ]);
    state.totalSupply = supply;
    state.poolQuote = BigInt(quoteRes);
    let drift = 0;
    for (const [a, v] of live) {
      if ((state.balances.get(a) ?? 0n) !== v) drift++;
      state.balances.set(a, v);
    }
    if (drift) console.info(`verify: corrected ${drift} balance(s) from balanceOf`);
    state.verifiedAt = Date.now();
  }

  function topHolders(n) {
    return [...state.balances]
      .filter(([a, v]) => v > 0n && a !== ZERO)
      .sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0))
      .slice(0, n);
  }

  function holderCount() {
    let n = 0;
    for (const [a, v] of state.balances) if (v > 0n && a !== ZERO) n++;
    return n;
  }

  function renderHolders() {
    const total = state.totalSupply;
    if (!total) return;
    const list = topHolders(25);
    const max = list.length ? list[0][1] : 1n;
    $("holders").querySelector("tbody").innerHTML = list
      .map(([a, v], i) => {
        const share = pct(v, total);
        return `<tr>
          <td class="muted">${i + 1}</td>
          <td>${addrLink(a)}${label(a) ? ` <span class="mono muted small hide-sm">${short(a)}</span>` : ""}</td>
          <td class="r mono">${fmtNum(tokens(v))}</td>
          <td class="r mono">${share.toFixed(2)}%</td>
          <td class="share-col"><span class="share"><span style="width:${Math.max(1, pct(v, max))}%"></span></span></td>
        </tr>`;
      })
      .join("");
    // Concentration among public wallets only (treasury, platform, LP and burn excluded).
    const top10 = topHolders(Infinity)
      .filter(([a]) => !label(a))
      .slice(0, 10)
      .reduce((s, [, v]) => s + v, 0n);
    $("k-top10").textContent = pct(top10, total).toFixed(2) + "%";
    $("k-top10-h").textContent = `${fmtCompact(tokens(top10))} REROLL in the 10 largest public wallets`;

    const n = holderCount();
    $("k-holders").textContent = fmtNum(n);
    $("k-holders-h").textContent = "Wallets with a balance > 0";
    $("holders-meta").textContent = `Top 25 of ${fmtNum(n)} · verified with balanceOf ${ago(state.verifiedAt)}`;
  }

  const SEGMENTS = [
    { kind: "treasury", name: "Treasury (deployer)", color: "#a8892a" },
    { kind: "lp", name: "Project X LP", color: "#4f6fe0" },
    { kind: "platform", name: "Reroll platform", color: "#16a26a" },
    { kind: "public", name: "Public wallets", color: "#9a62e0" },
    { kind: "burn", name: "Burned", color: "#d14b3d" },
  ];

  function renderSupply() {
    const total = state.totalSupply;
    if (!total) return;
    const byKind = { treasury: 0n, lp: 0n, platform: 0n, burn: 0n };
    for (const [a, l] of Object.entries(C.labels)) byKind[l.kind] += state.balances.get(a) ?? 0n;
    byKind.public = total - byKind.treasury - byKind.lp - byKind.platform - byKind.burn;

    $("s-total").textContent = fmtNum(tokens(total)) + " REROLL";
    $("s-bar").innerHTML = SEGMENTS.map(
      (s) => `<span style="flex-grow:${Math.max(pct(byKind[s.kind], total), 0.4)};background:${s.color}" title="${s.name}: ${pct(byKind[s.kind], total).toFixed(2)}%"></span>`
    ).join("");
    $("s-legend").innerHTML = SEGMENTS.map((s) => {
      const v = byKind[s.kind];
      const usd = state.price ? fmtCompactUsd(tokens(v) * state.price) : "";
      return `<li>
        <span class="sw" style="background:${s.color}"></span>
        <span class="lg-name">${s.name}</span>
        <span class="lg-amt mono">${fmtCompact(tokens(v))}</span>
        <span class="lg-pct mono">${pct(v, total).toFixed(2)}%</span>
        <span class="lg-usd mono muted">${usd}</span>
      </li>`;
    }).join("");

    const burned = byKind.burn;
    $("k-burn").textContent = fmtCompact(tokens(burned));
  }

  // ---------- onchain: live tail ----------
  function classify(t) {
    const from = label(t.from);
    const to = label(t.to);
    if (t.from === ZERO) return ["Mint", "mint"];
    if (t.to === BURN) return ["Burn", "burn"];
    if (t.from === POOL) return ["Buy", "buy"];
    if (t.to === POOL) return ["Sell", "sell"];
    if (to?.kind === "platform") return ["Deposit to Reroll", "dep"];
    if (from?.kind === "platform") return ["Withdrawal", "wd"];
    return ["Transfer", "xfer"];
  }

  async function tick() {
    try {
      const head = await Chain.blockNumber();
      state.head = head;
      if (head > state.synced) {
        const to = Math.min(head, state.synced + C.logRange);
        const list = await Chain.transfers(state.synced + 1, to);
        applyTransfers(list);
        state.synced = to;
        if (list.length) {
          const times = await Chain.blockTimes(list.map((t) => t.block));
          for (const t of list) state.feed.unshift({ ...t, ts: times.get(t.block) });
          state.feed = state.feed.slice(0, 40);
          renderFeed();
          renderHolders();
          renderSupply();
          renderValuation();
        }
      }
      if (Date.now() - state.verifiedAt > C.refresh.verify) {
        await verify();
        renderHolders();
        renderSupply();
        renderValuation();
      }
      state.lastTick = Date.now();
      state.chainOk = true;
    } catch (err) {
      console.warn("tick", err);
      state.chainOk = false;
    }
    renderStatus();
  }

  async function seedFeed() {
    // Show the most recent transfers right away instead of an empty feed.
    try {
      let to = state.synced;
      let found = [];
      for (let i = 0; i < 24 && found.length < 12; i++) {
        const from = Math.max(C.token.deployBlock, to - C.logRange + 1);
        found = (await Chain.transfers(from, to)).concat(found);
        to = from - 1;
        if (to < C.token.deployBlock) break;
      }
      found.sort((a, b) => b.block - a.block || b.index - a.index);
      found = found.slice(0, 15);
      const times = await Chain.blockTimes(found.map((t) => t.block));
      state.feed = found.map((t) => ({ ...t, ts: times.get(t.block) }));
      renderFeed();
    } catch (err) {
      console.warn("seed feed", err);
    }
  }

  function renderFeed() {
    if (!state.feed.length) return;
    $("feed").innerHTML = state.feed
      .map((t) => {
        const [name, cls] = classify(t);
        const amt = tokens(t.value);
        const usd = state.price ? fmtUsd(amt * state.price, 2) : "";
        return `<div class="feed-row">
          <span class="pill pill-${cls}">${name}</span>
          <span class="feed-amt mono">${fmtNum(amt)} <span class="muted">REROLL</span><span class="feed-usd muted">${usd}</span></span>
          <span class="feed-path">${addrLink(t.from)}<span class="arrow">→</span>${addrLink(t.to)}</span>
          <span class="feed-time muted" data-ts="${t.ts}">${ago(t.ts)}</span>
          <span class="feed-tx">${txLink(t.tx)}</span>
        </div>`;
      })
      .join("");
  }

  // ---------- Reroll-reported figures (optional proxy) ----------
  async function loadReported() {
    try {
      const json = await getJson(C.api.rerollSupply);
      const d = json.data || json;
      if (typeof d.circulating !== "number") throw new Error("bad shape");
      state.reported = d;
      $("k-circ").textContent = fmtCompact(d.circulating);
      $("k-circ-h").textContent = `${((d.circulating / d.totalSupply) * 100).toFixed(2)}% of total supply`;
      $("k-staked").textContent = fmtCompact(d.staked);
      renderValuation();
    } catch {
      if (!state.reported) {
        $("k-circ-h").textContent = "Unavailable — needs the /api/reroll-supply proxy";
        $("k-staked-h").textContent = "Unavailable — needs the /api/reroll-supply proxy";
      }
    }
  }

  // ---------- status ----------
  function setStatus(text, mode) {
    $("status-text").innerHTML = esc(text).replace(/^Live · /, '<span class="hide-xs">Live · </span>');
    $("status-dot").className = "dot" + (mode ? " dot-" + mode : "");
  }

  function renderStatus() {
    if (!state.lastTick) return;
    if (!state.chainOk || Date.now() - state.lastTick > 30000) {
      setStatus("Reconnecting to HyperEVM…", "err");
    } else {
      setStatus(`Live · Block ${fmtNum(state.head)}`, "");
    }
    $("foot-sync").textContent = `Synced to block ${fmtNum(state.synced)} · balances verified ${ago(state.verifiedAt)}`;
  }

  function refreshAges() {
    document.querySelectorAll("[data-ts]").forEach((el) => {
      const ts = Number(el.dataset.ts);
      if (ts) el.textContent = ago(ts);
    });
    renderStatus();
  }

  // ---------- boot ----------
  async function main() {
    setupStatic();
    setupChart();
    await loadMarket();
    loadChart();
    loadTrades();
    loadReported();
    loadAth();

    setInterval(loadAth, 300000);
    setInterval(loadMarket, C.refresh.market);
    setInterval(loadTrades, C.refresh.trades);
    setInterval(loadChart, 60000);
    setInterval(loadReported, 60000);
    setInterval(refreshAges, 1000);
    startChain();
  }

  async function startChain() {
    try {
      state.balances.clear();
      await initialSync();
      state.lastTick = Date.now();
      renderStatus();
      seedFeed();
      setInterval(tick, C.refresh.chain);
    } catch (err) {
      console.error(err);
      setStatus("Chain unavailable — retrying", "err");
      setTimeout(startChain, 10000);
    }
  }

  main();
})();
