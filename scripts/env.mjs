import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function localConfig(directory = root) {
  const configPath = path.join(directory, "wrangler.jsonc");
  try { return JSON.parse(await readFile(configPath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  try {
    await copyFile(path.join(directory, "wrangler.example.jsonc"), configPath, constants.COPYFILE_EXCL);
  } catch (error) { if (error.code !== "EEXIST") throw error; }
  return JSON.parse(await readFile(configPath, "utf8"));
}

export function steamIdFromInput(value) {
  return value.trim().match(/^(?:https:\/\/store\.steampowered\.com\/wishlist\/profiles\/)?(\d{17})\/?$/)?.[1] ?? null;
}

export async function localEnv() {
  const config = await localConfig();
  let secrets = {};
  try { secrets = parseEnv(await readFile(path.join(root, ".dev.vars"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const env = { ...config.vars, ...secrets };
  for (const key of [...Object.keys(config.vars), "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "ITAD_API_KEY"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.DEALS_KV = {
    async get() { try { return await readFile(path.join(root, ".data", "local-state.json"), "utf8"); } catch (error) { if (error.code === "ENOENT") return null; throw error; } },
    async put(_key, value) { await mkdir(path.join(root, ".data"), { recursive: true }); await writeFile(path.join(root, ".data", "local-state.json"), value, { mode: 0o600 }); }
  };
  return env;
}

export function friendlyError(error) {
  return error.name === "SourceError" ? error.message : "Local operation failed. Check the configuration and file permissions.";
}
