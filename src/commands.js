import { client, readText, SourceError } from "./http.js";
import { readState, validateConfig } from "./monitor.js";
import { cheapest, discounted, eligible } from "./engine.js";
import { freshDate } from "./sources/fx.js";
import { formatDigest, sendMessage } from "./telegram.js";
import { paceStateStorage } from "./storage.js";

export const COMMAND_PREFIX = "telegram-command-v1:";
const RATE_KEY = "telegram-command-rate-v1";
const HELP = "Send /deals to see all discounts from the latest saved hourly checks, including offers already alerted. " +
  "Each game shows its check time. Clearing Telegram chat history does not reset hourly alerts.\n\n" +
  "Hourly alerts continue to report new discounts and further price drops.";
const ACK = () => new Response("OK");
let inFlight;

export function savedDeals(state, now = Date.now()) {
  const deals = [], stores = new Set(), warnings = [];
  let unavailable = 0, paused = 0;
  for (const entry of Object.values(state.entries)) {
    const timestamp = Date.parse(entry.checkedAt);
    if (!Number.isFinite(timestamp) || timestamp > now || now - timestamp > 86400000) { unavailable++; continue; }
    if (entry.checkedAt !== state.lastSuccess) paused++;
    const offers = entry.offers.filter(offer => eligible(offer, now));
    for (const offer of offers) {
      if (offer.source === "fanatical") stores.add("Fanatical");
      if (offer.source === "2game") stores.add("2Game");
    }
    // A stale/invalid FX snapshot must not silently omit a cheaper foreign offer.
    if (offers.some(offer => offer.currency !== "THB") &&
      (!freshDate(state.fx?.date, now) || state.fx?.rates?.EUR !== 1 ||
        !Number.isFinite(state.fx?.fetchedAt) || state.fx.fetchedAt > now ||
        offers.some(offer => offer.currency !== "THB" &&
          (!Number.isFinite(state.fx.rates[offer.currency]) || state.fx.rates[offer.currency] <= 0)) ||
        !Number.isFinite(state.fx.rates.THB) || state.fx.rates.THB <= 0)) { unavailable++; continue; }
    const best = cheapest(offers, state.fx);
    if (best?.error) { unavailable++; continue; }
    if (best && discounted(best.offer)) deals.push({ title: entry.title, ...best, observedAt: entry.checkedAt });
  }
  if (paused) warnings.push(`${paused} products retain earlier prices after paused comparisons; check their timestamps`);
  if (unavailable) warnings.push(`${unavailable} products omitted because saved prices or exchange rates are unavailable or too old`);
  const failureCount = Object.keys(state.health).length;
  if (failureCount) warnings.push(`${failureCount} price sources reported an issue on the last check`);
  warnings.push("2Game covers only explicitly mapped products");
  deals.sort((a, b) => a.title.localeCompare(b.title));
  const messages = formatDigest(deals, { fx: freshDate(state.fx?.date, now) ? state.fx : null,
    stores: [...stores], warnings, snapshot: true });
  if (!messages.length) {
    messages.push(Object.keys(state.entries).length && !unavailable && !paused && !failureCount ?
      "No discounted offers in the latest saved hourly prices. Prices refresh on the hourly check." : Object.keys(state.entries).length ?
      "No discounted offers could be shown from the usable saved prices. This does not mean every game is full price. " +
      "Prices refresh on the hourly check.\n" + warnings.join("; ") :
      "No saved wishlist prices yet. Try /deals after the first successful hourly check.");
  }
  return messages;
}

function secretMatches(expected, provided) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(expected ?? "") || provided?.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return difference === 0;
}

function privateCommand(update, env, now) {
  const message = update?.message;
  if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0 ||
    message?.chat?.type !== "private" || !Number.isSafeInteger(message.chat.id) || message.chat.id <= 0 ||
    String(message.chat.id) !== env.TELEGRAM_CHAT_ID || message.from?.id !== message.chat.id || message.from?.is_bot !== false ||
    message.forward_origin || message.via_bot || !Number.isSafeInteger(message.date) ||
    now - message.date * 1000 > 600000 || message.date * 1000 > now + 60000 ||
    typeof message.text !== "string" || message.text.length > 128) return null;
  return message.text.match(/^\/(deals|start|help)(?:@[A-Za-z0-9_]{5,32})?\s*$/)?.[1] ?? null;
}

async function commandJob(update, command, env, { fetcher, now, wait }) {
  validateConfig(env, true);
  const storage = paceStateStorage(env.DEALS_KV, wait ? { wait } : {});
  const key = COMMAND_PREFIX + update.update_id;
  const existing = await storage.get(key);
  let job;
  if (existing != null) {
    if (typeof existing !== "string" || existing.length > 420000) throw new SourceError("telegram_commands", "invalid_command_state");
    try { job = JSON.parse(existing); } catch { throw new SourceError("telegram_commands", "invalid_command_state"); }
    if (!job || !Array.isArray(job.messages) || job.messages.length < 1 || job.messages.length > 100 ||
      job.messages.some(message => typeof message !== "string" || !message.length || message.length > 4096) ||
      !Number.isSafeInteger(job.cursor) || job.cursor < 0 || job.cursor > job.messages.length) {
      throw new SourceError("telegram_commands", "invalid_command_state");
    }
  } else {
    const previous = await storage.get(RATE_KEY);
    if (previous != null) {
      const timestamp = Number(previous);
      if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > now) throw new SourceError("telegram_commands", "invalid_command_rate_state");
      if (now - timestamp < 10000) return ACK();
    }
    const messages = command === "deals" ? savedDeals(await readState(storage, now), now) : [HELP];
    job = { messages, cursor: 0 };
    await storage.put(RATE_KEY, String(now), { expirationTtl: 60 });
    await storage.put(key, JSON.stringify(job), { expirationTtl: 86400 });
  }
  const http = client(fetcher);
  while (job.cursor < job.messages.length) {
    await sendMessage(http, env, job.messages[job.cursor]);
    job.cursor++;
    await storage.put(key, JSON.stringify(job), { expirationTtl: 86400 });
  }
  return ACK();
}

export async function handleTelegram(request, env, { fetcher = fetch, now = Date.now(), wait } = {}) {
  if (new URL(request.url).pathname !== "/telegram" || request.method !== "POST" ||
    !secretMatches(env?.TELEGRAM_WEBHOOK_SECRET, request.headers.get("X-Telegram-Bot-Api-Secret-Token"))) {
    return new Response("Not found", { status: 404 });
  }
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return new Response("Unsupported content type", { status: 415 });
  }
  let update;
  try { update = JSON.parse(await readText("telegram_commands", request, 16384)); }
  catch (error) { return new Response("Invalid update", { status: error.code === "response_too_large" ? 413 : 400 }); }
  const command = privateCommand(update, env, now);
  if (!command) return ACK();
  // Telegram is configured for one webhook connection. Also serialize retries
  // in this isolate; KV checkpoints are not a distributed exactly-once lock.
  if (inFlight) return new Response("Retry later", { status: 503 });
  const operation = commandJob(update, command, env, { fetcher, now, wait });
  inFlight = operation;
  try { return await operation; }
  catch (error) {
    console.error(JSON.stringify({ event: "telegram_command_failure", code: error.name === "SourceError" ? error.message : "unexpected_error" }));
    return new Response("Retry later", { status: 503 });
  } finally { if (inFlight === operation) inFlight = undefined; }
}
