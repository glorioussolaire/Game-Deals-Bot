import { spawn } from "node:child_process";
import path from "node:path";
import { root, localConfig } from "./env.mjs";
import { fileURLToPath } from "node:url";

export async function wrangler(args, { input, inherit = true } = {}) {
  await localConfig();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "node_modules", "wrangler", "bin", "wrangler.js"), ...args], {
      cwd: root,
      env: { ...process.env, WRANGLER_LOG_PATH: path.join(root, ".data", "wrangler-logs"), WRANGLER_SEND_METRICS: "false" },
      stdio: input ? ["pipe", inherit ? "inherit" : "pipe", "inherit"] : "inherit"
    });
    if (input) child.stdin.end(input);
    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0) return resolve();
      const error = new Error("Wrangler failed; see the Cloudflare error above.");
      error.name = "WranglerError";
      reject(error);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await wrangler(process.argv.slice(2)); } catch { process.exitCode = 1; }
}
