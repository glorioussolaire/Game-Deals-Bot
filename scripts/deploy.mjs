import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { root, localEnv, friendlyError } from "./env.mjs";
import { validateConfig, runMonitor } from "../src/monitor.js";
import { wrangler } from "./wrangler.mjs";
import { ensureWebhookSecret, deploymentWebhookUrl, registerWebhook } from "./telegram-webhook.mjs";

try {
  const env = await localEnv();
  validateConfig(env, true);
  await ensureWebhookSecret(env);
  console.log("Checking live sources without sending or advancing alert history...");
  const preview = await runMonitor(env, { deliver: false });
  if (!preview.ok || preview.compared === 0 && preview.wishlistCount > 0) throw new Error("No complete comparisons; fix source failures before deployment");
  console.log(`Validated ${preview.compared}/${preview.wishlistCount} product comparisons; ${preview.alertCount} initial alerts.`);
  console.log("Keep your Cloudflare account on Workers Free. This command does not enable a paid plan.");
  const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
  config.workers_dev = true;
  config.preview_urls = false;
  await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify(config, null, 2) + "\n");
  if (config.kv_namespaces.some(namespace => namespace.id.startsWith("REPLACE_"))) {
    await wrangler(["kv", "namespace", "create", "DEALS_KV", "--binding", "DEALS_KV", "--update-config"]);
  }
  // Current Wrangler supports one deployment containing code AND secrets;
  // avoid briefly publishing a scheduled Worker without its credentials.
  const output = await wrangler(["deploy", "--secrets-file", ".dev.vars"], { capture: true });
  await registerWebhook(env, deploymentWebhookUrl(output, config.name));
  console.log("Private /deals and /help commands enabled. /deals restores the latest saved discounts without changing hourly alert history.");
  console.log("Deployed. Hourly checks run at minute 00 UTC (also minute 00 in Bangkok). Allow schedule propagation time.");
  console.log("Use npm run logs to inspect redacted run summaries and CPU errors. Check the account plan and CPU usage in the Cloudflare dashboard.");
} catch (error) {
  console.error(error.name === "WranglerError" ? error.message : friendlyError(error));
  if (error.name !== "WranglerError") console.error("Check local configuration before retrying. No credentials are printed.");
  process.exitCode = 1;
}
