import { randomBytes } from "node:crypto";
import { SourceError } from "../src/http.js";

export const setupChallenge = () => randomBytes(24).toString("base64url");

export function setupRecipient(updates, challenge, startedAt) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(challenge) || !Array.isArray(updates)) throw new SourceError("telegram_setup", "invalid_pairing_response");
  const chats = new Set();
  for (const update of updates) {
    const message = update?.message;
    if (message?.text !== `/start ${challenge}` || message.chat?.type !== "private" || message.from?.is_bot !== false ||
      !Number.isSafeInteger(message.chat.id) || message.chat.id <= 0 || message.from.id !== message.chat.id ||
      !Number.isFinite(message.date) || message.date * 1000 < startedAt - 5000) continue;
    chats.add(String(message.chat.id));
  }
  if (chats.size !== 1) throw new SourceError("telegram_setup", "pairing_not_found_or_ambiguous_rerun_setup_link");
  return [...chats][0];
}
