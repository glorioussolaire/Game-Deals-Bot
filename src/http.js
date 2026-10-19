export class SourceError extends Error {
  constructor(source, code, status = null, retryAfter = null) {
    super(`${source}: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "SourceError";
    Object.assign(this, { source, code, status, retryAfter });
  }
}

export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const REQUEST_HOSTS = {
  steam_wishlist: "api.steampowered.com", steam_metadata: "api.steampowered.com", steam_prices: "store.steampowered.com",
  itad_lookup: "api.isthereanydeal.com", itad_identity: "api.isthereanydeal.com", itad_prices: "api.isthereanydeal.com", itad_shops: "api.isthereanydeal.com",
  fanatical: "mcp.fanatical.com", "2game": "www.2game.com", fx: "api.frankfurter.dev",
  telegram: "api.telegram.org", telegram_setup: "api.telegram.org"
};
const PURCHASE_HOSTS = {
  steam: ["store.steampowered.com"], itad: ["itad.link", "isthereanydeal.com"],
  fanatical: ["www.fanatical.com", "fanatical.com"], "2game": ["www.2game.com", "2game.com"]
};

export function purchaseUrl(source, value) {
  const normalized = safeUrl(value);
  return normalized && PURCHASE_HOSTS[source]?.includes(new URL(normalized).hostname) ? normalized : null;
}

export async function readText(source, response, limit = MAX_RESPONSE_BYTES) {
  const length = response.headers.get("content-length");
  if (length && Number(length) > limit) {
    await response.body?.cancel();
    throw new SourceError(source, "response_too_large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const pieces = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new SourceError(source, "response_too_large");
      pieces.push(decoder.decode(value, { stream: true }));
    }
    pieces.push(decoder.decode());
    return pieces.join("");
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error instanceof SourceError ? error : new SourceError(source, "response_read_failed");
  } finally { reader.releaseLock(); }
}

export function client(fetcher = fetch) {
  let requests = 0;
  async function request(source, url, options = {}) {
    const normalized = safeUrl(url, 16384);
    if (!normalized || new URL(normalized).hostname !== REQUEST_HOSTS[source]) throw new SourceError(source, "destination_not_allowed");
    if (++requests > 45) throw new SourceError(source, "request_budget_exceeded");
    let response;
    try {
      response = await fetcher(normalized, {
        ...options,
        headers: { "User-Agent": "PersonalWishlistDeals/1.0", ...options.headers },
        signal: AbortSignal.timeout(20000),
        // Workers supports manual/follow, but not redirect:"error". Manual
        // keeps 3xx responses here so they fail below without forwarding keys.
        redirect: "manual"
      });
    } catch {
      throw new SourceError(source, "request_failed");
    }
    if (!response.ok) {
      // Never include a URL, response body, token or API key in an error.
      await response.body?.cancel();
      throw new SourceError(source, "http_error", response.status, response.headers.get("retry-after"));
    }
    return response;
  }
  async function json(source, url, options) {
    const response = await request(source, url, options);
    const text = await readText(source, response);
    try { return JSON.parse(text); }
    catch { throw new SourceError(source, "invalid_json"); }
  }
  async function text(source, url, options) { return readText(source, await request(source, url, options)); }
  return { request, json, text, readText, get requests() { return requests; } };
}

export function chunks(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}

export function safeUrl(value, maxLength = 2048) {
  if (typeof value !== "string" || value.length > maxLength || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.port ? url.href : null; }
  catch { return null; }
}

export function codeOf(error) {
  return error instanceof SourceError ? error.message : "unexpected_error";
}
