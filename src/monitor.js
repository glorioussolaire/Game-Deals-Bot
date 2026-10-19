import { client, codeOf, SourceError } from "./http.js";
import { planAlerts } from "./engine.js";
import { formatDigest, sendMessage, escapeHtml } from "./telegram.js";
import { loadWishlist, loadSteam } from "./sources/steam.js";
import { loadItad } from "./sources/itad.js";
import { loadFanatical } from "./sources/fanatical.js";
import { loadTwoGame } from "./sources/two-game.js";
import { loadFx } from "./sources/fx.js";

export const STATE_KEY = "monitor-state-v1";
export const emptyState = () => ({ version: 1, entries: {}, mapping: {}, health: {}, fx: null });
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
function validSnapshot(state) {
  return record(state) && state.version === 1 && record(state.entries) && record(state.mapping) && record(state.health) &&
    Object.keys(state.entries).length <= 200 && Object.entries(state.entries).every(([id, entry]) =>
      /^\d{1,16}$/.test(id) && record(entry) && typeof entry.title === "string" && entry.title.length <= 2000 &&
      Array.isArray(entry.offers) && entry.offers.length <= 512 && entry.offers.every(record)) &&
    Object.keys(state.mapping).length <= 200 && Object.keys(state.health).length <= 32;
}

export function validateConfig(env, delivery = false) {
  if (!/^\d{17}$/.test(env.STEAM_ID ?? "")) throw new SourceError("config", "invalid_steam_id");
  if ((env.COUNTRY ?? "TH") !== "TH") throw new SourceError("config", "only_thailand_is_configured");
  if (!env.ITAD_API_KEY?.trim()) throw new SourceError("config", "missing_ITAD_API_KEY");
  if (!/^[A-Z]{2}$/.test(env.REFERENCE_COUNTRY ?? "US")) throw new SourceError("config", "invalid_reference_country");
  if (delivery && (!/^\d+:[A-Za-z0-9_-]+$/.test(env.TELEGRAM_BOT_TOKEN ?? "") || !/^[1-9]\d{0,15}$/.test(env.TELEGRAM_CHAT_ID ?? "") ||
    Number(env.TELEGRAM_CHAT_ID) > 2 ** 52 - 1)) throw new SourceError("config", "missing_or_invalid_private_telegram_credentials");
  if (!env.DEALS_KV?.get || !env.DEALS_KV?.put) throw new SourceError("config", "missing_state_storage");
}

export async function readState(storage, now = Date.now()) {
  const text = await storage.get(STATE_KEY);
  if (text === null || text === undefined) return emptyState();
  if (typeof text === "string" && text.length > 4 * 1024 * 1024) throw new SourceError("state", "state_too_large_do_not_reset");
  let state;
  try { state = typeof text === "string" ? JSON.parse(text) : text; } catch { throw new SourceError("state", "invalid_json_do_not_reset"); }
  if (!validSnapshot(state)) throw new SourceError("state", "unknown_schema_do_not_reset");
  const outbox = state.outbox;
  if (outbox !== undefined && (!record(outbox) || !Number.isSafeInteger(outbox.createdAt) || outbox.createdAt < 0 || outbox.createdAt > now + 300000 ||
    !Array.isArray(outbox.messages) || outbox.messages.length < 1 || outbox.messages.length > 100 ||
    outbox.messages.some(message => typeof message !== "string" || !message.length || message.length > 4096) ||
    !Number.isSafeInteger(outbox.cursor) || outbox.cursor < 0 || outbox.cursor > outbox.messages.length ||
    !validSnapshot(outbox.commit) || outbox.commit.outbox !== undefined)) throw new SourceError("state", "invalid_outbox_do_not_reset");
  return state;
}

async function save(storage, state) {
  const serialized = JSON.stringify(state);
  if (serialized.length > 4 * 1024 * 1024) throw new SourceError("state", "state_too_large_do_not_reset");
  await storage.put(STATE_KEY, serialized);
}

function healthUpdate(previous, failures, now, threshold, checked = null) {
  const health = {};
  const notices = [];
  for (const key of new Set([...Object.keys(previous), ...Object.keys(failures)])) {
    if (checked && !checked.has(key)) { health[key] = previous[key]; continue; }
    if (failures[key]) {
      const failuresCount = (previous[key]?.failures ?? 0) + 1;
      const notified = previous[key]?.notified === true;
      health[key] = { failures: failuresCount, code: failures[key], notified: notified || failuresCount >= threshold, at: now };
      if (failuresCount >= threshold && !notified) notices.push(`Monitoring issue: ${key} failed ${failuresCount} checks. ${failures[key]}. Affected comparisons are paused and will retry hourly.`);
    } else if (previous[key]?.notified) {
      notices.push(`Monitoring recovered: ${key}.`);
    }
  }
  return { health, notices };
}

