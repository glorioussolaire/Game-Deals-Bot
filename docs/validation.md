# Implementation validation

Verified on 19 October 2026. Credentials, authenticated comparisons, deployment, schedule registration, and initial real delivery passed. The security audit reproduced and fixed a Workers redirect incompatibility that prevented native checks; hardened public adapters now pass in a Cloudflare preview. A successful full scheduled scan after the fix and complete-scan CPU remain pending observation. See [the audit](security-audit.md).

## Completed checks

- The offline test suite covers first-run/later-sale alerts, further reductions, unchanged and FX-only suppression, wishlist changes, missing rates, bad source schemas, ambiguous Steam identities, valid omitted price records, region exclusions and unverified labels, message escaping/splitting, source-failure recovery, resumable delivery checkpoints, serialized KV write pacing, and safe fresh-checkout configuration.
- `npm run check`: all project JavaScript parsed successfully.
- Cloudflare Wrangler 4.151.1 compiled and deployed the audited Worker: 39.94 KiB, 11.90 KiB gzipped. Reported startup time: 1 ms; this is not the CPU time of a complete scan.
- Local Cloudflare `workerd` verification: the complete mocked source/delivery flow produced two initial alerts in one digest, zero unchanged alerts, and two later reductions in one digest. No real Telegram API call was made. The temporary local test server was stopped afterward.
- `npm run benchmark`: 27 products and 540 offers, including parsing and formatting, measured approximately 0.59 ms median and 0.80 ms p95 locally. This excludes external-response handling and is not deployed Cloudflare CPU accounting.

## Public live-adapter checks

`npm run check:live` successfully read the actual configured wishlist without login or Telegram delivery:

- 27 wishlist entries and 27 exact Steam metadata records.
- Native THB Steam prices for 23 entries; the other entries did not provide a current store price.
- Fanatical matched 11 catalog entries; eight direct offers passed the adapter checks in the latest run. Counts vary with catalog/stock/coupon changes.
- One validated 2Game Thai product mapping returned its native THB offer without adapter failures.
- Dated EUR/USD/GBP/THB reference rates were available; the latest working-day date was 16 October 2026.
- Ten public source requests; no Telegram contact or notifications.

## Authenticated live preview

- Local configuration completed without exposing credentials.
- `npm run preview` successfully compared all 27 wishlist entries and generated 11 qualifying discount alerts in one preview digest. No messages were sent and no alert history was advanced.
- The authenticated broad feed supplied 23 current-price records for 27 exact mapped identities. It legitimately omitted four products without current feed prices. The adapter now distinguishes omitted records from malformed rows and HTTP failures, with regression tests for both cases.
- Candidate offers included Steam, Green Man Gaming, GameBillet, Gamesplanet storefronts, GamersGate, Humble Store, Fanatical, 2Game, and other active authorized-feed retailers. Retailer counts and qualifying prices are observations that change over time.
- The complete preview used 14 source requests. Returned attribution links were preserved; reference-region offers carried the Thailand-unverified label.

## Not yet verified

- A successful complete native cron scan after the redirect fix and actual free-plan CPU consumption. The observability query API returned HTTP 403. The private Cloudflare preview, local benchmark, startup, and manual commissioning do not substitute for these checks.
- Additional 2Game products: the adapter includes only explicitly validated mappings. The initial mapping is Bannerlord; no full 2Game-wishlist coverage is claimed.

## Deployment and first delivery

- Email verification and initial Workers account setup completed. The existing KV namespace was reused; no paid plan was enabled.
- Account-specific Worker and storage identifiers remain in ignored local configuration.
- Cloudflare's API initially confirmed the `17 * * * *` schedule, all three `secret_text` bindings, persistent logs, and disabled public and preview HTTP routes. After the user's request, the schedule was changed to `0 * * * *`; a follow-up API read confirmed it is the only active schedule, with modification time `2026-10-19T04:35:53.402483Z`. Local configuration and deployment instructions also use minute 00.
- An initial scan was run once from the setup computer using the real production KV namespace. It compared all 27 products and sent one digest containing 11 discounts; Telegram acknowledged it. The complete run used 15 source/delivery requests. Delivery checkpoints and final baselines were committed to cloud storage, rather than the separate local testing history.
- KV checkpoints now leave at least 1.1 seconds after each completed write, respecting the documented per-key write limit. Tests verify ordering, spacing, idle scans, and propagation of storage errors.
- Native checks are configured for minute 00 of each hour in both UTC and Bangkok time. No additional scheduler or public manual-trigger endpoint was created.

Preview does not send alerts or advance delivery history; deployment validates the authenticated feed before creating or publishing cloud resources.

## GitHub preparation

- Syntax checks and all 47 offline tests passed locally on Node.js 26.4.0, including the security regressions.
- A clean copy of the staged files passed the same checks and a dry-run Worker build using only the public configuration template. No credentials, wishlist, or live API access were needed for those checks.
- `npm audit --audit-level=high` reported zero vulnerabilities in the locked dependencies.
- Real credentials, account-specific configuration, logs, local history, dependencies, and generated output are ignored. The staged source was checked against local credential values and deployment identifiers without displaying those values.
- GitHub Actions is configured for Node.js 22 and 24 with read-only repository permissions and pinned official actions. Those hosted jobs run after the repository is pushed; no automatic deployment is configured.
