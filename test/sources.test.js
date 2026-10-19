import test from "node:test";
import assert from "node:assert/strict";
import { client } from "../src/http.js";
import { normalizeItadDeal, editionCompatible, loadItad } from "../src/sources/itad.js";
import { parseTwoGame, twoGameMappings } from "../src/sources/two-game.js";
import { parseRpc } from "../src/sources/fanatical.js";
import { loadWishlist } from "../src/sources/steam.js";
import { loadFx } from "../src/sources/fx.js";
import { fixture, ids, uuids, now } from "./fixture.js";

const deal = { shop: { id: 36, name: "Green Man Gaming" }, drm: [{ id: 61, name: "Steam" }], price: { amount: 10, currency: "USD" },
  regular: { amount: 40, currency: "USD" }, cut: 75, expiry: null, voucher: null, url: "https://itad.link/attribution/" };
const game = { appid: 261550, title: "Mount & Blade II: Bannerlord" };
const map = twoGameMappings[0];
const product = { id: Number(map.productId), handle: map.handle, title: map.title, vendor: map.publisher,
  price_varies: false, available: true, variants: [{ id: Number(map.variantId), price: 149900, compare_at_price: 199900, available: true }] };
const html = '<script>Shopify.country = "TH"; Shopify.currency = {"active":"THB","rate":"1"};</script><main>Steam เปิดใช้งานใน ไทย</main>';

test("ITAD keeps all-offer currency/link evidence and requires explicit Steam DRM and authorized source IDs", () => {
  const offer = normalizeItadDeal(deal, game, new Set([36]), "US");
  assert.equal(offer.url, deal.url);
  assert.equal(offer.priceBasis, "reference");
  assert.equal(offer.region, "unverified");
  assert.equal(normalizeItadDeal({ ...deal, drm: [] }, game, new Set([36]), "US"), null);
  assert.equal(normalizeItadDeal(deal, game, new Set([20]), "US"), null);
  assert.equal(normalizeItadDeal({ ...deal, voucher: "MEMBER" }, game, new Set([36]), "US"), null);
});

test("known substituted editions in merchant URLs are rejected without stripping edition words from wanted titles", () => {
  assert.equal(editionCompatible("https://shop.example/game-deluxe-edition/", game.title), false);
  assert.equal(editionCompatible("https://shop.example/game-deluxe-edition/", "Game Deluxe Edition"), true);
});

test("malformed source prices fail as source errors rather than pretending an offer ended", () => {
  for (const changed of [{ price: { amount: NaN, currency: "USD" } }, { cut: undefined }, { expiry: "not a date" }, { drm: undefined }, { url: "javascript:bad()" }]) {
    assert.throws(() => normalizeItadDeal({ ...deal, ...changed }, game, new Set([36]), "US"), /invalid_/);
  }
});

test("ambiguous reverse Steam identities are excluded from the broad feed", async () => {
  const f = fixture();
  const games = ids.map(appid => ({ appid, title: `Game ${appid}`, offers: [] }));
  const fetcher = (url, init) => String(url).includes("/lookup/shop/61/id") ?
    Promise.resolve(Response.json({ [uuids[0]]: [`app/${ids[0]}`, "app/999"], [uuids[1]]: [`app/${ids[1]}`] })) : f.fetcher(url, init);
  const result = await loadItad(client(fetcher), games, "TEST_SECRET_KEY", {}, "US", now);
  assert.deepEqual(result.gaps, [ids[0]]);
  assert.equal(games[0].offers.length, 0);
  assert.equal(games[1].offers.length, 1);
});

test("successful price queries may omit products with no current prices", async () => {
  const f = fixture();
  const games = ids.map(appid => ({ appid, title: `Game ${appid}`, offers: [] }));
  const fetcher = async (url, init) => {
    const response = await f.fetcher(url, init);
    if (String(url).includes("/games/prices")) return Response.json((await response.json()).filter(row => row.id !== uuids[0]));
    return response;
  };
  const result = await loadItad(client(fetcher), games, "TEST_SECRET_KEY", {}, "US", now);
  assert.deepEqual(result.noPrices, [ids[0]]);
  assert.deepEqual(result.gaps, []);
  assert.equal(games[0].offers.length, 0);
  assert.equal(games[1].offers.length, 1);
});

