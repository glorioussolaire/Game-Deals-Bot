import test from "node:test";
import assert from "node:assert/strict";
import { handleTelegram, savedDeals, COMMAND_PREFIX } from "../src/commands.js";
import { runMonitor, STATE_KEY, emptyState } from "../src/monitor.js";
import { client } from "../src/http.js";
import { fixture, now } from "./fixture.js";
import { deploymentWebhookUrl, registerWebhook } from "../scripts/telegram-webhook.mjs";

const secret = "TEST_WEBHOOK_SECRET_abcdefghijklmnopqrstuvwxyz1234";
const wait = async () => {};
function update(id = 1, timestamp = now, text = "/deals") {
  return { update_id: id, message: { message_id: id, date: Math.floor(timestamp / 1000), text,
    chat: { id: 123456, type: "private" }, from: { id: 123456, is_bot: false } } };
}
function request(value = update(), headers = {}, url = "https://bot.example/telegram") {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json",
    "X-Telegram-Bot-Api-Secret-Token": secret, ...headers }, body: JSON.stringify(value) });
}
async function commandFixture() {
  const f = fixture();
  await runMonitor(f.env, { fetcher: f.fetcher, now });
  f.controls.sent.length = 0;
  f.controls.attempts = 0;
  const extra = new Map(), reads = [];
  const priceStorage = f.env.DEALS_KV;
  const env = { ...f.env, TELEGRAM_WEBHOOK_SECRET: secret, DEALS_KV: {
    async get(key) { reads.push(key); return key === STATE_KEY ? priceStorage.get(key) : extra.get(key) ?? null; },
    async put(key, value) { assert.notEqual(key, STATE_KEY, "Commands must never advance monitor state"); extra.set(key, value); }
  } };
  const fetcher = async (...args) => {
    assert.equal(new URL(args[0]).hostname, "api.telegram.org", "Commands must not query retailers");
    return f.fetcher(...args);
  };
  return { f, env, extra, reads, options: { fetcher, now, wait } };
}

test("/deals restores all previously alerted discounts without modifying hourly history", async () => {
  const c = await commandFixture();
  const before = JSON.stringify(c.f.state);
  assert.equal((await handleTelegram(request(), c.env, c.options)).status, 200);
  assert.equal(c.f.controls.sent.length, 1);
  assert.match(c.f.controls.sent[0], /All wishlist discounts/);
  assert.match(c.f.controls.sent[0], /Mount &amp; Blade II: Bannerlord/);
  assert.match(c.f.controls.sent[0], /Undernauts: Labyrinth of Yomi/);
  assert.match(c.f.controls.sent[0], /Last compared:/);
  assert.equal(JSON.stringify(c.f.state), before);
  // A fresh command after clearing the conversation can restore it again.
  await handleTelegram(request(update(2, now + 11000)), c.env, { ...c.options, now: now + 11000 });
  assert.equal(c.f.controls.sent.length, 2);
  assert.equal(JSON.stringify(c.f.state), before);
  const hourly = await runMonitor(c.f.env, { fetcher: c.f.fetcher, now: now + 3600000 });
  assert.equal(hourly.alertCount, 0);
  assert.equal(c.f.controls.sent.length, 2);
});

test("repeated webhook updates are acknowledged without repeating a completed response", async () => {
  const c = await commandFixture();
  await handleTelegram(request(), c.env, c.options);
  await handleTelegram(request(), c.env, c.options);
  assert.equal(c.f.controls.sent.length, 1);
  const saved = JSON.parse(c.extra.get(COMMAND_PREFIX + "1"));
  assert.equal(saved.cursor, saved.messages.length);
});

test("authentication, method, and path checks happen before reading state or calling Telegram", async () => {
  const c = await commandFixture();
  for (const req of [request(update(), { "X-Telegram-Bot-Api-Secret-Token": "wrong" }),
    request(update(), {}, "https://bot.example/run"), new Request("https://bot.example/telegram"),
    request(update(), { "X-Telegram-Bot-Api-Secret-Token": "" })]) {
    assert.equal((await handleTelegram(req, c.env, c.options)).status, 404);
  }
  assert.equal((await handleTelegram(request(), { ...c.env, TELEGRAM_WEBHOOK_SECRET: "" }, c.options)).status, 404);
  assert.equal(c.reads.length, 0);
  assert.equal(c.f.controls.attempts, 0);
});

test("only fresh commands from the configured private human sender are accepted", async () => {
  const c = await commandFixture();
  for (const changed of [{ chat: { id: -123456, type: "group" } }, { chat: { id: 999999, type: "private" } },
    { from: { id: 999999, is_bot: false } }, { from: { id: 123456, is_bot: true } },
    { forward_origin: { type: "user" } }, { via_bot: { id: 12 } }, { date: now / 1000 - 601 },
    { date: now / 1000 + 61 }, { text: "/deals reset" }, { text: "ordinary text" }]) {
    const value = update();
    Object.assign(value.message, changed);
    assert.equal((await handleTelegram(request(value), c.env, c.options)).status, 200);
  }
  await handleTelegram(request({ update_id: 1, edited_message: update().message }), c.env, c.options);
  assert.equal(c.reads.length, 0);
  assert.equal(c.f.controls.attempts, 0);
});

