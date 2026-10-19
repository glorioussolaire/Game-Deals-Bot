import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { localConfig, steamIdFromInput } from "../scripts/env.mjs";

async function removeConfigDirectory(directory) {
  for (const name of ["wrangler.jsonc", "wrangler.example.jsonc"]) await rm(path.join(directory, name), { force: true });
  await rmdir(directory);
}

test("a fresh checkout creates local configuration without replacing an existing deployment", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "telegram-deal-config-"));
  t.after(() => removeConfigDirectory(directory));
  const template = { vars: { STEAM_ID: "" }, kv_namespaces: [{ id: "REPLACE_WITH_KV_NAMESPACE_ID" }] };
  await writeFile(path.join(directory, "wrangler.example.jsonc"), JSON.stringify(template));
  assert.deepEqual(await localConfig(directory), template);
  const deployed = { vars: { STEAM_ID: "76561198000000000" }, kv_namespaces: [{ id: "existing-storage" }] };
  await writeFile(path.join(directory, "wrangler.jsonc"), JSON.stringify(deployed));
  assert.deepEqual(await localConfig(directory), deployed);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, "wrangler.example.jsonc"), "utf8")), template);
});

test("invalid existing local configuration is reported rather than overwritten", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "telegram-deal-config-"));
  t.after(() => removeConfigDirectory(directory));
  await writeFile(path.join(directory, "wrangler.jsonc"), "broken configuration");
  await assert.rejects(localConfig(directory), SyntaxError);
  assert.equal(await readFile(path.join(directory, "wrangler.jsonc"), "utf8"), "broken configuration");
});

test("wishlist setup accepts an exact Steam profile URL or ID", () => {
  assert.equal(steamIdFromInput("76561198000000000"), "76561198000000000");
  assert.equal(steamIdFromInput(" https://store.steampowered.com/wishlist/profiles/76561198000000000/ "), "76561198000000000");
  for (const value of ["", "1234", "https://example.com/76561198000000000", "https://store.steampowered.com/wishlist/id/someone/"]) {
    assert.equal(steamIdFromInput(value), null);
  }
});
