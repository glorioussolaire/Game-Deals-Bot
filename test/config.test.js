import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm, rmdir } from "node:fs/promises";
import { parseEnv } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { localConfig, localEnv, steamIdFromInput } from "../scripts/env.mjs";
import { deployWorker } from "../scripts/deployment.mjs";

async function removeConfigDirectory(directory) {
  const data = path.join(directory, ".data");
  const entries = await readdir(data).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (entries) { for (const file of entries) await rm(path.join(data, file)); await rmdir(data); }
  for (const name of ["wrangler.jsonc", "wrangler.example.jsonc", ".dev.vars"]) await rm(path.join(directory, name), { force: true });
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

async function deploymentFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "telegram-deal-deployment-"));
  t.after(() => removeConfigDirectory(directory));
  const savedSecrets = { TELEGRAM_BOT_TOKEN: "123456:OLD_TEST_TOKEN", TELEGRAM_CHAT_ID: "111111", ITAD_API_KEY: "OLD_TEST_KEY" };
  await writeFile(path.join(directory, ".dev.vars"), Object.entries(savedSecrets).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"));
  await writeFile(path.join(directory, "wrangler.jsonc"), JSON.stringify({ vars: { STEAM_ID: "76561198000000000", COUNTRY: "TH",
    REFERENCE_COUNTRY: "US", ITAD_API_KEY: "OLD_CONFIG_KEY" }, kv_namespaces: [{ binding: "DEALS_KV", id: "existing-history" }],
    workers_dev: true, preview_urls: true }));
  const overrides = { STEAM_ID: "76561198000000001", REFERENCE_COUNTRY: "GB", TELEGRAM_BOT_TOKEN: "234567:NEW_TEST_TOKEN",
    TELEGRAM_CHAT_ID: "222222", ITAD_API_KEY: "NEW_TEST_KEY" };
  const env = await localEnv(directory, overrides);
  // Synthetic file I/O exercises the deployment flow; private ACL enforcement
  // is separately tested in security.test.js with the production writer.
  const writeSecrets = (file, value) => writeFile(file, value, { mode: 0o600 });
  return { directory, savedSecrets, overrides, env, writeSecrets };
}

test("deployment uploads and registers the validated environment snapshot", async t => {
  const c = await deploymentFixture(t);
  let uploaded, publishedConfig, secretPath, registered = false;
  await deployWorker(c.env, { directory: c.directory, writeSecrets: c.writeSecrets, runWrangler: async args => {
    assert.equal(args[0], "deploy");
    secretPath = args[args.indexOf("--secrets-file") + 1];
    uploaded = JSON.parse(await readFile(secretPath, "utf8"));
    publishedConfig = JSON.parse(await readFile(path.join(c.directory, "wrangler.jsonc"), "utf8"));
    assert.deepEqual(uploaded, { TELEGRAM_BOT_TOKEN: c.overrides.TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID: c.overrides.TELEGRAM_CHAT_ID, ITAD_API_KEY: c.overrides.ITAD_API_KEY });
    assert.ok(Object.values(uploaded).every(secret => !args.some(arg => arg.includes(secret))), "Credentials must not appear in command arguments");
  }, registerCommands: async env => {
    assert.deepEqual(Object.fromEntries(Object.keys(uploaded).map(key => [key, env[key]])), uploaded);
    registered = true;
  } });
  assert.equal(registered, true);
  assert.equal(publishedConfig.vars.STEAM_ID, c.overrides.STEAM_ID);
  assert.equal(publishedConfig.vars.REFERENCE_COUNTRY, "GB");
  assert.equal(publishedConfig.vars.ITAD_API_KEY, undefined, "Secrets must not become plaintext variables");
  assert.deepEqual(publishedConfig.kv_namespaces, [{ binding: "DEALS_KV", id: "existing-history" }]);
  assert.equal(publishedConfig.workers_dev, false);
  assert.equal(publishedConfig.preview_urls, false);
  assert.deepEqual(publishedConfig.triggers.crons, ["0 * * * *", "* * * * *"]);
  assert.deepEqual({ ...parseEnv(await readFile(path.join(c.directory, ".dev.vars"), "utf8")) }, c.savedSecrets);
  await assert.rejects(readFile(secretPath), { code: "ENOENT" });
  assert.deepEqual(await readdir(path.join(c.directory, ".data")), []);
});

for (const stage of ["upload", "registration"]) {
  test(`deployment removes its private snapshot after ${stage} fails`, async t => {
    const c = await deploymentFixture(t);
    let secretPath, registrationAttempted = false;
    await assert.rejects(deployWorker(c.env, { directory: c.directory, writeSecrets: c.writeSecrets, runWrangler: async args => {
      secretPath = args[args.indexOf("--secrets-file") + 1];
      assert.ok(await readFile(secretPath, "utf8"));
      if (stage === "upload") throw new Error("synthetic upload failure");
    }, registerCommands: async () => {
      registrationAttempted = true;
      throw new Error("synthetic registration failure");
    } }), new RegExp(`synthetic ${stage} failure`));
    assert.equal(registrationAttempted, stage === "registration");
    await assert.rejects(readFile(secretPath), { code: "ENOENT" });
    assert.deepEqual(await readdir(path.join(c.directory, ".data")), []);
  });
}
