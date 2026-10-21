import { mkdir, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { root, localConfig } from "./env.mjs";
import { validateConfig } from "../src/monitor.js";
import { privateWorkerConfig, registerPolling } from "./telegram-settings.mjs";
import { writePrivateFile } from "./private-storage.mjs";
import { wrangler } from "./wrangler.mjs";

const SECRET_KEYS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "ITAD_API_KEY"];
const VARIABLE_KEYS = ["STEAM_ID", "COUNTRY", "REFERENCE_COUNTRY", "ENABLE_FANATICAL", "ENABLE_2GAME", "FAILURE_NOTICE_AFTER"];

export async function deployWorker(env, { directory = root, runWrangler = wrangler,
  registerCommands = registerPolling, writeSecrets = writePrivateFile } = {}) {
  validateConfig(env, true);
  const saved = await localConfig(directory);
  const secrets = Object.fromEntries(SECRET_KEYS.map(key => [key, env[key]]));
  const vars = Object.fromEntries([...new Set([...Object.keys(saved.vars ?? {}), ...VARIABLE_KEYS])]
    .filter(key => !SECRET_KEYS.includes(key))
    .map(key => [key, env[key] ?? saved.vars?.[key]]).filter(([, value]) => value !== undefined));
  const config = privateWorkerConfig({ ...saved, vars });
  const deployedEnv = { ...env, ...vars, ...secrets };
  await writeFile(path.join(directory, "wrangler.jsonc"), JSON.stringify(config, null, 2) + "\n");
  if (config.kv_namespaces.some(namespace => namespace.id.startsWith("REPLACE_"))) {
    await runWrangler(["kv", "namespace", "create", "DEALS_KV", "--binding", "DEALS_KV", "--update-config"]);
  }
  const privateDirectory = path.join(directory, ".data");
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  const secretsFile = path.join(privateDirectory, `deploy-secrets-${randomUUID()}.json`);
  try {
    // Use exactly the validated credentials for code upload and command setup.
    // Keep secrets out of arguments and remove this ignored snapshot afterward.
    await writeSecrets(secretsFile, JSON.stringify(secrets) + "\n");
    await runWrangler(["deploy", "--secrets-file", secretsFile]);
    await registerCommands(deployedEnv);
  } finally {
    await unlink(secretsFile).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}