async function flushOutbox(env, http, state, now) {
  if (!state.outbox) return state;
  if (now - state.outbox.createdAt > 2 * 3600000) {
    delete state.outbox;
    await save(env.DEALS_KV, state);
    return state;
  }
  for (; state.outbox.cursor < state.outbox.messages.length;) {
    await sendMessage(http, env, state.outbox.messages[state.outbox.cursor]);
    state.outbox.cursor++;
    await save(env.DEALS_KV, state);
  }
  const committed = state.outbox.commit;
  await save(env.DEALS_KV, committed);
  return committed;
}

async function commitWithMessages(env, http, state, next, messages, now) {
  if (!messages.length) { await save(env.DEALS_KV, next); return next; }
  const pending = { ...state, outbox: { createdAt: now, cursor: 0, messages, commit: next } };
  await save(env.DEALS_KV, pending);
  return flushOutbox(env, http, pending, now);
}

export async function collect(http, env, state, now) {
  const ids = await loadWishlist(http, env.STEAM_ID);
  const games = await loadSteam(http, ids, env.COUNTRY ?? "TH");
  const itad = await loadItad(http, games, env.ITAD_API_KEY, state.mapping, env.REFERENCE_COUNTRY ?? "US", now);
  const failures = {};
  const warnings = [];
  const stores = [];
  if (env.ENABLE_FANATICAL !== "false") {
    try {
      await loadFanatical(http, games);
      stores.push("Fanatical");
    } catch (error) {
      failures.fanatical = codeOf(error);
      // Do not mistake a failed direct source for its offers ending.
      for (const game of games) game.complete = false;
    }
  }
  if (env.ENABLE_2GAME !== "false") {
    try {
      const twoGame = await loadTwoGame(http, games);
      if (twoGame.covered.length) stores.push("2Game");
      if (twoGame.failures.length) failures["2game"] = codeOf(twoGame.failures[0].error);
      warnings.push(`2Game has validated mappings for ${twoGame.covered.length}/${games.length} wishlist products`);
    } catch (error) {
      failures["2game"] = codeOf(error);
      for (const game of games) game.complete = false;
    }
  }
  if (itad.gaps.length) warnings.push(`${itad.gaps.length} products lack unambiguous feed identity; direct sources only`);
  const fx = await loadFx(http, games.flatMap(game => game.offers.map(offer => offer.currency)), state.fx, now);
  const plan = planAlerts(games, state.entries, fx, now);
  if (plan.skipped.length) warnings.push(`${plan.skipped.length} product comparisons paused`);
  if (plan.skipped.some(item => item.reason.startsWith("Missing reference rate"))) failures.fx = "missing_currency_rates";
  for (const game of games) if (!game.complete && !Object.keys(failures).length) failures.steam_products = "product_unavailable_or_metadata_changed";
  const mapping = Object.fromEntries(ids.filter(id => itad.mapping[id]).map(id => [id, itad.mapping[id]]));
  return { ...plan, mapping, games, fx, failures, warnings, stores, shops: itad.shops };
}

export async function runMonitor(env, { fetcher = fetch, now = Date.now(), deliver = true } = {}) {
  validateConfig(env, deliver);
  const http = client(fetcher);
  let state = await readState(env.DEALS_KV, now);
  if (state.outbox && deliver) state = await flushOutbox(env, http, state, now);
  let result;
  try {
    result = await collect(http, env, state, now);
  } catch (error) {
    if (!deliver) throw error;
    const source = error instanceof SourceError ? error.source : "monitor";
    // Preserve every baseline after a failed required source; only health advances.
    const { health, notices } = healthUpdate(state.health, { [source]: codeOf(error) }, now, Number(env.FAILURE_NOTICE_AFTER ?? 3), new Set([source]));
    const next = { ...state, health, lastAttempt: new Date(now).toISOString() };
    await commitWithMessages(env, http, state, next, notices.map(escapeHtml), now);
    return { ok: false, error: codeOf(error), requests: http.requests };
  }
  const { health, notices } = healthUpdate(state.health, result.failures, now, Number(env.FAILURE_NOTICE_AFTER ?? 3));
  const next = { version: 1, entries: result.entries, mapping: result.mapping, fx: result.fx, health,
    lastAttempt: new Date(now).toISOString(), lastSuccess: new Date(now).toISOString() };
  const messages = [
    ...formatDigest(result.alerts, { checkedAt: new Date(now).toISOString(), fx: result.fx, stores: result.stores, warnings: result.warnings }),
    ...notices.map(escapeHtml)
  ];
  if (deliver) await commitWithMessages(env, http, state, next, messages, now);
  return { ok: true, wishlistCount: result.games.length, compared: result.games.length - result.skipped.length, alertCount: result.alerts.length,
    messages, warnings: result.warnings, retailers: [...new Set(result.games.flatMap(game => game.offers.map(offer => offer.shop)))],
    requests: http.requests, fxDate: result.fx.date, delivered: deliver };
}
