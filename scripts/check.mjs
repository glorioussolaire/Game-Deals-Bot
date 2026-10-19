import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { root } from "./env.mjs";

async function visit(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (/\.m?js$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
      if (result.status !== 0) process.exitCode = 1;
    }
  }
}
for (const folder of ["src", "scripts", "test"]) await visit(path.join(root, folder));
