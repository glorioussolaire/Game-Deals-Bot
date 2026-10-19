# Security

The bot sends alerts and command replies to one configured private Telegram chat. The workers.dev route accepts only authenticated Telegram webhook updates at `POST /telegram`. All other paths and unauthenticated requests return 404; preview URLs remain disabled. There is no HTTP endpoint for starting a price scan or changing settings.

## Local secrets and code

Keep `.dev.vars`, real `wrangler.jsonc`, `.data/`, `.wrangler/`, and deployment logs out of Git. Credential examples must remain empty. Ignore rules do not restrict operating-system access.

Use a project directory trusted only by its owner and necessary administrators or automation. Anyone who can modify application code can change what runs with its credentials. Windows file mode `0600` alone does not establish a private Windows ACL.

Setup checks directory access before credential input and again before saving. It refuses broad Windows group access and group/other-writable Unix directories. Credential replacement uses an exclusive temporary file and atomic rename; Unix files are created with mode `0600`.

On Windows, inspect the proposed permission remediation without applying it:

```powershell
.\scripts\secure-workspace.ps1
```

The default is read-only. Optional `-Apply` removes broad-group allow rules from the project and credential file, protects inheritance, preserves specific user/automation entries and deny rules, and grants the current user, SYSTEM, and Administrators full access. Inherited changes can propagate to child files. Original root and credential ACLs are saved in ignored `.data/security-acl-backup.json`. Review legitimate users before application, or use an already private project directory. No permissions outside the project are changed.

## Recipient pairing

Setup prints a fresh cryptographically random `/start` link. Open that link and press Start in your own private chat. Ordinary messages, previous setup codes, mismatched sender/chat IDs, groups, and ambiguous results cannot select the recipient. Setup examines the latest 100 updates; Telegram's negative offset discards older queued updates. Use a dedicated personal bot.

## External data

- Telegram webhook authentication uses a generated 256-bit secret in the official `X-Telegram-Bot-Api-Secret-Token` header. The secret stays out of URLs. A fixed-length comparison precedes body parsing and storage access.
- Authenticated request bodies are limited to 16 KiB. Commands require a fresh private message from the configured chat ID and the same non-bot sender; groups, forwarded commands, edited messages, and other users are ignored.
- `/deals` reads hourly snapshots, never calls retailers, and never writes the monitor state key. It filters expired offers, omits snapshots older than 24 hours, validates cached conversion rates, and labels per-product timestamps and paused comparisons. Incoming text is matched against fixed commands rather than executed.
- Command checkpoints are bounded and kept in separate KV keys for 24 hours. A ten-second cooldown and one Telegram webhook connection limit repeat work. Delivery resumes after acknowledged parts; KV is not a distributed lock, so a failed acknowledgement checkpoint can still cause a duplicate.

Telegram documents the [webhook secret header](https://core.telegram.org/bots/api#setwebhook) and [private command menu scopes](https://core.telegram.org/bots/api#botcommandscopechat). The application additionally checks the permitted sender; command-menu visibility alone is not authorization.

- Authenticated requests use fixed, approved HTTPS hostnames. Redirects are returned manually and rejected without forwarding credentials.
- Streamed JSON, SSE, and HTML bodies are limited to 4 MiB. Fetches have a 20-second timeout and scans a 45-request budget.
- Purchase links require HTTPS, a standard port, no userinfo or control characters, and an exact approved origin for their source. ITAD links use `itad.link` or `isthereanydeal.com`; direct links use the relevant retailer's domain. Attribution parameters are preserved. Changed provider link formats require review.
- Telegram text and link attributes are HTML-escaped. Storefront scripts and MCP instructions are never executed.
- State size, outbox shape, cursor, message lengths, commit snapshot, and creation time are validated before delivery. Malformed state stops the scan instead of resetting history.
- FX checks reject invalid/future dates, duplicate/unrequested quotes, non-finite rates, and invalid cache freshness.

## Deployment and trust

Cloudflare stores the bot token, private chat ID, price-feed API key, and generated webhook secret as Worker secrets. App logs contain counts and known error codes; Workers query strings are redacted. Do not share raw local diagnostic artifacts without checking them. GitHub CI uses read-only repository permissions, pinned official actions, no application secrets, and no deployment step.

The application trusts its OS user, authorized Cloudflare administrators, private KV, Telegram, and price providers. Origin checks cannot independently authenticate an ITAD redirect's eventual destination or provider catalog assignments. KV is not a distributed lock or an adversarially authenticated channel; acknowledged delivery followed by a failed checkpoint may be repeated. Dependency advisory checks cannot exclude undisclosed vulnerabilities.

See [the application audit](docs/security-audit.md) for evidence and open items. Report vulnerabilities privately through GitHub's security reporting if enabled; never place real tokens or private chat IDs in public issues. Rotate credentials through their issuing services if compromise is confirmed.
