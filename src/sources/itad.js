import { chunks, SourceError, purchaseUrl } from "../http.js";

const ROOT = "https://api.isthereanydeal.com";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const EDITION_WORDS = /\b(deluxe|ultimate|gold|complete|collector|premium|definitive|anniversary|remaster(?:ed)?|edition|bundle|upgrade|season|pass|dlc|soundtrack)\b/gi;

export function editionCompatible(url, title) {
  let path;
  try { path = decodeURIComponent(new URL(url).pathname).replace(/[-_+]/g, " "); }
  catch { return false; }
  const expected = new Set((title.match(EDITION_WORDS) ?? []).map(s => s.toLowerCase()));
  return (path.match(EDITION_WORDS) ?? []).every(s => expected.has(s.toLowerCase()));
}

export function normalizeItadDeal(deal, game, allowedShops, country) {
  if (!allowedShops.has(deal.shop?.id) || deal.shop.id === 61) return null;
  if (!Array.isArray(deal.drm)) throw new SourceError("itad_prices", "invalid_drm_schema");
  if (!deal.drm.some(drm => drm.id === 61 && /^steam$/i.test(drm.name ?? ""))) return null;
  if (deal.voucher) return null; // No member-only or conditional coupon assumptions.
  const url = purchaseUrl("itad", deal.url);
  if (!url) throw new SourceError("itad_prices", "invalid_purchase_link");
  if (!editionCompatible(url, game.title)) return null;
  if (!Number.isFinite(deal.price?.amount) || deal.price.amount < 0 || !Number.isFinite(deal.regular?.amount) || deal.regular.amount < deal.price.amount ||
    deal.price.currency !== deal.regular.currency || !/^[A-Z]{3}$/.test(deal.price.currency ?? "") ||
    !Number.isFinite(deal.cut) || deal.cut < 0 || deal.cut > 100 ||
    (deal.expiry != null && !Number.isFinite(Date.parse(deal.expiry)))) throw new SourceError("itad_prices", "invalid_offer_schema");
  return { source: "itad", key: `itad:${deal.shop.id}:${url}`, appid: game.appid, shop: deal.shop.name,
    authorized: true, match: "exact", matchEvidence: "steam-app-catalog-assignment", drm: "steam", stock: true,
    amount: deal.price.amount, regular: deal.regular.amount, currency: deal.price.currency, discount: deal.cut,
    expiresAt: deal.expiry, region: "unverified", priceBasis: "reference", referenceCountry: country, url };
}

export async function loadItad(http, games, apiKey, cache = {}, country = "US", now = Date.now()) {
  if (!apiKey) throw new SourceError("itad", "missing_api_key");
  const mapping = { ...cache };
  const missing = games.filter(game => !mapping[game.appid]?.id || now - mapping[game.appid].at > 7 * 86400000);
  for (const batch of chunks(missing, 100)) {
    const keys = batch.map(game => `app/${game.appid}`);
    const response = await http.json("itad_lookup", `${ROOT}/lookup/id/shop/61/v1`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(keys)
    });
    for (const game of batch) {
      const id = response[`app/${game.appid}`];
      if (id !== null && (typeof id !== "string" || !UUID.test(id))) throw new SourceError("itad_lookup", "invalid_mapping");
      mapping[game.appid] = { id, at: now };
    }
  }
  const unvalidated = games.filter(game => mapping[game.appid]?.id && !mapping[game.appid].steamIds);
  for (const batch of chunks(unvalidated, 100)) {
    const ids = [...new Set(batch.map(game => mapping[game.appid].id))];
    const response = await http.json("itad_identity", `${ROOT}/lookup/shop/61/id/v1`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids)
    });
    for (const game of batch) {
      const productIds = response[mapping[game.appid].id];
      if (productIds !== null && (!Array.isArray(productIds) || productIds.some(id => typeof id !== "string"))) throw new SourceError("itad_identity", "invalid_identity_response");
      mapping[game.appid].steamIds = productIds ?? [];
    }
  }
  const exact = game => {
    const appIds = [...new Set((mapping[game.appid]?.steamIds ?? []).filter(id => id.startsWith("app/")))];
    return appIds.length === 1 && appIds[0] === `app/${game.appid}`;
  };
  // Never attribute one shared container to multiple distinct wishlist products.
  const counts = new Map();
  for (const game of games) {
    const id = mapping[game.appid]?.id;
    if (id && exact(game)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const shops = await http.json("itad_shops", `${ROOT}/service/shops/v1?country=${country}`);
  if (!Array.isArray(shops) || !shops.length || shops.some(s => !Number.isInteger(s.id) || typeof s.title !== "string")) throw new SourceError("itad_shops", "invalid_shop_list");
  const allowedShops = new Set(shops.map(shop => shop.id));
  const ids = [...counts.keys()].filter(id => counts.get(id) === 1);
  const rows = [];
  for (const batch of chunks(ids, 200)) {
    const response = await http.json("itad_prices", `${ROOT}/games/prices/v3?country=${country}&capacity=0&deals=false&vouchers=false`, {
      method: "POST", headers: { "Content-Type": "application/json", "ITAD-API-Key": apiKey }, body: JSON.stringify(batch)
    });
    if (!Array.isArray(response)) throw new SourceError("itad_prices", "invalid_response");
    const requested = new Set(batch);
    const seen = new Set();
    for (const row of response) {
      if (!row || !requested.has(row.id) || seen.has(row.id) || !Array.isArray(row.deals)) throw new SourceError("itad_prices", "invalid_price_batch");
      seen.add(row.id);
    }
    rows.push(...response);
  }
  const byId = new Map(rows.map(row => [row.id, row]));
  const gaps = [];
  const noPrices = [];
  for (const game of games) {
    const id = mapping[game.appid]?.id;
    if (!id || !exact(game) || counts.get(id) !== 1) { gaps.push(game.appid); continue; }
    const row = byId.get(id);
    // A successful price query omits games with no current prices, including
    // unreleased/delisted products. Malformed rows are rejected above; omission
    // is distinct from a failed request or an ambiguous product identity.
    if (!row) { noPrices.push(game.appid); continue; }
    for (const deal of row.deals) {
      const offer = normalizeItadDeal(deal, game, allowedShops, country);
      if (offer) game.offers.push(offer);
    }
  }
  return { mapping, gaps, noPrices, shops: shops.map(shop => shop.title) };
}
