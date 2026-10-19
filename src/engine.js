import { purchaseUrl } from "./http.js";

const EPSILON = 0.005;

export function convert(amount, currency, fx) {
  if (currency === "THB") return amount;
  const source = fx?.rates?.[currency];
  const thb = fx?.rates?.THB;
  return source > 0 && thb > 0 ? amount * thb / source : null;
}

export function eligible(offer, now) {
  return offer.match === "exact" && offer.drm === "steam" && offer.authorized === true &&
    offer.region !== "blocked" && offer.stock === true &&
    Number.isFinite(offer.amount) && offer.amount >= 0 &&
    Number.isFinite(offer.regular) && offer.regular >= offer.amount &&
    Number.isFinite(offer.discount) && offer.discount >= 0 && offer.discount <= 100 &&
    /^[A-Z]{3}$/.test(offer.currency ?? "") &&
    (!offer.expiresAt || (Number.isFinite(Date.parse(offer.expiresAt)) && Date.parse(offer.expiresAt) > now)) &&
    purchaseUrl(offer.source, offer.url) !== null;
}

export function discounted(offer) {
  return !!offer && Number.isFinite(offer.regular) && offer.regular > offer.amount && offer.discount > 0;
}

export function cheapest(offers, fx) {
  let winner = null;
  for (const offer of offers) {
    const thb = convert(offer.amount, offer.currency, fx);
    if (thb === null) return { error: `Missing reference rate: ${offer.currency}` };
    if (!winner || thb < winner.thb - EPSILON ||
      (Math.abs(thb - winner.thb) < EPSILON && offer.region === "verified" && winner.offer.region !== "verified")) {
      winner = { offer, thb };
    }
  }
  return winner;
}

export function planAlerts(games, previous = {}, fx, now = Date.now()) {
  const entries = {};
  const alerts = [];
  const skipped = [];
  for (const game of games) {
    const key = String(game.appid);
    const prior = previous[key];
    if (!game.complete) {
      if (prior) entries[key] = prior;
      skipped.push({ appid: game.appid, reason: "source_unavailable" });
      continue;
    }
    const offers = game.offers.filter(o => eligible(o, now));
    const current = cheapest(offers, fx);
    // A missing rate must not silently drop a potentially cheapest retailer.
    if (current?.error) {
      if (prior) entries[key] = prior;
      skipped.push({ appid: game.appid, reason: current.error });
      continue;
    }
    const oldBest = prior ? cheapest(prior.offers ?? [], fx) : null;
    if (oldBest?.error) {
      if (prior) entries[key] = prior;
      skipped.push({ appid: game.appid, reason: oldBest.error });
      continue;
    }
    // Reprice BOTH observations with the SAME FX rates. A rate change or a
    // change of cheapest retailer caused only by FX cannot trigger an alert.
    const reason = !prior ? "first" : !discounted(oldBest?.offer) ? "sale" :
      current && current.thb < oldBest.thb - EPSILON ? "lower" : null;
    if (current && discounted(current.offer) && reason) {
      alerts.push({ appid: game.appid, title: game.title, ...current, reason });
    }
    entries[key] = { title: game.title, offers, checkedAt: new Date(now).toISOString() };
  }
  alerts.sort((a, b) => a.title.localeCompare(b.title));
  return { entries, alerts, skipped };
}
