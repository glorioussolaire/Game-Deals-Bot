import test from "node:test";
import assert from "node:assert/strict";
import { planAlerts, eligible } from "../src/engine.js";
import { formatDigest } from "../src/telegram.js";

const now = Date.parse("2026-10-18T10:00:00Z");
const fx = { date: "2026-10-16", rates: { EUR: 1, USD: 1, THB: 33 } };
const offer = (extra = {}) => ({ key: "gmg", appid: 1, source: "itad", shop: "Green Man Gaming", amount: 10, regular: 40, discount: 75,
  currency: "USD", authorized: true, drm: "steam", match: "exact", stock: true, region: "unverified", priceBasis: "reference", url: "https://itad.link/test/", ...extra });
const game = (offers, extra = {}) => ({ appid: 1, title: "A game", offers, complete: true, ...extra });
const plan = (games, previous = {}, rates = fx) => planAlerts(games, previous, rates, now);

test("first scan alerts only for the cheapest discounted Steam offer", () => {
  const result = plan([game([offer(), offer({ key: "steam", shop: "Steam", amount: 600, regular: 600, discount: 0, currency: "THB", region: "verified" })])]);
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].thb, 330);
  assert.equal(result.alerts[0].offer.region, "unverified");
});

test("a more expensive discounted offer cannot override a cheaper full-price offer", () => {
  const result = plan([game([offer(), offer({ key: "steam", amount: 250, regular: 250, discount: 0, currency: "THB" })])]);
  assert.equal(result.alerts.length, 0);
});

test("unchanged offers stay quiet, further reductions and later sales alert", () => {
  let state = plan([game([offer()])]).entries;
  assert.equal(plan([game([offer()])], state).alerts.length, 0);
  let result = plan([game([offer({ amount: 9 })])], state);
  assert.equal(result.alerts[0].reason, "lower");
  state = result.entries;
  result = plan([game([offer({ amount: 15 })])], state);
  assert.equal(result.alerts.length, 0);
  result = plan([game([offer({ amount: 10 })])], result.entries);
  assert.equal(result.alerts[0].reason, "lower");
  state = plan([game([offer({ amount: 40, regular: 40, discount: 0 })])], result.entries).entries;
  assert.equal(plan([game([offer()])], state).alerts[0].reason, "sale");
});

test("exchange-rate movement alone never alerts, including a cheapest-retailer swap", () => {
  const offers = [offer(), offer({ key: "steam", source: "steam", amount: 340, regular: 680, currency: "THB", url: "https://store.steampowered.com/app/1/" })];
  const state = plan([game(offers)]).entries;
  const result = plan([game(offers)], state, { ...fx, rates: { ...fx.rates, THB: 40 } });
  assert.equal(result.alerts.length, 0);
  assert.equal(result.entries[1].offers.length, 2);
});

test("an unrelated price cut plus FX movement cannot manufacture a best-price drop", () => {
  const before = [offer(), offer({ key: "local", amount: 340, regular: 700, currency: "THB" }), offer({ key: "third", amount: 100 })];
  const state = plan([game(before)]).entries;
  const after = [...before.slice(0, 2), offer({ key: "third", amount: 90 })];
  assert.equal(plan([game(after)], state, { ...fx, rates: { ...fx.rates, THB: 40 } }).alerts.length, 0);
});

test("source failures freeze baselines; recovery at the same price stays quiet", () => {
  const state = plan([game([offer()])]).entries;
  const failure = plan([game([], { complete: false })], state);
  assert.deepEqual(failure.entries, state);
  assert.equal(plan([game([offer()])], failure.entries).alerts.length, 0);
});

test("removal stops tracking and re-adding a discounted game alerts again", () => {
  const state = plan([game([offer()])]).entries;
  const removed = plan([], state);
  assert.deepEqual(removed.entries, {});
  assert.equal(plan([game([offer()])], removed.entries).alerts.length, 1);
});

test("reject unknown identity/DRM, keyshops, Thailand blocks, expired and invalid prices", () => {
  for (const extra of [{ match: "fuzzy" }, { drm: "epic" }, { authorized: false }, { region: "blocked" }, { stock: false },
    { expiresAt: "2026-10-17T00:00:00Z" }, { expiresAt: "bad" }, { amount: -1 }, { amount: NaN }, { url: "javascript:alert(1)" }]) {
    assert.equal(eligible(offer(extra), now), false, JSON.stringify(extra));
  }
  assert.equal(eligible(offer({ amount: 0, discount: 100 }), now), true);
});

test("missing FX rates freeze the comparison rather than hiding a potentially cheaper offer", () => {
  const result = plan([game([offer({ currency: "GBP" })])]);
  assert.equal(result.alerts.length, 0);
  assert.match(result.skipped[0].reason, /Missing reference rate/);
});

test("messages label unknown activation and reference prices, escape text, and preserve attributed links", () => {
  const alert = plan([game([offer({ url: "https://itad.link/test/?a=1&b=2" })], { title: '<Game & "DLC">' })]).alerts;
  const [text] = formatDigest(alert, { checkedAt: new Date(now).toISOString(), fx });
  assert.match(text, /Thailand activation unverified/);
  assert.match(text, /reference price, as reported by feed/);
  assert.match(text, /&lt;Game &amp; &quot;DLC&quot;&gt;/);
  assert.match(text, /a=1&amp;b=2/);
  assert.match(text, /IsThereAnyDeal/);
  assert.match(text, /≈฿330/);
});

test("large sale digests split into complete messages within Telegram limits", () => {
  const alerts = Array.from({ length: 50 }, (_, i) => ({ appid: i, title: `Game ${i} ` + "long title ".repeat(20), offer: offer(), thb: 330 }));
  const messages = formatDigest(alerts, { checkedAt: new Date(now).toISOString(), fx });
  assert.ok(messages.length > 1);
  assert.ok(messages.every(message => message.length <= 4096 && message.endsWith("Steam")));
  assert.equal(messages.join("\n").match(/<b>Game /g).length, 50);
});
