import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import path from "node:path";
import { root } from "./env.mjs";
import { writePrivateFile } from "./private-storage.mjs";
import { client, SourceError } from "../src/http.js";

export const newWebhookSecret = () => randomBytes(32).toString("base64url");
export const validWebhookSecret = value => /^[A-Za-z0-9_-]{32,256}$/.test(value ?? "");

export async function ensureWebhookSecret(env) {
  if (env.TELEGRAM_WEBHOOK_SECRET && !validWebhookSecret(env.TELEGRAM_WEBHOOK_SECRET)) {
    throw new SourceError("config", "invalid_webhook_secret");
  }
  const file = path.join(root, ".dev.vars");
  const saved = parseEnv(await readFile(file, "utf8"));
  if (validWebhookSecret(env.TELEGRAM_WEBHOOK_SECRET) && saved.TELEGRAM_WEBHOOK_SECRET === env.TELEGRAM_WEBHOOK_SECRET) return;
  env.TELEGRAM_WEBHOOK_SECRET = validWebhookSecret(env.TELEGRAM_WEBHOOK_SECRET) ? env.TELEGRAM_WEBHOOK_SECRET : newWebhookSecret();
  saved.TELEGRAM_WEBHOOK_SECRET = env.TELEGRAM_WEBHOOK_SECRET;
  await writePrivateFile(file, Object.entries(saved).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n");
}

export function deploymentWebhookUrl(output, workerName) {
  const urls = [...output.matchAll(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev(?![a-z0-9.-])/gi)]
    .map(match => new URL(match[0])).filter(url => url.hostname.split(".")[0] === workerName);
  const origins = [...new Set(urls.map(url => url.origin))];
  if (origins.length !== 1) throw new SourceError("config", "deployed_webhook_url_missing_or_ambiguous");
  return origins[0] + "/telegram";
}

export async function telegramSetting(http, token, method, body = {}) {
  const result = await http.json("telegram_setup", `https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  if (!result.ok) throw new SourceError("telegram_setup", "command_registration_failed");
  return result.result;
}

export async function registerWebhook(env, url, http = client()) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.pathname !== "/telegram" ||
    parsed.search || parsed.hash || !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(parsed.hostname) ||
    !validWebhookSecret(env.TELEGRAM_WEBHOOK_SECRET)) throw new SourceError("config", "invalid_webhook_configuration");
  const chat = await telegramSetting(http, env.TELEGRAM_BOT_TOKEN, "getChat", { chat_id: env.TELEGRAM_CHAT_ID });
  if (chat?.type !== "private" || String(chat.id) !== env.TELEGRAM_CHAT_ID) throw new SourceError("telegram_setup", "private_recipient_mismatch");
  await telegramSetting(http, env.TELEGRAM_BOT_TOKEN, "setMyCommands", {
    scope: { type: "chat", chat_id: env.TELEGRAM_CHAT_ID },
    commands: [{ command: "deals", description: "Show all discounts from the latest hourly checks" },
      { command: "help", description: "How wishlist alerts and saved prices work" }]
  });
  await telegramSetting(http, env.TELEGRAM_BOT_TOKEN, "setWebhook", {
    url, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message"], max_connections: 1, drop_pending_updates: false
  });
}
