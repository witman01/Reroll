// Production + local server (Railway runs this via `npm start`).
// Serves the static dashboard, the /api/reroll-supply proxy, and keeps
// data/snapshot.json fresh by re-scanning new blocks every 10 minutes.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import rerollSupply from "../api/reroll-supply.js";
import { updateSnapshot } from "./snapshot.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT) || 5199;
const SNAPSHOT_EVERY = 10 * 60 * 1000;
const PUBLIC = ["index.html", "css/", "js/", "assets/", "data/snapshot.json"];
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/reroll-supply") return rerollSupply(req, res);
    if (url.pathname === "/health") return res.writeHead(200, { "content-type": "text/plain" }).end("ok");

    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !PUBLIC.some((p) => rel === p || (p.endsWith("/") && rel.startsWith(p)))) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file)] || "application/octet-stream",
        "cache-control": rel.startsWith("assets/") ? "public, max-age=86400" : "no-cache",
        "x-content-type-options": "nosniff",
      });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    }
  })
  .listen(PORT, () => console.log(`REROLL dashboard → http://localhost:${PORT}`));

let running = false;
async function refreshSnapshot() {
  if (running) return;
  running = true;
  try {
    const r = await updateSnapshot();
    console.log(`snapshot: block ${r.block}, ${r.holders} holders, ${r.newTransfers} new transfers`);
  } catch (err) {
    console.warn("snapshot refresh failed:", err.message || err);
  } finally {
    running = false;
  }
}
refreshSnapshot();
setInterval(refreshSnapshot, SNAPSHOT_EVERY);
