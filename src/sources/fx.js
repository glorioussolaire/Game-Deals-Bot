import { SourceError } from "../http.js";

export function freshDate(date, now) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const timestamp = Date.parse(date);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date &&
    now >= timestamp && now - timestamp <= 7 * 86400000;
}

export async function loadFx(http, currencies, cached, now = Date.now()) {
  const wanted = [...new Set(["THB", ...currencies])].filter(c => c !== "EUR" && /^[A-Z]{3}$/.test(c)).sort();
  const validCache = cached && freshDate(cached.date, now) && cached.rates?.EUR === 1 &&
    wanted.every(c => Number.isFinite(cached.rates?.[c]) && cached.rates[c] > 0) &&
    Number.isFinite(cached.fetchedAt) && cached.fetchedAt <= now;
  if (validCache && now - cached.fetchedAt < 86400000) return cached;
  try {
    const rows = await http.json("fx", `https://api.frankfurter.dev/v2/providers/ecb/rates?base=EUR&quotes=${wanted.join(",")}`);
    if (!Array.isArray(rows) || !rows.length) throw new SourceError("fx", "invalid_rates");
    const dates = new Set(rows.map(row => row.date));
    if (dates.size !== 1 || rows.some(row => row.base !== "EUR" || !wanted.includes(row.quote) || !Number.isFinite(row.rate) || row.rate <= 0) ||
      new Set(rows.map(row => row.quote)).size !== rows.length) throw new SourceError("fx", "invalid_rates");
    const date = rows[0].date;
    const rates = { EUR: 1, ...Object.fromEntries(rows.map(row => [row.quote, row.rate])) };
    if (!freshDate(date, now) || wanted.some(c => !(rates[c] > 0))) throw new SourceError("fx", "missing_or_stale_rates");
    return { date, rates, fetchedAt: now };
  } catch (error) {
    if (validCache) return cached;
    throw error;
  }
}
