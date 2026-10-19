# Application security audit

Audit date: 19 October 2026. Scope: every application source and adapter, setup/deployment scripts, secret handling, delivery state, dependency lockfile, GitHub workflow, staged publication contents, and accessible deployed settings. This is manual review with regression tests and targeted runtime checks, not independent certification or a penetration test of providers.

**Result: application fixes are deployed; one high-priority local permission finding remains open pending explicit approval.** The earlier publication check did not establish that local credential storage was private.

## Findings

| ID | Severity and precondition | Finding | Status |
| --- | --- | --- | --- |
| A1 | High; another local account accesses this machine | Project ACLs allow broad groups to modify code; credential ACLs permit broad reads. Other local users could read secrets or change code that uses them. | Open. Automatic approval review rejected permission changes because of possible user/automation lockout. No ACL mutation executed. A read-only-by-default remediation script is prepared; setup now refuses unsafe directories. |
| A2 | Medium; outsider messages/floods the bot during setup | Selecting the only private chat in the earliest 100 queued updates could select an outsider and miss the owner's newer message. | Fixed in setup with a cryptographic per-run challenge, fresh message, matching human sender/private chat, and unique result. The latest 100 updates are examined. |
| A3 | Medium; hostile or oversized upstream response | Unbounded JSON/SSE/HTML readers could exhaust Worker resources. | Fixed and deployed: 4 MiB streaming/declaration limits and cancellation, plus existing request timeouts and scan budget. |
| A4 | Medium; poisoned upstream offer data | An unrelated HTTPS destination could be presented under an authorized retailer's name. HTML escaping did not verify the purchase origin. | Fixed and deployed: source-specific exact purchase-host checks. Arbitrary purchase links are not fetched by the bot. |
| A5 | Low; corrupted/tampered private KV | Outbox collections, cursors, commit snapshots, and size were insufficiently checked before replay. | Fixed and deployed: malformed/excessive state stops before delivery without resetting history. KV remains a trusted store. |
| A6 | Low; malformed provider/cache data | Impossible/future FX dates and unexpected/duplicate quotes could be accepted, including replacement of the EUR base rate. | Fixed and deployed: date/cache freshness, quote membership/uniqueness, and finite rates are validated. |
| A7 | High availability impact; every deployed fetch | The redirect mode used by the client is rejected by Workers, causing requests to fail before reaching Steam or Telegram. Observed in production state and reproduced in a Cloudflare preview. | Fixed and deployed: manual redirects and rejection of non-success responses preserve the no-forwarding policy. The same probes then reached Steam successfully. |

Further hardening includes fixed outbound origins, private chat ID bounds, atomic credential replacement, directory access checks, and query-string redaction. These controls do not imply that an exploitable SSRF or code-execution path previously existed.

## Verification

- All 47 tests and JavaScript syntax checks pass under the normal Windows user. The restricted command container denies atomic replacement, so those file tests were verified outside that container rather than weakening the writer. Security cases cover origin spoofing, redirects, body limits, stream-error redaction, poisoned links, hostile setup updates, invalid outboxes, FX poisoning, and private chat bounds. A clean copy of the final staged files builds using only the public template and no credentials.
- Synthetic credentials were atomically replaced in an already private Windows temporary directory, leaving no temporary copies. The real project separately failed the new privacy guard as expected. Its ACLs were not changed.
- `npm audit --audit-level=high` reported zero known vulnerabilities in the complete locked tree. There are no runtime npm packages.
- Authenticated deployment preview compared all 28 current wishlist products after the fixes, without sending alerts or changing history.
- Hardened Worker deployment succeeded: 39.94 KiB, 11.90 KiB gzipped, reported startup 1 ms. Startup is not complete-scan CPU time.
- A credential-free authenticated Cloudflare preview ran the actual hardened public adapters: 28 wishlist/Steam comparisons, successful Fanatical and mapped 2Game checks, valid dated FX, ten requests. No Telegram token, ITAD key, production KV, or scheduler was attached. The preview was stopped.
- Live API reads confirmed three `secret_text` bindings, query redaction enabled, public/preview HTTP routes disabled, no bot custom domain, zero account zones that could add a zone route, and sole schedule `0 * * * *`.
- Telegram read-only checks confirmed the configured target is a private chat and no incoming webhook is configured. No messages were sent by these checks. The Wrangler login file had no broad-group allow rules.
- Existing production state passed the new reader without reset or writes. A queued monitoring notice remains pending scheduled delivery; the configured recipient and history were preserved.
- Staged-source checks found no actual credentials or personal deployment identifiers. Local diagnostic artifacts checked during the audit contained no actual credentials. Real config, credentials, state, logs, dependencies, and output remain ignored; there were no older commits containing tracked secrets.

## Conclusions and limits

No source input flows into a shell command, evaluated JavaScript, filesystem destination, or arbitrary authenticated fetch destination. Telegram HTML is escaped. Child processes receive argument arrays rather than shell-built credential commands. Production exposes no public control handler. GitHub CI cannot deploy the bot with application credentials.

Trusted local users, administrators, deployment principals, KV access, and providers remain trust boundaries. The bot checks the ITAD redirect origin, not its eventual browser destination or independent SKU proof. KV is eventually consistent and does not guarantee exactly-once delivery. Provider/account penetration testing, formal correctness, and independent uptime monitoring are outside this audit.

The observability query API returned HTTP 403 with the current login; broader permissions were not requested. Complete-scan production CPU and a successful scheduled scan after the fix still need observation. Preview checks do not prove the free-plan CPU budget.

The existing production recipient was preserved, not re-enrolled. New challenge pairing applies at the next setup. Ownership can be reconfirmed by rerunning configuration after securing the local workspace. No evidence of actual credential leakage or account compromise was found; broad local access cannot prove retrospectively that no credential was read.

## Pending local permission change

Review `scripts/secure-workspace.ps1` without `-Apply` for inspection only. Application would change the project root and `.dev.vars`, with inherited changes potentially propagating to children. It removes broad-group allow rules, preserves specific user/automation entries and deny rules, grants the current user/SYSTEM/Administrators full access, and backs up original root/credential ACLs. It changes no directory outside the project.

Legitimate users relying only on broad groups may lose access. Explicit approval and knowledge of necessary users are required before applying this change. After approval, verify ACLs, repeat the privacy guard, and confirm normal owner/automation access. In a machine shared with untrusted local users, consider replacing credentials after restricting access. Never include credential values in the audit record.

References: [Telegram setup links](https://core.telegram.org/api/links#bot-links), [Telegram update queues](https://core.telegram.org/bots/api#getupdates), [OWASP URL validation](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html), [OWASP outbound request guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).
