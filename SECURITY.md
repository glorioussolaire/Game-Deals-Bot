# Security

The bot sends alerts to one configured private Telegram chat. Production has no public command endpoint, inbound message handler, or webhook. Workers HTTP and preview routes are disabled.

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

- Authenticated requests use fixed, approved HTTPS hostnames. Redirects are returned manually and rejected without forwarding credentials.
- Streamed JSON, SSE, and HTML bodies are limited to 4 MiB. Fetches have a 20-second timeout and scans a 45-request budget.
- Purchase links require HTTPS, a standard port, no userinfo or control characters, and an exact approved origin for their source. ITAD links use `itad.link` or `isthereanydeal.com`; direct links use the relevant retailer's domain. Attribution parameters are preserved. Changed provider link formats require review.
- Telegram text and link attributes are HTML-escaped. Storefront scripts and MCP instructions are never executed.
- State size, outbox shape, cursor, message lengths, commit snapshot, and creation time are validated before delivery. Malformed state stops the scan instead of resetting history.
- FX checks reject invalid/future dates, duplicate/unrequested quotes, non-finite rates, and invalid cache freshness.

## Deployment and trust

Cloudflare stores all three application credentials as Worker secrets. App logs contain counts and known error codes; Workers query strings are redacted. Do not share raw local diagnostic artifacts without checking them. GitHub CI uses read-only repository permissions, pinned official actions, no application secrets, and no deployment step.

The application trusts its OS user, authorized Cloudflare administrators, private KV, Telegram, and price providers. Origin checks cannot independently authenticate an ITAD redirect's eventual destination or provider catalog assignments. KV is not a distributed lock or an adversarially authenticated channel; acknowledged delivery followed by a failed checkpoint may be repeated. Dependency advisory checks cannot exclude undisclosed vulnerabilities.

See [the application audit](docs/security-audit.md) for evidence and open items. Report vulnerabilities privately through GitHub's security reporting if enabled; never place real tokens or private chat IDs in public issues. Rotate credentials through their issuing services if compromise is confirmed.
