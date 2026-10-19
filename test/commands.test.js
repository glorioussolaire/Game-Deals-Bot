import test from "node:test";
import assert from "node:assert/strict";
import { runCommand, savedDeals, COMMAND_PREFIX } from "../src/commands.js";
import { runMonitor, STATE_KEY, emptyState } from "../src/monitor.js";
import { client } from "../src/http.js";
import { fixture, now } from "./fixture.js";
import { registerPolling, privateWorkerConfig } from "../scripts/telegram-settings.mjs";
import { pollTelegram } from "../src/polling.js";
import worker from "../src/worker.js";

const wait = async () => {};
function update(id = 1, timestamp = now, text = "/deals") {
  return { update_id: id, message: { message_id: id, date: Math.floor(timestamp / 1000), text,
    chat: { id: 123456, type: "private" }, from: { id: 123456, is_bot: false } } };
}
async function commandFixture() {
  const f = fixture();
  await runMonitor(f.env, { fetcher: f.fetcher, now });
  f.controls.sent.length = 0;
  f.controls.attempts = 0;
  const extra = new Map(), reads = [];
  const priceStorage = f.env.DEALS_KV;
  const env = { ...f.env, DEALS_KV: {
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
  assert.equal(await runCommand(update(), c.env, c.options), true);
  assert.equal(c.f.controls.sent.length, 1);
  assert.match(c.f.controls.sent[0], /All wishlist discounts/);
  assert.match(c.f.controls.sent[0], /Mount &amp; Blade II: Bannerlord/);
  assert.match(c.f.controls.sent[0], /Undernauts: Labyrinth of Yomi/);
  assert.match(c.f.controls.sent[0], /Last compared:/);
  assert.equal(JSON.stringify(c.f.state), before);
  // A fresh command after clearing the conversation can restore it again.
  await runCommand(update(2, now + 11000), c.env, { ...c.options, now: now + 11000 });
  assert.equal(c.f.controls.sent.length, 2);
  assert.equal(JSON.stringify(c.f.state), before);
  const hourly = await runMonitor(c.f.env, { fetcher: c.f.fetcher, now: now + 3600000 });
  assert.equal(hourly.alertCount, 0);
  assert.equal(c.f.controls.sent.length, 2);
});

test("repeated polled updates are acknowledged without repeating a completed response", async () => {
  const c = await commandFixture();
  await runCommand(update(), c.env, c.options);
  await runCommand(update(), c.env, c.options);
  assert.equal(c.f.controls.sent.length, 1);
  const saved = JSON.parse(c.extra.get(COMMAND_PREFIX + "1"));
  assert.equal(saved.cursor, saved.messages.length);
});

test("HTTP never accepts commands or touches secrets, state or Telegram", async () => {
  const env = new Proxy({}, { get() { throw new Error("HTTP must not access bindings"); } });
  for (const path of ["/", "/telegram", "/run"]) {
    for (const method of ["GET", "POST"]) {
      assert.equal((await worker.fetch(new Request("https://bot.example" + path, { method }), env)).status, 404);
    }
  }
});

test("only fresh commands from the configured private human sender are accepted", async () => {
  const c = await commandFixture();
  for (const changed of [{ chat: { id: -123456, type: "group" } }, { chat: { id: 999999, type: "private" } },
    { from: { id: 999999, is_bot: false } }, { from: { id: 123456, is_bot: true } },
    { forward_origin: { type: "user" } }, { via_bot: { id: 12 } }, { date: now / 1000 - 601 },
    { date: now / 1000 + 61 }, { text: "/deals reset" }, { text: "ordinary text" }]) {
    const value = update();
    Object.assign(value.message, changed);
    assert.equal(await runCommand(value, c.env, c.options), false);
  }
  await runCommand({ update_id: 1, edited_message: update().message }, c.env, c.options);
  assert.equal(c.reads.length, 0);
  assert.equal(c.f.controls.attempts, 0);
});

test("/start and /help explain restoration and a short cooldown limits duplicate requests", async () => {
  const c = await commandFixture();
  await runCommand(update(1, now, "/start"), c.env, c.options);
  assert.match(c.f.controls.sent[0], /\/deals/);
  await runCommand(update(2, now + 1000), c.env, { ...c.options, now: now + 1000 });
  assert.equal(c.f.controls.sent.length, 1);
  await runCommand(update(3, now + 11000, "/help"), c.env, { ...c.options, now: now + 11000 });
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
  await assert.rejects(runCommand(update(), c.env, c.options));
  assert.equal(c.f.controls.sent.length, 1);
  assert.equal(JSON.parse(c.extra.get(COMMAND_PREFIX + "1")).cursor, 1);
  const first = c.f.controls.sent[0];
  assert.equal(await runCommand(update(), c.env, c.options), true);
  assert.equal(c.f.controls.sent.filter(text => text === first).length, 1);
  assert.ok(c.f.controls.sent.length > 1);
  assert.ok(c.f.controls.sent.every(text => text.length <= 4096));
  assert.ok(c.f.controls.sent.every(text => !text.includes("<edition>")));
});

test("corrupted command checkpoints fail closed without sending or changing price state", async () => {
  const c = await commandFixture();
  c.extra.set(COMMAND_PREFIX + "1", JSON.stringify({ messages: ["secret"], cursor: -1 }));
  const before = JSON.stringify(c.f.state);
  await assert.rejects(runCommand(update(), c.env, c.options));
  assert.equal(c.f.controls.sent.length, 0);
  assert.equal(JSON.stringify(c.f.state), before);
});

test("registration removes the webhook, keeps queued updates and scopes the menu privately", async () => {
  const c = await commandFixture();
  const calls = [];
  const http = client(async (url, options) => {
    const method = new URL(url).pathname.split("/").at(-1);
    calls.push({ method, body: JSON.parse(options.body) });
    return Response.json({ ok: true, result: method === "getChat" ? { id: 123456, type: "private" } :
      method === "getWebhookInfo" ? { url: "" } : true });
  });
  await registerPolling(c.env, http);
  assert.deepEqual(calls.map(c => c.method), ["getChat", "setMyCommands", "deleteWebhook", "getWebhookInfo"]);
  assert.deepEqual(calls[1].body.scope, { type: "chat", chat_id: "123456" });
  assert.equal(calls[2].body.drop_pending_updates, false);
  await assert.rejects(registerPolling(c.env, client(async () => Response.json({ ok: true, result: { id: 123456, type: "group" } }))), /private_recipient_mismatch/);
  const config = { vars: { STEAM_ID: "existing-profile" }, kv_namespaces: [{ id: "existing-history" }], workers_dev: true, routes: ["old.example/*"] };
  const hardened = privateWorkerConfig(config);
  assert.equal(hardened.workers_dev, false);
  assert.equal(hardened.preview_urls, false);
  assert.deepEqual(hardened.routes, []);
  assert.deepEqual(hardened.triggers.crons, ["0 * * * *", "* * * * *"]);
  assert.deepEqual(hardened.kv_namespaces, config.kv_namespaces);
  assert.deepEqual(hardened.vars, config.vars);
});

function pollingFixture(c, batch, ackBatch = []) {
  const calls = [];
  const options = { ...c.options, fetcher: async (url, init) => {
    if (new URL(url).pathname.endsWith("/getUpdates")) {
      const body = JSON.parse(init.body);
      calls.push(body);
      return Response.json({ ok: true, result: body.offset === undefined ? batch : ackBatch });
    }
    return c.options.fetcher(url, init);
  } };
  return { options, calls };
}

test("polling acknowledges only finished batches and leaves new acknowledgement results queued", async () => {
  const c = await commandFixture();
  const before = JSON.stringify(c.f.state);
  const outsider = update(42);
  outsider.message.chat.id = outsider.message.from.id = 999999;
  const p = pollingFixture(c, [update(41), outsider], [update(43, now + 11000)]);
  const result = await pollTelegram(c.env, p.options);
  assert.equal(result.received, 2);
  assert.equal(result.commands, 1);
  assert.equal(c.f.controls.sent.length, 1);
  assert.deepEqual(p.calls, [
    { allowed_updates: ["message"], limit: 100, timeout: 1 },
    { allowed_updates: ["message"], offset: 43, limit: 1, timeout: 0 }
  ]);
  assert.equal(c.extra.has(COMMAND_PREFIX + "43"), false);
  const next = pollingFixture(c, [update(43, now + 11000)]);
  await pollTelegram(c.env, { ...next.options, now: now + 11000 });
  assert.equal(c.f.controls.sent.length, 2);
  assert.equal(JSON.stringify(c.f.state), before);
});

test("idle polls and ignored messages do not read or write KV", async () => {
  const c = await commandFixture();
  const empty = pollingFixture(c, []);
  assert.equal((await pollTelegram(c.env, empty.options)).received, 0);
  assert.equal(empty.calls.length, 1);
  const outsiders = Array.from({ length: 100 }, (_, i) => {
    const u = update(i);
    u.message.chat.id = u.message.from.id = 999999;
    return u;
  });
  const ignored = pollingFixture(c, outsiders);
  await pollTelegram(c.env, ignored.options);
  assert.equal(ignored.calls.length, 2);
  assert.equal(ignored.calls[1].offset, 100);
  assert.equal(c.reads.length, 0);
  assert.equal(c.extra.size, 0);
  assert.equal(c.f.controls.sent.length, 0);
});

test("invalid or unordered Telegram batches fail before processing or acknowledging", async () => {
  const c = await commandFixture();
  for (const batch of [null, {}, Array(101).fill(update()), [update(2), update(1)], [update(1), update(1)],
    [{ update_id: -1 }], [{ update_id: Number.MAX_SAFE_INTEGER }], [update(1), {}]]) {
    const p = pollingFixture(c, batch);
    await assert.rejects(pollTelegram(c.env, p.options), /invalid_updates|invalid_update_order/);
    assert.equal(p.calls.length, 1);
  }
  assert.equal(c.reads.length, 0);
  assert.equal(c.f.controls.sent.length, 0);
});

test("a failed send leaves updates unacknowledged and the next poll retries", async () => {
  const c = await commandFixture();
  c.f.controls.failSend = 1;
  const p = pollingFixture(c, [update()]);
  await assert.rejects(pollTelegram(c.env, p.options), /HTTP 429/);
  assert.equal(p.calls.length, 1);
  assert.equal(c.f.controls.sent.length, 0);
  await pollTelegram(c.env, p.options);
  assert.equal(p.calls.at(-1).offset, 2);
  assert.equal(c.f.controls.sent.length, 1);
});

test("failed acknowledgement retries do not resend a checkpointed response", async () => {
  const c = await commandFixture();
  const p = pollingFixture(c, [update()]);
  const options = { ...p.options, fetcher: async (url, init) => {
    if (new URL(url).pathname.endsWith("/getUpdates") && JSON.parse(init.body).offset !== undefined) throw new Error("offline");
    return p.options.fetcher(url, init);
  } };
  await assert.rejects(pollTelegram(c.env, options), /request_failed/);
  assert.equal(c.f.controls.sent.length, 1);
  await pollTelegram(c.env, p.options);
  assert.equal(c.f.controls.sent.length, 1);
  assert.equal(p.calls.at(-1).offset, 2);
});

test("the minute schedule only polls Telegram; unknown schedules do no work", async () => {
  const c = await commandFixture();
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).hostname, "api.telegram.org");
    calls.push(JSON.parse(init.body));
    return Response.json({ ok: true, result: [] });
  };
  try {
    await worker.scheduled({ cron: "* * * * *" }, c.env);
    assert.equal(calls.length, 1);
    await worker.scheduled({ cron: "unconfigured schedule" }, c.env);
    assert.equal(calls.length, 1);
    assert.equal(c.reads.length, 0);
  } finally { globalThis.fetch = original; }
});

test("overlapping polls in one isolate do not start a second consumer", async () => {
  const c = await commandFixture();
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const options = { ...c.options, fetcher: async () => {
    started();
    await new Promise(resolve => { release = resolve; });
    return Response.json({ ok: true, result: [] });
  } };
  const first = pollTelegram(c.env, options);
  await ready;
  try { await assert.rejects(pollTelegram(c.env, options), /already_running/); }
  finally { release(); await first; }
});
