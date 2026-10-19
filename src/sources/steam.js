import { chunks, SourceError } from "../http.js";

export async function loadWishlist(http, steamId) {
  const body = await http.json("steam_wishlist", `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${steamId}`);
  if (!Array.isArray(body?.response?.items)) throw new SourceError("steam_wishlist", "wishlist_unavailable_or_private");
  const ids = body.response.items.map(item => Number(item.appid));
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new SourceError("steam_wishlist", "invalid_app_ids");
  if (ids.length > 200) throw new SourceError("steam_wishlist", "wishlist_exceeds_free_run_budget_200");
  return [...new Set(ids)];
}

export async function loadSteam(http, ids, country = "TH") {
  const games = [];
  for (const batch of chunks(ids, 100)) {
    const input = { ids: batch.map(appid => ({ appid })), context: { language: "english", country_code: country }, data_request: { include_basic_info: true } };
    const metadata = await http.json("steam_metadata", `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`);
    if (!Array.isArray(metadata?.response?.store_items)) throw new SourceError("steam_metadata", "invalid_response");
    const prices = await http.json("steam_prices", `https://store.steampowered.com/api/appdetails?appids=${batch.join(",")}&cc=${country}&l=english&filters=price_overview`);
    const byId = new Map(metadata.response.store_items.map(item => [Number(item.appid), item]));
    for (const appid of batch) {
      const item = byId.get(appid);
      const result = prices[String(appid)];
      const valid = item?.success === 1 && item.visible === true && [0, 4].includes(item.type) && typeof item.name === "string";
      const game = { appid, title: item?.name ?? `Steam app ${appid}`, kind: item?.type === 4 ? "dlc" : "game",
        publishers: (item?.basic_info?.publishers ?? []).map(publisher => publisher.name), complete: valid && result?.success === true, offers: [] };
      const price = result?.data?.price_overview;
      if (game.complete && price) {
        if (price.currency !== "THB" || !Number.isInteger(price.initial) || !Number.isInteger(price.final) || price.final < 0 ||
          price.initial < price.final || !Number.isFinite(price.discount_percent) || price.discount_percent < 0 || price.discount_percent > 100) {
          game.complete = false;
        } else {
          game.offers.push({ source: "steam", key: "steam", appid, shop: "Steam", authorized: true, match: "exact", drm: "steam", stock: true,
            amount: price.final / 100, regular: price.initial / 100, currency: "THB", discount: price.discount_percent,
            region: "verified", priceBasis: "checkout", url: `https://store.steampowered.com/app/${appid}/?cc=TH` });
        }
      }
      games.push(game);
    }
  }
  return games;
}
