# Telegram wishlist discount bot

Private Telegram alerts for discounted Steam games and wishlisted DLC, comparing authorized retailers for a buyer in Thailand. It runs roughly hourly on Cloudflare Workers Free while your computer is off.

## What it does

- Reads your Steam wishlist automatically, including additions and removals.
- Compares native Thai Steam prices with Steam-redeemable offers from IsThereAnyDeal's authorized retailers: Green Man Gaming, GamersGate, GameBillet, Fanatical, Gamesplanet, Humble Store, and other active feed shops.
- Checks Fanatical's direct Thailand catalog and validated 2Game Thai products.
- Sends the cheapest discounted offer per product in one logical digest. Large digests split at Telegram's size limit.
- Alerts on the first check, newly wishlisted discounts, later sales, and further price reductions. Unchanged offers and exchange-rate changes alone stay quiet.
- Shows source currency and estimated THB using dated ECB rates through Frankfurter.
- Clearly marks **Thailand activation unverified** when regional eligibility is unknown. Explicit Thailand restrictions, non-Steam keys, bundles, substitute editions, conditional vouchers, and key resale marketplaces are excluded.
- Preserves price history on failed reads, retries unsent digests, and reports persistent failures once rather than every hour.

**Validation:** the implementation has passed offline tests, real source comparisons, and an initial Telegram delivery using production storage. Native Cloudflare cron execution and its CPU usage still need to be observed. See [validation results](docs/validation.md) for the scope of these checks.

## Activate it

Requires Node.js 22 or newer and a free Cloudflare account. This project has no runtime package dependencies; Wrangler is a development/deployment tool.

### 1. Prepare credentials

