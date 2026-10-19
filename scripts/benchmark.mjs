import { performance } from "node:perf_hooks";
import { planAlerts } from "../src/engine.js";
import { formatDigest } from "../src/telegram.js";

const now = Date.parse("2026-10-18T10:00:00Z");
const fx = { date: "2026-10-16", rates: { EUR: 1, USD: 1.1, GBP: 0.85, THB: 37 } };
const games = Array.from({ length: 27 }, (_, i) => ({ appid: i + 1, title: `Wishlist game ${i + 1}`, complete: true,
  offers: Array.from({ length: 20 }, (_, j) => ({ key: `shop:${j}`, source: "itad", appid: i + 1, shop: `Authorized store ${j}`,
    amount: 10 + j, regular: 50, currency: "USD", discount: 80 - j, authorized: true, match: "exact", drm: "steam", stock: true,
    region: "unverified", priceBasis: "reference", referenceCountry: "US", url: `https://itad.link/example-${i}-${j}/` })) }));
const json = JSON.stringify(games);
const samples = [];
let messages;
for (let i = 0; i < 150; i++) {
  const start = performance.now();
  const plan = planAlerts(JSON.parse(json), {}, fx, now);
  messages = formatDigest(plan.alerts, { checkedAt: new Date(now).toISOString(), fx });
  if (i >= 25) samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
console.log(JSON.stringify({ products: 27, offers: 540, fixtureBytes: Buffer.byteLength(json), digestParts: messages.length,
  medianMs: +samples[Math.floor(samples.length / 2)].toFixed(3), p95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(3),
  scope: "Local parsing, filtering, comparison and formatting only; not a deployed Cloudflare CPU measurement." }, null, 2));
