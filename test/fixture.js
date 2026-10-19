export const ids = [261550, 1570510];
export const uuids = ["018d937f-2b82-710b-be7f-7324eaa1d8d5", "018d937f-595a-726a-ae15-3423aebae19f"];
export const now = Date.parse("2026-10-18T10:00:00Z");

export function fixture() {
  const controls = { wishlistFailure: false, itadFailure: false, failSend: 0, attempts: 0, sent: [], price: 20 };
  let state = null;
  const env = { STEAM_ID: "76561198000000000", COUNTRY: "TH", REFERENCE_COUNTRY: "US", ITAD_API_KEY: "TEST_SECRET_KEY",
    TELEGRAM_BOT_TOKEN: "123456:TEST_SECRET_TOKEN", TELEGRAM_CHAT_ID: "123456", ENABLE_FANATICAL: "true", ENABLE_2GAME: "true", FAILURE_NOTICE_AFTER: "3",
    DEALS_KV: { async get() { return state; }, async put(_key, value) { state = value; } } };
  async function fetcher(input, init = {}) {
    const url = new URL(input);
    if (url.pathname.includes("GetWishlist")) return Response.json(controls.wishlistFailure ? { response: {} } : { response: { items: ids.map(appid => ({ appid })) } });
    if (url.pathname.includes("GetItems")) return Response.json({ response: { store_items: ids.map((appid, index) => ({ appid, name: index ? "Undernauts: Labyrinth of Yomi" : "Mount & Blade II: Bannerlord", success: 1, visible: true, type: 0 })) } });
    if (url.pathname.endsWith("/appdetails")) return Response.json(Object.fromEntries(ids.map(appid => [appid, { success: true, data: { price_overview: { currency: "THB", initial: 149900, final: 149900, discount_percent: 0 } } }])));
    if (url.pathname.includes("/lookup/id/shop/61")) return Response.json(Object.fromEntries(ids.map((appid, i) => [`app/${appid}`, uuids[i]])));
    if (url.pathname.includes("/lookup/shop/61/id")) return Response.json(Object.fromEntries(ids.map((appid, i) => [uuids[i], [`app/${appid}`]])));
    if (url.pathname.includes("/service/shops")) return Response.json([{ id: 36, title: "Green Man Gaming" }, { id: 6, title: "Fanatical" }, { id: 61, title: "Steam" }]);
    if (url.pathname.includes("/games/prices")) {
      if (controls.itadFailure) return Response.json({ message: "key TEST_SECRET_KEY" }, { status: 503 });
      const requested = new Set(JSON.parse(init.body));
      return Response.json(uuids.map((id, i) => ({ id, deals: [{ shop: { id: 36, name: "Green Man Gaming" }, drm: [{ id: 61, name: "Steam" }],
        price: { amount: controls.price + i, currency: "USD" }, regular: { amount: 60, currency: "USD" }, cut: 66,
        expiry: null, voucher: null, url: `https://itad.link/${id}/` }] })).filter(row => requested.has(row.id)));
    }
    if (url.hostname === "mcp.fanatical.com") {
      const rpc = JSON.parse(init.body);
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      const result = rpc.method === "initialize" ? { protocolVersion: "2025-03-26" } : { structuredContent: { region: "TH", currency: "USD", products: [
        { steam_id: 261550, type: "game", parent: null, drm: "steam", in_stock: true, price: 41.99, full_price: 49.99, discount_percent: 16, valid_until: null, coupon: null, url: "https://www.fanatical.com/en/game/mount-blade-ii-bannerlord?utm_source=mcp" }
      ], not_found: [1570510] } };
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result })}\n\n`, { headers: { "Mcp-Session-Id": "test-session", "Content-Type": "text/event-stream" } });
    }
    if (url.hostname === "www.2game.com") {
      if (url.pathname.endsWith(".js")) return Response.json({ id: 16140937920837, handle: "mount-blade-ii-bannerlord-steam-key", title: "Mount & Blade II: Bannerlord", vendor: "Taleworlds Entertainment", available: true, price_varies: false,
        variants: [{ id: 59125103493445, price: 149900, compare_at_price: 149900, available: true }] });
      return new Response('<script>Shopify.country="TH";Shopify.currency={"active":"THB"};</script><main>Steam เปิดใช้งานใน ไทย</main>');
    }
    if (url.hostname === "api.frankfurter.dev") return Response.json([{ base: "EUR", quote: "USD", rate: 1, date: "2026-10-16" }, { base: "EUR", quote: "THB", rate: 33, date: "2026-10-16" }]);
    if (url.hostname === "api.telegram.org") {
      controls.attempts++;
      const body = JSON.parse(init.body);
      if (controls.attempts === controls.failSend) return Response.json({ ok: false }, { status: 429 });
      controls.sent.push(body.text);
      return Response.json({ ok: true, result: { message_id: controls.attempts } });
    }
    throw new Error(`Unexpected fixture request to ${url.hostname}${url.pathname}`);
  }
  return { env, controls, fetcher, get state() { return state ? JSON.parse(state) : null; }, set state(value) { state = JSON.stringify(value); } };
}