test("authenticated webhook payloads are bounded and must contain valid JSON", async () => {
  const c = await commandFixture();
  const headers = { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret };
  for (const [body, status] of [["{", 400], [" ".repeat(16385), 413]]) {
    const response = await handleTelegram(new Request("https://bot.example/telegram", { method: "POST", headers, body }), c.env, c.options);
    assert.equal(response.status, status);
  }
  assert.equal((await handleTelegram(request(update(), { "Content-Type": "text/plain" }), c.env, c.options)).status, 415);
  assert.equal(c.reads.length, 0);
});

test("/start and /help explain restoration and a short cooldown limits duplicate requests", async () => {
  const c = await commandFixture();
  await handleTelegram(request(update(1, now, "/start")), c.env, c.options);
  assert.match(c.f.controls.sent[0], /\/deals/);
  await handleTelegram(request(update(2, now + 1000)), c.env, { ...c.options, now: now + 1000 });
  assert.equal(c.f.controls.sent.length, 1);
  await handleTelegram(request(update(3, now + 11000, "/help")), c.env, { ...c.options, now: now + 11000 });
  assert.equal(c.f.controls.sent.length, 2);
});

test("saved lists identify paused prices and omit expired offers or over-age data", async () => {
  const c = await commandFixture();
  const state = c.f.state;
  state.entries[261550].checkedAt = new Date(now - 3600000).toISOString();
  let messages = savedDeals(state, now);
  assert.match(messages.join("\n"), /earlier prices after paused comparisons/);
  assert.match(messages.join("\n"), /2026-10-18 09:00 UTC/);
  state.entries[261550].checkedAt = new Date(now - 86400001).toISOString();
  state.entries[1570510].offers.forEach(offer => { offer.expiresAt = new Date(now - 1).toISOString(); });
  messages = savedDeals(state, now);
  assert.doesNotMatch(messages.join("\n"), /Mount &amp; Blade|Undernauts/);
  assert.match(messages.join("\n"), /too old/);
  state.entries[1570510].offers.forEach(offer => { delete offer.expiresAt; });
  state.fx.date = "2000-01-01";
  assert.doesNotMatch(savedDeals(state, now).join("\n"), /Undernauts/);
  assert.match(savedDeals(emptyState(), now)[0], /No saved wishlist prices/);
});

test("multi-part command retries resume after acknowledged parts", async () => {
  const c = await commandFixture();
  const state = c.f.state;
  const sample = structuredClone(state.entries[261550]);
  state.entries = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [String(1000 + i),
    { ...sample, title: "Long wishlist game " + i + " & <edition> " + "x".repeat(100) }]));
  c.f.state = state;
  c.f.controls.failSend = 2;
  assert.equal((await handleTelegram(request(), c.env, c.options)).status, 503);
  assert.equal(c.f.controls.sent.length, 1);
  assert.equal(JSON.parse(c.extra.get(COMMAND_PREFIX + "1")).cursor, 1);
  const first = c.f.controls.sent[0];
  assert.equal((await handleTelegram(request(), c.env, c.options)).status, 200);
  assert.equal(c.f.controls.sent.filter(text => text === first).length, 1);
  assert.ok(c.f.controls.sent.length > 1);
  assert.ok(c.f.controls.sent.every(text => text.length <= 4096));
  assert.ok(c.f.controls.sent.every(text => !text.includes("<edition>")));
});

test("corrupted command checkpoints fail closed without sending or changing price state", async () => {
  const c = await commandFixture();
  c.extra.set(COMMAND_PREFIX + "1", JSON.stringify({ messages: ["secret"], cursor: -1 }));
  const before = JSON.stringify(c.f.state);
  assert.equal((await handleTelegram(request(), c.env, c.options)).status, 503);
  assert.equal(c.f.controls.sent.length, 0);
  assert.equal(JSON.stringify(c.f.state), before);
});

test("registration uses a private command menu, secret header and one webhook connection", async () => {
  const c = await commandFixture();
  const calls = [];
  const http = client(async (url, options) => {
    calls.push({ method: new URL(url).pathname.split("/").at(-1), body: JSON.parse(options.body) });
    return Response.json({ ok: true, result: calls.length === 1 ? { id: 123456, type: "private" } : true });
  });
  await registerWebhook(c.env, "https://wishlist.example.workers.dev/telegram", http);
  assert.equal(calls[1].method, "setMyCommands");
  assert.deepEqual(calls[1].body.scope, { type: "chat", chat_id: "123456" });
  assert.deepEqual(calls[2].body.allowed_updates, ["message"]);
  assert.equal(calls[2].body.secret_token, secret);
  assert.equal(calls[2].body.max_connections, 1);
  assert.equal(calls[2].body.drop_pending_updates, false);
  assert.equal(deploymentWebhookUrl("Uploaded\n https://wishlist.example.workers.dev\n schedule: 0 * * * *", "wishlist"),
    "https://wishlist.example.workers.dev/telegram");
  assert.throws(() => deploymentWebhookUrl("https://other.example.workers.dev", "wishlist"));
  assert.throws(() => deploymentWebhookUrl("https://wishlist.example.workers.dev.evil.example", "wishlist"));
  await assert.rejects(registerWebhook(c.env, "https://evil.example/telegram", http), /invalid_webhook_configuration/);
});
