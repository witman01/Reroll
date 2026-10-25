// Builds data/snapshot.json: every REROLL holder balance, rebuilt from onchain
// Transfer events. Incremental — each run only scans blocks after the last snapshot.
// CLI: node scripts/snapshot.mjs   (the server also calls updateSnapshot() on a timer)
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SNAPSHOT_PATH = path.join(ROOT, "data", "snapshot.json");

const TOKEN = "0x9e86af070e1b05a3e857b4d1e31dfd860da245c0";
const DEPLOY_BLOCK = 49001629;
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const RANGE = 1000; // most free HyperEVM RPCs cap eth_getLogs at 1000 blocks
const RPCS = [
  "https://rpc.hypurrscan.io",
  "https://hyperliquid-json-rpc.stakely.io",
  "https://999.rpc.thirdweb.com",
  "https://rpc.hyperliquid.xyz/evm",
];

let next = 0;
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < RPCS.length * 3; attempt++) {
    const url = RPCS[next++ % RPCS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(30000),
      });
      const json = await res.json();
      if (json.error) throw new Error(`${url}: ${json.error.message}`);
      return json.result;
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw last;
}

export async function updateSnapshot({ log = () => {} } = {}) {
  let snap = { token: TOKEN, block: DEPLOY_BLOCK - 1, balances: {} };
  try {
    snap = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));
  } catch {}

  const balances = new Map(Object.entries(snap.balances).map(([a, v]) => [a, BigInt(v)]));
  // Restore the zero address's negative balance so mints/burns to it stay balanced.
  const sum = [...balances.values()].reduce((s, v) => s + v, 0n);
  balances.set("0x0000000000000000000000000000000000000000", -sum);

  const head = parseInt(await rpc("eth_blockNumber", []), 16);
  let from = snap.block + 1;
  let count = 0;

  while (from <= head) {
    const to = Math.min(from + RANGE - 1, head);
    const logs = await rpc("eth_getLogs", [
      { address: TOKEN, topics: [TRANSFER], fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16) },
    ]);
    for (const l of logs) {
      const src = "0x" + l.topics[1].slice(26);
      const dst = "0x" + l.topics[2].slice(26);
      const value = BigInt(l.data);
      balances.set(src, (balances.get(src) ?? 0n) - value);
      balances.set(dst, (balances.get(dst) ?? 0n) + value);
      count++;
    }
    log(`scanned to ${to} / ${head} (${count} new transfers)`);
    from = to + 1;
  }

  const out = {};
  for (const [addr, v] of [...balances].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))) {
    if (v > 0n && addr !== "0x0000000000000000000000000000000000000000") out[addr] = v.toString();
  }

  await mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
  // Write then rename, so the server never serves a half-written file.
  const tmp = SNAPSHOT_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify({ token: TOKEN, block: head, updatedAt: new Date().toISOString(), balances: out }, null, 1));
  await rename(tmp, SNAPSHOT_PATH);
  return { block: head, holders: Object.keys(out).length, newTransfers: count };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updateSnapshot({ log: (m) => process.stdout.write("\r" + m) })
    .then((r) => console.log(`\nwrote ${r.holders} holders at block ${r.block}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
