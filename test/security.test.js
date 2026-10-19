import test from "node:test";
import assert from "node:assert/strict";
import { client, readText, purchaseUrl, safeUrl } from "../src/http.js";
import { eligible } from "../src/engine.js";
import { formatDigest } from "../src/telegram.js";
import { readState, emptyState, runMonitor, validateConfig } from "../src/monitor.js";
import { setupChallenge, setupRecipient } from "../scripts/telegram-setup.mjs";
import { loadFx } from "../src/sources/fx.js";
import { fixture, now } from "./fixture.js";
import { mkdtemp, readFile, writeFile, readdir, rm, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writePrivateFile, assertPrivateDirectory } from "../scripts/private-storage.mjs";

test("privileged requests reject unapproved origins before sending credentials", async () => {
  let calls = 0;
  const http = client(async () => { calls++; return Response.json({}); });
  for (const url of ["http://api.isthereanydeal.com/", "https://api.isthereanydeal.com.evil.example/", "https://127.0.0.1/",
    "https://api.isthereanydeal.com@evil.example/", "https://api.isthereanydeal.com:8443/", "https://api.telegram.org/"]) {
    await assert.rejects(http.json("itad_prices", url, { headers: { "ITAD-API-Key": "TEST_SECRET_KEY" } }), /destination_not_allowed/);
  }
  assert.equal(calls, 0);
});

test("fixed-origin requests reject redirects without forwarding credentials", async () => {
  const calls = [];
  const http = client(async (url, options) => {
    calls.push({ url, redirect: options.redirect });
    return new Response(null, { status: 302, headers: { Location: "https://evil.example/" } });
  });
  await assert.rejects(http.json("itad_prices", "https://api.isthereanydeal.com/games/prices/v3", { headers: { "ITAD-API-Key": "TEST_SECRET_KEY" } }), /HTTP 302/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].redirect, "manual");
});

test("batched metadata requests retain a sufficient bounded URL budget", async () => {
  const http = client(async () => Response.json({ ok: true }));
  assert.deepEqual(await http.json("steam_metadata", `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${"x".repeat(4000)}`), { ok: true });
});

test("response limits reject declared and streamed oversized bodies", async () => {
  await assert.rejects(readText("fx", new Response("small", { headers: { "Content-Length": "1000" } }), 64), /response_too_large/);
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(65)); },
    cancel() { cancelled = true; }
  });
  await assert.rejects(readText("fx", new Response(stream), 64), /response_too_large/);
  assert.equal(cancelled, true);
  assert.equal(await readText("fx", new Response("ไทย"), 9), "ไทย");
  await assert.rejects(readText("fx", new Response("ไทย"), 8), /response_too_large/);
});

test("streaming errors are redacted rather than leaking URLs or tokens", async () => {
  const stream = new ReadableStream({ start(controller) { controller.error(new Error("https://example.com/TEST_SECRET_TOKEN")); } });
  await assert.rejects(readText("fx", new Response(stream)), error => error.message === "fx: response_read_failed");
});

test("purchase links cannot impersonate a supported retailer with another origin", () => {
  for (const url of ["https://www.fanatical.com.evil.example/game", "https://evil.example/game", "https://www.fanatical.com:8443/game", "https://user@www.fanatical.com/game"]) {
    assert.equal(purchaseUrl("fanatical", url), null);
  }
  assert.equal(purchaseUrl("fanatical", "https://www.fanatical.com/en/game/example?utm_source=mcp"), "https://www.fanatical.com/en/game/example?utm_source=mcp");
  assert.equal(purchaseUrl("itad", "https://itad.link/example/?a=1&b=2"), "https://itad.link/example/?a=1&b=2");
  assert.equal(safeUrl("https://itad.link/test\n"), null);
  const offer = { source: "fanatical", match: "exact", drm: "steam", authorized: true, stock: true, region: "verified", amount: 1, regular: 10, discount: 90, currency: "USD", url: "https://evil.example/" };
  assert.equal(eligible(offer, now), false);
  assert.throws(() => formatDigest([{ title: "Game", offer, thb: 33 }], { checkedAt: new Date(now).toISOString() }), /invalid_purchase_link/);
});

