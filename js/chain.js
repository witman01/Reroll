// Minimal HyperEVM client: JSON-RPC with rotation/retry, ERC-20 reads, Transfer log scanning.
(function () {
  const C = window.CONFIG;
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  let cursor = 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hex = (n) => "0x" + n.toString(16);
  const pad = (addr) => addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");

  async function post(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return res.json();
  }

  // Single call, retried across every RPC before giving up.
  async function rpc(method, params) {
    let last;
    for (let i = 0; i < C.rpcs.length * 2; i++) {
      const url = C.rpcs[cursor++ % C.rpcs.length];
      try {
        const json = await post(url, { jsonrpc: "2.0", id: 1, method, params });
        if (json.error) throw new Error(json.error.message);
        return json.result;
      } catch (err) {
        last = err;
        await sleep(300 * (i + 1));
      }
    }
    throw last;
  }

  // Batch of calls in one request; results returned in input order.
  async function batch(calls) {
    let last;
    for (let i = 0; i < C.rpcs.length * 2; i++) {
      const url = C.rpcs[cursor++ % C.rpcs.length];
      try {
        const json = await post(url, calls.map((c, id) => ({ jsonrpc: "2.0", id, method: c[0], params: c[1] })));
        if (!Array.isArray(json)) throw new Error("batch unsupported");
        const out = new Array(calls.length);
        for (const r of json) {
          if (r.error) throw new Error(r.error.message);
          out[r.id] = r.result;
        }
        return out;
      } catch (err) {
        last = err;
        await sleep(300 * (i + 1));
      }
    }
    throw last;
  }

  const call = (to, data) => ["eth_call", [{ to, data }, "latest"]];

  async function blockNumber() {
    return parseInt(await rpc("eth_blockNumber", []), 16);
  }

  async function totalSupply() {
    return BigInt(await rpc("eth_call", [{ to: C.token.address, data: "0x18160ddd" }, "latest"]));
  }

  // balanceOf for many addresses, 25 per request. Returns Map(addr -> BigInt).
  async function balancesOf(addrs) {
    const out = new Map();
    for (let i = 0; i < addrs.length; i += 25) {
      const chunk = addrs.slice(i, i + 25);
      const res = await batch(chunk.map((a) => call(C.token.address, "0x70a08231" + pad(a))));
      chunk.forEach((a, j) => out.set(a.toLowerCase(), BigInt(res[j])));
    }
    return out;
  }

  function parseTransfer(log) {
    return {
      from: "0x" + log.topics[1].slice(26),
      to: "0x" + log.topics[2].slice(26),
      value: BigInt(log.data),
      block: parseInt(log.blockNumber, 16),
      tx: log.transactionHash,
      index: parseInt(log.logIndex, 16),
    };
  }

  async function transfers(from, to) {
    const logs = await rpc("eth_getLogs", [
      { address: C.token.address, topics: [TRANSFER], fromBlock: hex(from), toBlock: hex(to) },
    ]);
    return logs.map(parseTransfer);
  }

  // Scan [from, to] in logRange windows, a few in parallel. onProgress(doneBlocks, totalBlocks).
  async function scanTransfers(from, to, onProgress) {
    const windows = [];
    for (let b = from; b <= to; b += C.logRange) windows.push([b, Math.min(b + C.logRange - 1, to)]);
    const results = new Array(windows.length);
    let done = 0;
    let next = 0;
    async function worker() {
      while (next < windows.length) {
        const i = next++;
        results[i] = await transfers(windows[i][0], windows[i][1]);
        done += windows[i][1] - windows[i][0] + 1;
        onProgress && onProgress(done, to - from + 1);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    return results.flat();
  }

  async function blockTimes(blocks) {
    const uniq = [...new Set(blocks)];
    if (!uniq.length) return new Map();
    const res = await batch(uniq.map((b) => ["eth_getBlockByNumber", [hex(b), false]]));
    return new Map(uniq.map((b, i) => [b, res[i] ? parseInt(res[i].timestamp, 16) * 1000 : Date.now()]));
  }

  window.Chain = { rpc, batch, blockNumber, totalSupply, balancesOf, transfers, scanTransfers, blockTimes };
})();
