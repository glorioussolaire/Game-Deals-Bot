import mappings from "../../config/2game-products.json" with { type: "json" };
import { SourceError } from "../http.js";

export const twoGameMappings = mappings;
const identity = text => String(text).normalize("NFKC").toLowerCase().replace(/[™®:.,'’–—-]/g, "").replace(/\s+/g, " ").trim();

export function parseTwoGame(product, html, map) {
  const variant = product.variants?.[0];
  if (String(product.id) !== map.productId || product.handle !== map.handle || identity(product.title) !== identity(map.title) ||
    identity(product.vendor) !== identity(map.publisher) || product.variants?.length !== 1 || String(variant?.id) !== map.variantId || product.price_varies) {
    throw new SourceError("2game", "product_identity_changed");
  }
  const country = /Shopify\.country\s*=\s*["']TH["']/.test(html);
  const currency = /Shopify\.currency\s*=\s*\{[^;]{0,1000}?["']active["']\s*:\s*["']THB["']/.test(html);
  if (!country || !currency) throw new SourceError("2game", "thai_price_context_unverified");
  const main = (html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  if (!/\bSteam\b/i.test(main)) throw new SourceError("2game", "steam_drm_unverified");
  const blocked = /(?:cannot be activated in|ไม่สามารถเปิดใช้งานใน)[\s\S]{0,160}(?:Thailand|ไทย)/i.test(main);
  const verified = /(?:activates? in|เปิดใช้งานใน)[\s\S]{0,160}(?:Thailand|ไทย)/i.test(main);
  if (!Number.isInteger(variant.price) || !Number.isInteger(variant.compare_at_price ?? variant.price)) throw new SourceError("2game", "invalid_price");
  const regular = (variant.compare_at_price ?? variant.price) / 100;
  const amount = variant.price / 100;
  return { source: "2game", key: `2game:${map.productId}:${map.variantId}`, appid: map.appid, shop: "2Game", authorized: true, match: "exact", drm: "steam",
    stock: product.available === true && variant.available === true, amount, regular, currency: "THB",
    discount: regular > amount ? (1 - amount / regular) * 100 : 0, region: blocked ? "blocked" : verified ? "verified" : "unverified",
    priceBasis: "checkout", url: `https://www.2game.com/th-th/products/${map.handle}` };
}

export async function loadTwoGame(http, games, maps = mappings) {
  const relevant = maps.filter(map => games.some(game => game.appid === map.appid));
  if (relevant.length > 8) throw new SourceError("2game", "direct_catalog_exceeds_free_budget_8");
  const failures = [];
  for (const map of relevant) {
    const game = games.find(g => g.appid === map.appid);
    try {
      const url = `https://www.2game.com/th-th/products/${encodeURIComponent(map.handle)}`;
      const product = await http.json("2game", `${url}.js`);
      const html = await http.text("2game", url);
      const offer = parseTwoGame(product, html, map);
      if (game.kind !== map.kind) throw new SourceError("2game", "wishlist_product_kind_changed");
      game.offers.push(offer);
    } catch (error) {
      game.complete = false;
      failures.push({ appid: game.appid, error });
      // Respect a rate limit immediately; don't issue further product requests.
      if (error.status === 429) {
        for (const remaining of relevant.slice(relevant.indexOf(map) + 1)) {
          games.find(g => g.appid === remaining.appid).complete = false;
        }
        break;
      }
    }
  }
  return { failures, covered: relevant.map(map => map.appid), gaps: games.filter(game => !relevant.some(map => map.appid === game.appid)).map(game => game.appid) };
}
