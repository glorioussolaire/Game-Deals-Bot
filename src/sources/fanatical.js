import { chunks, SourceError, purchaseUrl } from "../http.js";

const ENDPOINT = "https://mcp.fanatical.com/mcp";

export function parseRpc(text) {
  try {
    if (text.trimStart().startsWith("{")) return JSON.parse(text);
    const events = text.replaceAll("\r\n", "\n").split("\n\n");
    for (const event of events) {
      const data = event.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (data) { const value = JSON.parse(data); if (value.result || value.error) return value; }
    }
  } catch { /* malformed data becomes a source failure */ }
  throw new SourceError("fanatical", "invalid_rpc_response");
}

export async function loadFanatical(http, games) {
  if (!games.length) return { gaps: [] };
  let session;
  let id = 0;
  async function rpc(method, params, notification = false) {
    const response = await http.request("fanatical", ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream",
        ...(session ? { "Mcp-Session-Id": session, "MCP-Protocol-Version": "2025-03-26" } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id: ++id }), method, params })
    });
    session = response.headers.get("Mcp-Session-Id") ?? session;
    if (notification) { await response.body?.cancel(); return; }
    const message = parseRpc(await http.readText("fanatical", response));
    if (message.error || message.result?.isError) throw new SourceError("fanatical", "rpc_error");
    return message.result;
  }
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "personal-wishlist-deals", version: "1.0.0" } });
  if (!session) throw new SourceError("fanatical", "missing_session");
  await rpc("notifications/initialized", {}, true);
  const gaps = [];
  for (const batch of chunks(games, 20)) {
    const result = await rpc("tools/call", { name: "get_products", arguments: { steam_ids: batch.map(g => g.appid), region: "TH", include_related: false } });
    let payload = result.structuredContent;
    if (!payload) {
      try { payload = JSON.parse(result.content?.find(item => item.type === "text")?.text); } catch { /* handled below */ }
    }
    if (payload?.region !== "TH" || !/^[A-Z]{3}$/.test(payload.currency ?? "") || !Array.isArray(payload.products) || !Array.isArray(payload.not_found)) throw new SourceError("fanatical", "invalid_product_batch");
    const found = new Map(payload.products.map(product => [Number(product.steam_id), product]));
    for (const game of batch) {
      const product = found.get(game.appid);
      if (!product) {
        if (!payload.not_found.some(value => Number(value) === game.appid)) throw new SourceError("fanatical", "incomplete_product_batch");
        gaps.push(game.appid); continue;
      }
      // A direct stock/DRM observation supersedes a foreign-region feed copy.
      game.offers = game.offers.filter(offer => offer.source !== "itad" || !/^fanatical$/i.test(offer.shop));
      const exactKind = game.kind === "dlc" ? product.type === "dlc" : product.type === "game" && !product.parent;
      if (!exactKind || product.drm?.toLowerCase() !== "steam" || !product.in_stock || product.coupon) continue;
      if (!Number.isFinite(product.price) || product.price < 0 || !Number.isFinite(product.full_price) || product.full_price < product.price ||
        !Number.isFinite(product.discount_percent) || product.discount_percent < 0 || product.discount_percent > 100 ||
        !purchaseUrl("fanatical", product.url) || product.valid_until != null && (!Number.isFinite(product.valid_until) || product.valid_until < 0)) {
        throw new SourceError("fanatical", "invalid_price_schema");
      }
      game.offers.push({ source: "fanatical", key: "fanatical:direct", appid: game.appid, shop: "Fanatical", authorized: true, match: "exact", drm: "steam", stock: true,
        amount: product.price, regular: product.full_price, currency: payload.currency, discount: product.discount_percent,
        region: "verified", priceBasis: "checkout", expiresAt: product.valid_until ? new Date(product.valid_until * 1000).toISOString() : null, url: product.url });
      // Use the region-specific retailer observation instead of the feed's
      // foreign-region copy, even when the direct product is out of sale.
    }
  }
  return { gaps };
}
