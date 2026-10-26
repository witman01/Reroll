// Same-origin, cached proxy for GeckoTerminal's pool endpoints. GeckoTerminal rate-limits per
// IP and its 429 responses carry no CORS header, so browsers calling it directly see a CORS
// failure. Every visitor shares this cache instead, and stale data is served if upstream fails.
const POOL = "https://api.geckoterminal.com/api/v2/networks/hyperevm/pools/0xc43d5f0077a9da3aa57314b52f1c1cb68997dd35";
const ROUTES = { "": 15000, trades: 20000, "ohlcv/minute": 60000, "ohlcv/hour": 120000, "ohlcv/day": 300000 };
const QUERY_KEYS = ["aggregate", "limit", "currency", "token"];
const cache = new Map(); // key -> { at, body, pending }

async function fetchUpstream(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { accept: "application/json" } });
    if (res.ok) return res.text();
    // Rate limited: back off and retry a couple of times before giving up.
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`upstream ${res.status}`);
  }
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const route = url.pathname.replace(/^\/api\/gecko\/?/, "").replace(/\/$/, "");
  const ttl = ROUTES[route];
  const send = (status, body, extra = {}) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-cache", ...extra });
    res.end(body);
  };
  if (ttl === undefined) return send(404, JSON.stringify({ error: "unknown route" }));

  const query = new URLSearchParams();
  for (const k of QUERY_KEYS) if (url.searchParams.has(k)) query.set(k, url.searchParams.get(k));
  const qs = query.toString();
  const upstream = POOL + (route ? "/" + route : "") + (qs ? "?" + qs : "");

  let entry = cache.get(upstream);
  if (entry && Date.now() - entry.at < ttl) return send(200, entry.body, { "x-cache": "hit" });

  try {
    // Collapse concurrent misses into one upstream request.
    if (!entry?.pending) {
      const pending = fetchUpstream(upstream);
      entry = { ...(entry || {}), pending };
      cache.set(upstream, entry);
    }
    const body = await entry.pending;
    cache.set(upstream, { at: Date.now(), body });
    send(200, body, { "x-cache": "miss" });
  } catch (err) {
    const stale = cache.get(upstream);
    if (stale) delete stale.pending;
    if (stale?.body) return send(200, stale.body, { "x-cache": "stale" });
    send(502, JSON.stringify({ error: String(err.message || err) }));
  }
}
