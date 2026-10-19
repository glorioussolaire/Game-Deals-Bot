import test from "node:test";
import assert from "node:assert/strict";
import { runMonitor, emptyState, validateConfig, readState } from "../src/monitor.js";
import { fixture, now } from "./fixture.js";
import worker from "../src/worker.js";

test("complete monitor: first digest, unchanged silence, and a genuine subsequent reduction", async () => {
  const f = fixture();
  let result = await runMonitor(f.env, { fetcher: f.fetcher, now });
  assert.equal(result.alertCount, 2);
  assert.equal(result.compared, 2);
  assert.equal(f.controls.sent.length, 1);
  assert.match(f.controls.sent[0], /Thailand activation unverified/);
  assert.ok(f.state.entries[261550]);
  result = await runMonitor(f.env, { fetcher: f.fetcher, now: now + 3600000 });
  assert.equal(result.alertCount, 0);
  assert.equal(f.controls.sent.length, 1);
  f.controls.price = 19;
  result = await runMonitor(f.env, { fetcher: f.fetcher, now: now + 7200000 });
  assert.equal(result.alertCount, 2);
  assert.equal(f.controls.sent.length, 2);
});

test("preview neither sends nor advances alert history", async () => {
  const f = fixture();
  const result = await runMonitor(f.env, { fetcher: f.fetcher, now, deliver: false });
  assert.equal(result.alertCount, 2);
  assert.equal(f.state, null);
  assert.equal(f.controls.sent.length, 0);
});

test("failed delivery retains a resumable outbox and never consumes unsent alerts", async () => {
  const f = fixture();
  f.controls.failSend = 1;
  await assert.rejects(() => runMonitor(f.env, { fetcher: f.fetcher, now }), /HTTP 429/);
  assert.equal(f.state.outbox.cursor, 0);
  assert.deepEqual(f.state.entries, {});
  assert.equal(f.controls.sent.length, 0);
  await runMonitor(f.env, { fetcher: f.fetcher, now: now + 60000 });
  assert.equal(f.controls.sent.length, 1);
  assert.equal(f.state.outbox, undefined);
  assert.equal(Object.keys(f.state.entries).length, 2);
});

test("a multi-part retry resumes after acknowledged parts instead of resending them", async () => {
  const f = fixture();
  f.state = { ...emptyState(), outbox: { createdAt: now, cursor: 0, messages: ["part one", "part two"], commit: emptyState() } };
  f.controls.failSend = 2;
  await assert.rejects(() => runMonitor(f.env, { fetcher: f.fetcher, now }), /HTTP 429/);
  assert.equal(f.state.outbox.cursor, 1);
  await runMonitor(f.env, { fetcher: f.fetcher, now: now + 60000 });
  assert.equal(f.controls.sent.filter(text => text === "part one").length, 1);
  assert.equal(f.controls.sent.filter(text => text === "part two").length, 1);
});

test("a required-feed outage preserves prices, reports once after three checks and recovers quietly", async () => {
  const f = fixture();
  await runMonitor(f.env, { fetcher: f.fetcher, now });
  const baseline = f.state.entries;
  f.controls.itadFailure = true;
  for (let i = 1; i <= 4; i++) await runMonitor(f.env, { fetcher: f.fetcher, now: now + i * 3600000 });
  assert.deepEqual(f.state.entries, baseline);
  assert.equal(f.controls.sent.filter(text => text.includes("Monitoring issue")).length, 1);
  f.controls.itadFailure = false;
  const result = await runMonitor(f.env, { fetcher: f.fetcher, now: now + 5 * 3600000 });
  assert.equal(result.alertCount, 0);
  assert.equal(f.controls.sent.filter(text => text.includes("Monitoring recovered")).length, 1);
  assert.ok(!JSON.stringify(f.state).includes("TEST_SECRET"));
});

test("a failed private wishlist does not clear old products", async () => {
  const f = fixture();
  await runMonitor(f.env, { fetcher: f.fetcher, now });
  const entries = f.state.entries;
  f.controls.wishlistFailure = true;
  const result = await runMonitor(f.env, { fetcher: f.fetcher, now: now + 3600000 });
  assert.equal(result.ok, false);
  assert.deepEqual(f.state.entries, entries);
});

test("missing feed credentials and group chats fail before any network call", () => {
  const f = fixture();
  assert.throws(() => validateConfig({ ...f.env, ITAD_API_KEY: "" }), /missing_ITAD_API_KEY/);
  assert.throws(() => validateConfig({ ...f.env, TELEGRAM_CHAT_ID: "-12345" }, true), /private_telegram_credentials/);
});

test("corrupt persisted state fails closed instead of replaying every first-run alert", async () => {
  await assert.rejects(() => readState({ get: async () => "bad json" }), /do_not_reset/);
  await assert.rejects(() => readState({ get: async () => '{"version":2}' }), /do_not_reset/);
});

test("the deployed HTTP handler exposes no manual triggers or personal data", async () => {
  const response = await worker.fetch(new Request("https://example.com/run?token=wrong"));
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not found");
});
