import { client, codeOf } from "../src/http.js";
import { loadWishlist, loadSteam } from "../src/sources/steam.js";
import { loadFanatical } from "../src/sources/fanatical.js";
import { loadTwoGame } from "../src/sources/two-game.js";
import { loadFx } from "../src/sources/fx.js";
import { loadItad } from "../src/sources/itad.js";
import { localEnv, friendlyError } from "./env.mjs";

try {
  const env = await localEnv();
  const http = client();
  const ids = await loadWishlist(http, env.STEAM_ID);
  const games = await loadSteam(http, ids);
  const report = { wishlist: ids.length, steamMetadata: games.filter(g => g.complete).length,
    steamTHB: games.filter(g => g.offers.some(o => o.currency === "THB")).length };
  try { const result = await loadFanatical(http, games); report.fanatical = { matched: games.length - result.gaps.length, offers: games.flatMap(g => g.offers).filter(o => o.source === "fanatical").length }; }
  catch (error) { report.fanatical = { error: codeOf(error) }; process.exitCode = 1; }
  const twoGame = await loadTwoGame(http, games);
  report.twoGame = { mappings: twoGame.covered.length, offers: games.flatMap(g => g.offers).filter(o => o.source === "2game").length,
    failures: twoGame.failures.map(item => ({ appid: item.appid, error: codeOf(item.error) })) };
  if (twoGame.failures.length) process.exitCode = 1;
  const fx = await loadFx(http, ["USD", "GBP", "EUR", "THB"]);
  report.fx = { date: fx.date, currencies: Object.keys(fx.rates) };
  if (env.ITAD_API_KEY) {
    const itad = await loadItad(http, games, env.ITAD_API_KEY);
    report.itad = { mapped: games.length - itad.gaps.length, offers: games.flatMap(g => g.offers).filter(o => o.source === "itad").length, activeShops: itad.shops.length };
  } else report.itad = { status: "NOT TESTED: personal API key required" };
  report.requests = http.requests;
  report.telegram = "Not contacted; no messages sent";
  console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error(friendlyError(error)); process.exitCode = 1; }
