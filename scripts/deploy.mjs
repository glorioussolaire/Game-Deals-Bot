import { localEnv, friendlyError } from "./env.mjs";
import { validateConfig, runMonitor } from "../src/monitor.js";
import { deployWorker } from "./deployment.mjs";

try {
  const env = await localEnv();
  validateConfig(env, true);
  console.log("Checking live sources without sending or advancing alert history...");
  const preview = await runMonitor(env, { deliver: false });
  if (!preview.ok || preview.compared === 0 && preview.wishlistCount > 0) throw new Error("No complete comparisons; fix source failures before deployment");
  console.log(`Validated ${preview.compared}/${preview.wishlistCount} product comparisons; ${preview.alertCount} initial alerts.`);
  console.log("Keep your Cloudflare account on Workers Free. This command does not enable a paid plan.");
  await deployWorker(env);
  console.log("Private /deals and /help commands checked every minute. Public Worker and preview URLs are disabled.");
  console.log("Deployed. Hourly checks run at minute 00 UTC (also minute 00 in Bangkok). Allow schedule propagation time.");
  console.log("Use npm run logs to inspect redacted run summaries and CPU errors. Check the account plan and CPU usage in the Cloudflare dashboard.");
} catch (error) {
  console.error(error.name === "WranglerError" ? error.message : friendlyError(error));
  if (error.name !== "WranglerError") console.error("Check local configuration before retrying. No credentials are printed.");
  process.exitCode = 1;
}
