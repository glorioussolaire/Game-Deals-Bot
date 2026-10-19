import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { localEnv, localConfig, steamIdFromInput, root, friendlyError } from "./env.mjs";
import { client } from "../src/http.js";
import { setupChallenge, setupRecipient } from "./telegram-setup.mjs";
import { assertPrivateDirectory, writePrivateFile } from "./private-storage.mjs";

async function question(label) {
  const reader = createInterface({ input: stdin, output: stdout });
  try { return (await reader.question(label)).trim(); } finally { reader.close(); }
}

async function secret(label) {
  if (!stdin.isTTY) throw new Error("Use an interactive terminal for hidden secret input");
  stdout.write(label);
  stdin.setRawMode(true); stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    function finish(error) {
      stdin.off("data", onData); stdin.setRawMode(false); stdin.pause(); stdout.write("\n");
      if (error) reject(error); else resolve(value.trim());
    }
    function onData(data) {
      for (const char of data.toString("utf8")) {
        if (char === "\u0003") { finish(new Error("Cancelled")); return; }
        if (char === "\r" || char === "\n") { finish(); return; }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    }
    stdin.on("data", onData);
  });
}

try {
  const env = await localEnv();
  await assertPrivateDirectory(root);
  if (!/^\d{17}$/.test(env.STEAM_ID ?? "")) {
    const steamId = steamIdFromInput(await question("Public Steam wishlist URL or 17-digit Steam ID: "));
    if (!steamId) throw new Error("A public Steam wishlist URL or 17-digit Steam ID is required");
    const config = await localConfig();
    config.vars.STEAM_ID = steamId;
    await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify(config, null, 2) + "\n");
  }
  console.log("Create a Telegram bot: open https://t.me/BotFather and send /newbot.");
  console.log("Create personal price API credentials: https://isthereanydeal.com/apps/ (no paid services).");
  console.log("Secret input is hidden. Enter keeps an existing saved value. No test messages are sent.");
  const token = await secret("Telegram bot token: ") || env.TELEGRAM_BOT_TOKEN;
  const key = await secret("IsThereAnyDeal API key: ") || env.ITAD_API_KEY;
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token ?? "") || !key?.trim()) throw new Error("Credentials are missing");
  const http = client();
  const me = await http.json("telegram_setup", `https://api.telegram.org/bot${token}/getMe`);
  if (!me.ok || me.result?.is_bot !== true || !/^[A-Za-z0-9_]{5,32}$/.test(me.result.username ?? "")) throw new Error("Bot verification failed");
  const challenge = setupChallenge();
  const startedAt = Date.now();
  console.log(`Open https://t.me/${me.result.username}?start=${challenge} and press Start in your private chat.`);
  await question("Press Enter after pressing Start using that setup link: ");
  const updates = await http.json("telegram_setup", `https://api.telegram.org/bot${token}/getUpdates?timeout=0&limit=100&offset=-100`);
  if (!updates.ok || !Array.isArray(updates.result)) throw new Error("Could not read bot updates");
  const chatId = setupRecipient(updates.result, challenge, startedAt);
  const text = Object.entries({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId, ITAD_API_KEY: key }).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join("\n") + "\n";
  await writePrivateFile(path.join(root, ".dev.vars"), text);
  console.log("Saved credentials to ignored .dev.vars. Run npm run preview to validate the feed without sending alerts.");
} catch (error) {
  console.error(friendlyError(error));
  console.error("You can also copy .dev.vars.example to .dev.vars and fill its three values privately.");
  process.exitCode = 1;
}
