// KV permits one write per second to the same key. Delivery checkpoints use
// that key repeatedly, so leave a small margin after each completed write.
// This is pacing within one scan, not a distributed lock.
export function paceStateStorage(storage, {
  clock = Date.now,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
} = {}) {
  let completedAt;
  let pending = Promise.resolve();
  return {
    get: (...args) => storage.get(...args),
    put(...args) {
      const operation = pending.then(async () => {
        if (completedAt !== undefined) {
          const delay = 1100 - (clock() - completedAt);
          if (delay > 0) await wait(delay);
        }
        try { return await storage.put(...args); }
        finally { completedAt = clock(); }
      });
      pending = operation.catch(() => {});
      return operation;
    }
  };
}