1. In Telegram, open [BotFather](https://t.me/BotFather), send `/newbot`, and create your bot. Keep its token private.
2. Open [IsThereAnyDeal Apps](https://isthereanydeal.com/apps/), create a personal application, and obtain its **API key**. Use personal access without enabling any paid service. The bot requires this key; it does not silently fall back to Steam-only monitoring.
3. Run these commands in this folder:

```powershell
npm ci
npm run configure
```

On a fresh checkout, the setup command copies `wrangler.example.jsonc` to ignored `wrangler.jsonc` and asks for your public Steam wishlist URL or 17-digit Steam ID. It keeps existing local configuration intact. Steam vanity-name URLs are not supported; use the numeric profile URL.

The command first checks local directory permissions, hides secret input, and verifies your bot. It prints a fresh setup link; open that link and press Start in your own private chat. Only a matching setup code can select the private recipient. It saves credentials atomically to ignored `.dev.vars`, without sending test messages. For manual setup, copy `wrangler.example.jsonc` to `wrangler.jsonc`, set `vars.STEAM_ID`, and copy `.dev.vars.example` to `.dev.vars` before filling in credentials. Do not paste credentials into chat or commit them. See [security requirements](SECURITY.md) if setup refuses unsafe directory permissions.

### 2. Preview the real wishlist

```powershell
npm run preview
```

This fetches real offers and prints the proposed digest. It **does not send messages or advance alert history**. Check the reported retailer coverage, region labels, and products before deployment. API errors remain errors, rather than appearing as an empty offer list.

Your wishlist ID is stored in local `wrangler.jsonc`. Keep `COUNTRY` as `TH`. `REFERENCE_COUNTRY=US` labels the foreign-region feed data accurately: ITAD does not currently provide native Thai coverage. Feed amounts are reported prices, not a promise of the final checkout price.

### 3. Deploy on Cloudflare Free

```powershell
npm run login
npm run deploy
```

Choose a **Workers Free** account and verify its email address. New accounts also need their initial Workers setup, including a workers.dev subdomain, before Cloudflare accepts cron schedules. The bot's public HTTP route remains disabled. Deployment first validates the live price feed, creates a KV namespace if needed, writes its binding to `wrangler.jsonc`, and deploys code and secrets together. No script upgrades your account to a paid plan. `.dev.vars` is uploaded as encrypted Worker secrets, not bundled into source.

Checks run at **minute 00 of each hour** (also minute 00 in Bangkok). Schedule changes may take about 15 minutes to propagate. Retailer data and free scheduling can lag; one-hour delivery is a target, not a guarantee. The first complete check sends existing qualifying discounts.

```powershell
npm run logs
```

Logs contain counts and redacted error codes. Check Cloudflare's dashboard for CPU usage after activation. The bundle and local benchmark are verified locally; **deployed CPU time and private account quotas cannot be verified before account access**. Free-plan limits stop work rather than authorizing a paid upgrade.

## Store coverage and exact matching

IsThereAnyDeal supplies broad per-retailer offers. The bot verifies forward and reverse Steam application mappings, rejects shared/ambiguous application containers, requires explicit Steam DRM, and rejects known edition mismatches in merchant URLs. Ordinary feed assignments remain dependent on the provider's catalog accuracy; the API does not expose independent per-offer SKU proof. There is no fuzzy title fallback. Returned attribution links are preserved.

Fanatical is queried with `region=TH` and exact Steam IDs. Direct stock and region observations supersede foreign feed copies. DLC must match a DLC product; a related base game is never substituted.

**2Game uses a direct adapter.** The initial validated mapping is **Mount & Blade II: Bannerlord**. Other wishlist products continue to use the broad feed and Fanatical but do not claim 2Game coverage until mapped. The digest states the mapping count.

To add another 2Game product, supply its Steam app ID and exact Thai product URL:

```powershell
npm run add:2game -- 261550 "https://www.2game.com/th-th/products/mount-blade-ii-bannerlord-steam-key"
```

This helper requires matching title and publisher, a single stable variant, Steam DRM, and Thai THB context before saving the mapping. It stops on rate limits and never guesses a URL. Review the resulting `config/2game-products.json`, then redeploy. The direct adapter allows eight mapped products per check to reserve the free runtime's request budget; broad feed coverage is independent of that limit. The batched source path has a 200-product safety limit.

GG.deals is useful for discovering retailers. Its free API supplies aggregate prices without per-offer retailer/DRM information, so it cannot replace this bot's Steam-only offer filtering. The bot does not scrape GG.deals or Humble's website.

## Reliability and privacy

- The Worker has no public command endpoint; HTTP requests receive 404. Tokens and the allowed positive private chat ID stay in secret storage.
- A failed/private wishlist is never interpreted as an empty wishlist. Failed comparisons keep their last baseline; affected products pause until recovery.
- A required broad-feed failure pauses the scan. An optional direct-source failure pauses affected comparisons rather than fabricating a sale ending.
- Failure notices start after three unsuccessful checks and repeat only after recovery and a new outage.
- A persisted outbox resumes after acknowledged digest parts. If Telegram accepts a message but the subsequent storage write fails, a duplicate remains possible; delivery is not exactly-once. Pending digests older than two hours are discarded and recalculated.
- Production state writes are serialized with at least 1.1 seconds after each completed write, respecting KV's one-write-per-second limit for the same key.
- Only one hourly cron is configured. Do not run a second production scheduler against the same state. The local preview uses no delivery history writes; `npm run send` uses separate local state and is for deliberate local testing, not a second scheduler.
- Rates are cached daily, retain their observation date, and can be reused for up to seven days through outages/holidays. Missing conversion data pauses affected comparisons.

## Validation

```powershell
npm test
npm run check
npm run build
npm run check:live
npm run benchmark
```

The test suite covers matching and exclusions, cheapest-offer selection, price and FX changes, initial/later alerts, removal/re-addition, failures, retry checkpoints, safe formatting, and private access. `check:live` sends no Telegram messages; it explicitly reports authenticated ITAD prices as **not tested** until the key exists. `benchmark` measures local parsing/comparison/formatting, not Cloudflare's deployed CPU accounting.

See [the specification](docs/spec.md), [validation results](docs/validation.md), [source research](docs/integration-research.md), and [project vocabulary](GLOSSARY.md).

Read [the security policy](SECURITY.md) and [application audit](docs/security-audit.md) before using real credentials. Publication checks and local operating-system access checks protect different boundaries.

## Repository and GitHub

The repository contains `wrangler.example.jsonc` and empty `.dev.vars.example` as shareable templates. Real `wrangler.jsonc`, `.dev.vars`, delivery history, logs, build output, and dependencies are ignored. Keep local configuration when updating an existing deployment; replacing its KV namespace would start new notification history.

GitHub Actions runs syntax checks, offline tests, and a dry-run Worker build on Node.js 22 and 24. CI requires no Telegram, IsThereAnyDeal, or Cloudflare credentials, sends no messages, and does not deploy. Action versions are pinned to commit hashes. Live source checks and deployment are explicit local commands.

For a newly initialized local repository with its initial commit, create an empty GitHub repository, then set its URL and push:

```powershell
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```
