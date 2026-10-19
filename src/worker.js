import { runMonitor } from "./monitor.js";
import { paceStateStorage } from "./storage.js";
import { pollTelegram, COMMAND_CRON, MONITOR_CRON } from "./polling.js";

let active = false;

export default {
  async scheduled(controller, env) {
    if (controller.cron === COMMAND_CRON) {
      try {
        const result = await pollTelegram(env);
        if (result.received) console.log(JSON.stringify({ event: "telegram_poll", ...result }));
      } catch (error) {
        console.error(JSON.stringify({ event: "telegram_command_failure", code: error.name === "SourceError" ? error.message : "unexpected_error" }));
        throw new Error("Telegram command polling failed; inspect the redacted telegram_command_failure event.");
      }
      return;
    }
    if (controller.cron !== MONITOR_CRON) return;
    if (active) { console.log(JSON.stringify({ event: "run_skipped", code: "already_running" })); return; }
    active = true;
    try {
      const result = await runMonitor({ ...env, DEALS_KV: paceStateStorage(env.DEALS_KV) });
      console.log(JSON.stringify({ event: "monitor_run", ok: result.ok, count: result.wishlistCount, compared: result.compared,
        alerts: result.alertCount, requests: result.requests, code: result.error }));
    } catch (error) {
      // Only known error codes; never log arbitrary exceptions, URLs or secrets.
      console.error(JSON.stringify({ event: "monitor_failure", code: error.name === "SourceError" ? error.message : "unexpected_error" }));
      throw new Error("Wishlist monitor failed; inspect the redacted monitor_failure event.");
    } finally { active = false; }
  },
  async fetch() { return new Response("Not found", { status: 404 }); }
};
