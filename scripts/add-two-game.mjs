import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { root, friendlyError } from "./env.mjs";
import { client, SourceError } from "../src/http.js";
import { loadSteam } from "../src/sources/steam.js";
import { parseTwoGame } from "../src/sources/two-game.js";

const identity = value => String(value).normalize("NFKC").toLowerCase().replace(/[™®:.,'’–—-]/g, "").replace(/\s+/g, " ").trim();

try {
  const [rawId, rawUrl] = process.argv.slice(2);
  const appid = Number(rawId);
  const url = new URL(rawUrl);
  const handle = url.pathname.match(/^\/th-th\/products\/([a-z0-9-]+)\/?$/)?.[1];
  if (!Number.isSafeInteger(appid) || appid <= 0 || url.protocol !== "https:" || url.hostname !== "www.2game.com" || !handle) {
    throw new SourceError("mapping", "usage_npm_run_add_2game_steamAppId_thaiProductURL");
  }
  const file = path.join(root, "config", "2game-products.json");
  const maps = JSON.parse(await readFile(file, "utf8"));
  if (maps.length >= 8 && !maps.some(map => map.appid === appid)) throw new SourceError("mapping", "direct_2game_budget_8_products");
  const http = client();
  const [game] = await loadSteam(http, [appid]);
  if (!game.complete) throw new SourceError("mapping", "steam_product_unavailable");
  const canonical = `https://www.2game.com/th-th/products/${handle}`;
  const product = await http.json("2game", `${canonical}.js`);
  if (identity(product.title) !== identity(game.title) || !game.publishers.some(publisher => identity(publisher) === identity(product.vendor))) {
    throw new SourceError("mapping", "title_or_publisher_mismatch_no_fuzzy_fallback");
  }
  const map = { appid, handle, productId: String(product.id), variantId: String(product.variants?.[0]?.id),
    title: game.title, publisher: product.vendor, kind: game.kind, verifiedOn: new Date().toISOString().slice(0, 10) };
  const html = await http.text("2game", canonical);
  const offer = parseTwoGame(product, html, map);
  const next = [...maps.filter(item => item.appid !== appid), map].sort((a, b) => a.appid - b.appid);
  await writeFile(file, JSON.stringify(next, null, 2) + "\n");
  console.log(`Validated ${game.title}: THB ${offer.amount}, Thailand status ${offer.region}. Mapping saved; redeploy to activate it.`);
} catch (error) {
  console.error(friendlyError(error));
  console.error('Usage: npm run add:2game -- 261550 "https://www.2game.com/th-th/products/mount-blade-ii-bannerlord-steam-key"');
  process.exitCode = 1;
}
