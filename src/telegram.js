import { SourceError, purchaseUrl } from "./http.js";

export const escapeHtml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const number = value => Number(value).toFixed(2).replace(/\.00$/, "");

export function formatDigest(alerts, { checkedAt, fx, stores = [], warnings = [] }) {
  if (!alerts.length) return [];
  const header = `<b>Wishlist discounts</b> · ${escapeHtml(checkedAt.replace("T", " ").slice(0, 16))} UTC\n`;
  const footer = `\nCheapest among checked authorized Steam offers.\n` +
    (fx ? `Estimated THB: ECB via Frankfurter, ${escapeHtml(fx.date)}.\n` : "") +
    `Sources: <a href="https://isthereanydeal.com/">IsThereAnyDeal</a>, Steam` +
    (stores.includes("Fanatical") ? ", Fanatical" : "") + (stores.includes("2Game") ? ", 2Game" : "") +
    (warnings.length ? `\nCoverage: ${escapeHtml(warnings.join("; "))}` : "");
  const pieces = alerts.map(({ title, offer, thb }) => {
    const url = purchaseUrl(offer.source, offer.url);
    if (!url) throw new SourceError("telegram", "invalid_purchase_link");
    const original = `${offer.currency} ${number(offer.amount)}`;
    const price = offer.currency === "THB" ? `฿${number(offer.amount)}` : `${original} (≈฿${number(thb)})`;
    const discount = `${Math.round(offer.discount * 100) / 100}% off`;
    const status = offer.region === "verified" ? "Thailand availability confirmed by retailer" : "⚠ Thailand activation unverified";
    const reference = offer.priceBasis === "reference" ? `\n${escapeHtml(offer.referenceCountry ?? "US")} reference price, as reported by feed` : "";
    return `\n<b>${escapeHtml(title.slice(0, 250))}</b>\n` +
      `<a href="${escapeHtml(url)}">${escapeHtml(offer.shop)}</a> · ${escapeHtml(price)} · ${escapeHtml(discount)}\n` +
      `${status}${reference}\n`;
  });
  // Conservative HTML-length budget also keeps plain-text Telegram length safe.
  const messages = [];
  let text = header;
  for (const piece of pieces) {
    if ((text + piece + footer).length > 3900 && text !== header) {
      messages.push(text + footer); text = header;
    }
    if ((header + piece + footer).length > 4096) throw new SourceError("telegram", "offer_message_too_long");
    text += piece;
  }
  messages.push(text + footer);
  return messages;
}

export async function sendMessage(http, env, text) {
  const result = await http.json("telegram", `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } })
  });
  if (!result.ok || !result.result?.message_id) throw new SourceError("telegram", "delivery_failed");
}
