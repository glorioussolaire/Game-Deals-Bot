import { client, SourceError } from "../src/http.js";
import { COMMAND_CRON, MONITOR_CRON } from "../src/polling.js";

export function privateWorkerConfig(config) {
  return { ...config, workers_dev: false, preview_urls: false, routes: [],
    triggers: { ...config.triggers, crons: [MONITOR_CRON, COMMAND_CRON] } };
}

export async function telegramSetting(http, token, method, body = {}) {
  const result = await http.json("telegram_setup", `https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  if (!result.ok) throw new SourceError("telegram_setup", "command_registration_failed");
  return result.result;
}

export async function registerPolling(env, http = client()) {
  const chat = await telegramSetting(http, env.TELEGRAM_BOT_TOKEN, "getChat", { chat_id: env.TELEGRAM_CHAT_ID });
  if (chat?.type !== "private" || String(chat.id) !== env.TELEGRAM_CHAT_ID) throw new SourceError("telegram_setup", "private_recipient_mismatch");
  await telegramSetting(http, env.TELEGRAM_BOT_TOKEN, "setMyCommands", {
    scope: { type: "chat", chat_id: env.TELEGRAM_CHAT_ID },
    commands: [{ command: "deals", description: "Show all discounts from the latest hourly checks" },
      { command: "help", description: "How wishlist alerts and saved prices work" }]
  });
  await telegramSetting(http, env.TELEGRAM_BOT_TOKEN, "deleteWebhook", { drop_pending_updates: false });
  const webhook = await telegramSetting(http, env.TELEGRAM_BOT_TOKEN, "getWebhookInfo");
  if (webhook?.url !== "") throw new SourceError("telegram_setup", "webhook_still_enabled");
}
