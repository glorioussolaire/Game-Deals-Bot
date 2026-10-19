import test from "node:test";
import assert from "node:assert/strict";
import { paceStateStorage } from "../src/storage.js";

test("state checkpoints serialize and respect KV's per-key write interval", async () => {
  let time = 0;
  const writes = [];
  const storage = paceStateStorage({
    async get() { return "saved"; },
    async put(key, value) { writes.push({ key, value, time }); }
  }, { clock: () => time, wait: async delay => { time += delay; } });
  assert.equal(await storage.get("state"), "saved");
  await Promise.all([storage.put("state", "pending"), storage.put("state", "acknowledged"), storage.put("state", "committed")]);
  assert.deepEqual(writes.map(write => write.time), [0, 1100, 2200]);
  assert.deepEqual(writes.map(write => write.value), ["pending", "acknowledged", "committed"]);
  time += 2000;
  await storage.put("state", "next scan");
  assert.equal(writes.at(-1).time, 4200);
});

test("a failed storage write propagates without disabling subsequent pacing", async () => {
  let time = 0;
  let attempts = 0;
  const storage = paceStateStorage({
    async put() { if (++attempts === 1) throw new Error("storage unavailable"); }
  }, { clock: () => time, wait: async delay => { time += delay; } });
  await assert.rejects(storage.put("state", "first"), /storage unavailable/);
  await storage.put("state", "retry");
  assert.equal(time, 1100);
});
