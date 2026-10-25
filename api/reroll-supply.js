// Same-origin proxy for Reroll's public supply endpoint (staked / circulating come from
// Reroll's custody ledger and are not readable onchain). api.reroll.gg does not send CORS
// headers for other sites, so the browser cannot call it directly.
// Works as a Vercel serverless function and from scripts/serve.mjs.
const UPSTREAM = "https://api.reroll.gg/token/supply";

export default async function handler(req, res) {
  try {
    const upstream = await fetch(UPSTREAM, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
    const json = await upstream.json();
    if (!json.success || !json.data) throw new Error("unexpected response");
    const { totalSupply, staked, circulating, uncirculated, burned, readAt, stale } = json.data;
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "public, max-age=30, s-maxage=30");
    res.end(JSON.stringify({ data: { totalSupply, staked, circulating, uncirculated, burned, readAt, stale } }));
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
}
