import { localEnv, friendlyError } from "./env.mjs";
import { runMonitor } from "../src/monitor.js";

try {
  const deliver = process.argv.includes("--send");
  const result = await runMonitor(await localEnv(), { deliver });
  console.log(JSON.stringify({ ...result, messages: undefined }, null, 2));
  for (const [i, message] of result.messages.entries()) console.log(`\nDigest ${i + 1}${deliver ? " (sent)" : " (PREVIEW, not sent)"}:\n${message}`);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(friendlyError(error));
  if (error.source === "config" || error.source === "itad_prices" && [401, 403].includes(error.status)) {
    console.error("Run npm run configure to check the saved credentials.");
  } else {
    console.error("Source validation failed; saved credentials have not been changed.");
  }
  console.error("A preview never sends messages or consumes alert history.");
  process.exitCode = 1;
}