test("missing deal arrays and unexpected product IDs remain source failures", async () => {
  for (const rows of [[{ id: uuids[0] }], [{ id: "unexpected", deals: [] }]]) {
    const f = fixture();
    const games = ids.map(appid => ({ appid, title: `Game ${appid}`, offers: [] }));
    const fetcher = (url, init) => String(url).includes("/games/prices") ? Promise.resolve(Response.json(rows)) : f.fetcher(url, init);
    await assert.rejects(() => loadItad(client(fetcher), games, "TEST_SECRET_KEY", {}, "US", now), /invalid_price_batch/);
  }
});

test("2Game validates curated product+variant identity, Steam DRM, THB context and Thailand activation", () => {
  const result = parseTwoGame(product, html, map);
  assert.equal(result.amount, 1499);
  assert.equal(result.currency, "THB");
  assert.equal(result.region, "verified");
  assert.equal(result.appid, 261550);
  for (const changed of [{ id: 1 }, { title: "Bannerlord Deluxe" }, { vendor: "Other Publisher" }, { variants: [] }, { price_varies: true }]) {
    assert.throws(() => parseTwoGame({ ...product, ...changed }, html, map), /product_identity_changed/);
  }
  assert.throws(() => parseTwoGame(product, html.replace('"THB"', '"USD"'), map), /thai_price_context_unverified/);
  assert.throws(() => parseTwoGame(product, html.replace("Steam", "Epic"), map), /steam_drm_unverified/);
  assert.equal(parseTwoGame(product, html.replace("เปิดใช้งานใน ไทย", "ไม่สามารถเปิดใช้งานใน ไทย"), map).region, "blocked");
  assert.equal(parseTwoGame(product, html.replace("เปิดใช้งานใน ไทย", "Activation details unavailable"), map).region, "unverified");
});

test("Fanatical accepts real SSE and rejects error-only or malformed envelopes", () => {
  assert.deepEqual(parseRpc('event: message\ndata: {"jsonrpc":"2.0","result":{"region":"TH"}}\n\n').result, { region: "TH" });
  assert.deepEqual(parseRpc('{"result":{"x":1}}').result, { x: 1 });
  assert.throws(() => parseRpc("not json"), /invalid_rpc_response/);
});

test("private/unavailable wishlist is an error, never an empty successful scan", async () => {
  await assert.rejects(() => loadWishlist(client(async () => Response.json({ response: {} })), "76561198000000000"), /wishlist_unavailable_or_private/);
  assert.deepEqual(await loadWishlist(client(async () => Response.json({ response: { items: [] } })), "76561198000000000"), []);
});

test("429 causes no immediate retry and errors never disclose URLs, keys or response bodies", async () => {
  let calls = 0;
  const http = client(async () => { calls++; return Response.json({ secret: "very-secret" }, { status: 429, headers: { "Retry-After": "60" } }); });
  await assert.rejects(() => http.json("itad_prices", "https://api.isthereanydeal.com/games/prices/v3?key=very-secret"), error => error.status === 429 && error.retryAfter === "60" && !error.message.includes("very-secret"));
  assert.equal(calls, 1);
});

test("dated weekend FX is accepted, cache reused, stale data cannot fabricate comparisons", async () => {
  const now = Date.parse("2026-10-18T10:00:00Z");
  let calls = 0;
  const http = client(async () => { calls++; return Response.json([{ date: "2026-10-16", base: "EUR", quote: "USD", rate: 1.1 }, { date: "2026-10-16", base: "EUR", quote: "THB", rate: 37 }]); });
  const fx = await loadFx(http, ["USD"], null, now);
  assert.equal(fx.date, "2026-10-16");
  assert.equal(await loadFx(http, ["USD"], fx, now + 1000), fx);
  assert.equal(calls, 1);
  await assert.rejects(() => loadFx(client(async () => { throw new Error("offline"); }), ["USD"], fx, now + 10 * 86400000));
});
