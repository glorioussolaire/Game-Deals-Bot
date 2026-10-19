import { client, SourceError } from "./http.js";
import { validateConfig } from "./monitor.js";
import { runCommand } from "./commands.js";

export const COMMAND_CRON = "* * * * *";
export const MONITOR_CRON = "0 * * * *";
let active = false;

export async function pollTelegram(env, { fetcher = fetch, now = Date.now(), wait } = {}) {
  if (active) throw new SourceError("telegram_poll", "already_running");
  active = true;
  try {
    validateConfig(env, true);
    const http = client(fetcher);
    async function updates(body) {
      const result = await http.json("telegram", `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowed_updates: ["message"], ...body })
      });
      if (!result.ok || !Array.isArray(result.result) || result.result.length > body.limit) {
        throw new SourceError("telegram_poll", "invalid_updates");
      }
      return result.result;
    }
    // Telegram retains unconfirmed updates. No idle KV cursor writes are needed.
    const batch = await updates({ limit: 100, timeout: 1 });
    let previous = -1;
    for (const update of batch) {
      if (!Number.isSafeInteger(update?.update_id) || update.update_id <= previous || update.update_id >= Number.MAX_SAFE_INTEGER) {
        throw new SourceError("telegram_poll", "invalid_update_order");
      }
      previous = update.update_id;
    }
    let commands = 0;
    for (const update of batch) {
      if (await runCommand(update, env, { http, now, wait })) commands++;
    }
    if (batch.length) {
      // Acknowledge only after every accepted command finishes. If delivery or
      // checkpointing fails, the next poll retries this batch using job cursors.
      // Updates returned by this acknowledgement remain unconfirmed for next time.
      await updates({ offset: previous + 1, limit: 1, timeout: 0 });
    }
    return { received: batch.length, commands, requests: http.requests };
  } finally { active = false; }
}
