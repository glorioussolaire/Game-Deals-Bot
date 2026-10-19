# Validation

Verified on 19 October 2026. Local comparisons and private Telegram delivery pass. The hourly cloud job runs, but direct-retailer rate limits currently prevent complete comparisons there.

## Application checks

- All 47 offline tests pass, covering exact matching, retailer and region exclusions, cheapest-offer selection, price and FX changes, wishlist changes, source failures, delivery retries, bounded responses, and private credential storage.
- `npm run check` parses all application, script, and test JavaScript successfully.
- A clean public checkout passed a dry-run Worker build without credentials or live API access. GitHub Actions validates Node.js 22 and 24 with pinned official actions and no deployment credentials.
- `npm audit --audit-level=high` reported zero known vulnerabilities in the locked dependency tree. There are no runtime npm dependencies.
- The deployed hardened Worker bundle was 39.94 KiB, or 11.90 KiB gzipped, with reported startup time of 1 ms. Startup and local benchmarks do not measure full-scan cloud CPU consumption.
- Windows workspace and credential permissions were restricted and verified. Synthetic atomic credential replacement and normal project access passed. See [the security audit](security-audit.md).

## Live source and delivery checks

- An authenticated local preview compared all 28 current wishlist products, finding 12 qualifying discounts across Steam and authorized Steam-key retailers. It used 14 requests, sent no messages, and changed no alert history.
- The preview successfully queried the broad IsThereAnyDeal feed, Fanatical's Thailand catalog, the validated 2Game mapping, and dated exchange rates. Foreign offers retained their original currency and Thailand-unverified labels; FX observations were dated 16 October 2026.
- 2Game covers one explicitly validated product, Mount & Blade II: Bannerlord. No full-wishlist 2Game coverage is claimed.
- An initial commissioning run used production KV and delivered one digest for 27 products. Telegram acknowledged the digest, and delivery baselines were stored in the cloud.
- A separate labeled delivery test verified the configured private recipient and received Telegram's acknowledgement for one test message. It did not change discount history. API acknowledgement does not independently verify phone notification settings.

## Cloud execution and remaining limits

- The deployed Worker has three encrypted secret bindings, disabled public and preview HTTP routes, and a single `0 * * * *` schedule. Checks run at minute 00 of each hour in Bangkok as well as UTC.
- A read-only production check confirmed an attempt at 07:00:29 UTC, or 14:00 Thailand time. Fanatical and 2Game returned HTTP 429. The bot paused comparisons, retained 27 prior product baselines, and had no pending messages after that run. A run timestamp alone does not establish complete source coverage.
- Rate-limited sources are retried on the next hourly check. Persistent failures produce one notice after three unsuccessful checks, with a new notice only after recovery and another outage.
- A complete cloud scan and actual free-plan CPU consumption remain unverified. The observability query API returned HTTP 403 with the current login; no broader permissions or paid services were enabled.
- Local live success and a successful cloud preview do not establish reliable scheduled access to every retailer. Store coverage remains dependent on product mappings, availability, and upstream access.

See [the specification](spec.md) for expected behavior and [the README](../README.md) for setup and operating commands.