test("pairing requires this setup's challenge from the matching private human account", () => {
  const challenge = setupChallenge();
  assert.match(challenge, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(challenge, setupChallenge());
  const message = { text: `/start ${challenge}`, chat: { type: "private", id: 123456 }, from: { id: 123456, is_bot: false }, date: now / 1000 };
  const unrelated = Array.from({ length: 100 }, () => ({ message: { ...message, text: "/start", chat: { type: "private", id: 999999 } } }));
  assert.throws(() => setupRecipient(unrelated, challenge, now), /pairing_not_found/);
  assert.equal(setupRecipient([...unrelated, { message }], challenge, now), "123456");
  for (const changed of [{ chat: { type: "group", id: -123456 } }, { from: { id: 999999, is_bot: false } }, { from: { id: 123456, is_bot: true } },
    { text: `/start ${setupChallenge()}` }, { date: now / 1000 - 600 }]) {
    assert.throws(() => setupRecipient([{ message: { ...message, ...changed } }], challenge, now), /pairing_not_found/);
  }
  const other = { ...message, chat: { type: "private", id: 999999 }, from: { id: 999999, is_bot: false } };
  assert.throws(() => setupRecipient([{ message }, { message: other }], challenge, now), /pairing_not_found_or_ambiguous/);
});

test("malformed or oversized persisted outboxes stop before any delivery", async () => {
  const valid = { createdAt: now, cursor: 0, messages: ["digest"], commit: emptyState() };
  for (const changed of [{ cursor: -1 }, { cursor: 2 }, { cursor: 0.5 }, { messages: "not an array" }, { messages: [null] },
    { messages: ["x".repeat(4097)] }, { messages: Array(101).fill("digest") }, { commit: { version: 999 } }, { createdAt: null }, { createdAt: now + 3600000 }]) {
    const f = fixture();
    f.state = { ...emptyState(), outbox: { ...valid, ...changed } };
    await assert.rejects(runMonitor(f.env, { fetcher: f.fetcher, now }), /invalid_outbox_do_not_reset/);
    assert.equal(f.controls.attempts, 0);
  }
  await assert.rejects(readState({ get: async () => " ".repeat(4 * 1024 * 1024 + 1) }), /state_too_large/);
  await assert.rejects(readState({ get: async () => JSON.stringify({ ...emptyState(), entries: [] }) }), /unknown_schema/);
});

test("future and invalid FX dates or unrequested and duplicate rates cannot enter comparisons", async () => {
  const base = [{ base: "EUR", quote: "THB", rate: 33, date: "2026-10-16" }];
  for (const rows of [[{ ...base[0], date: "2099-01-01" }], [{ ...base[0], date: "2026-99-99" }], [...base, { ...base[0] }], [...base, { ...base[0], quote: "EUR", rate: 0.5 }]]) {
    await assert.rejects(loadFx(client(async () => Response.json(rows)), [], null, now), /invalid_rates|missing_or_stale_rates/);
  }
  const poisonedCache = { date: "2099-01-01", fetchedAt: now + 86400000, rates: { EUR: 1, THB: 33 } };
  await assert.rejects(loadFx(client(async () => { throw new Error("offline"); }), [], poisonedCache, now), /request_failed/);
});

test("invalid private chat identifiers are rejected before delivery", () => {
  const f = fixture();
  for (const chat of ["0", "-1", "9007199254740992", "@someone", "1\n"]) {
    assert.throws(() => validateConfig({ ...f.env, TELEGRAM_CHAT_ID: chat }, true), /private_telegram_credentials/);
  }
});

test("credential writes refuse an unsafe workspace or replace a private file atomically", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "wishlist-private-write-"));
  t.after(async () => {
    for (const file of await readdir(directory)) await rm(path.join(directory, file));
    await rmdir(directory);
  });
  const file = path.join(directory, ".dev.vars");
  await writeFile(file, "previous synthetic value");
  try { await assertPrivateDirectory(directory); }
  catch (error) {
    assert.equal(error.code, "private_workspace_permissions_required_see_README_md");
    await assert.rejects(writePrivateFile(file, "replacement"), /private_workspace_permissions_required/);
    assert.equal(await readFile(file, "utf8"), "previous synthetic value");
    assert.deepEqual(await readdir(directory), [".dev.vars"]);
    t.diagnostic("Verified unsafe-directory refusal without modifying the existing credential file.");
    return;
  }
  await writePrivateFile(file, "complete synthetic replacement\n");
  assert.equal(await readFile(file, "utf8"), "complete synthetic replacement\n");
  assert.deepEqual(await readdir(directory), [".dev.vars"]);
  if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
  t.diagnostic("Verified atomic replacement in a directory whose access check passed.");
});
