# Telegram wishlist discount bot

Private Telegram alerts for discounted Steam games and wishlisted DLC, comparing authorized retailers for a buyer in Thailand. It runs roughly hourly on Cloudflare Workers Free while your computer is off.

## What it does

- Reads your Steam wishlist automatically, including additions and removals.
- Compares native Thai Steam prices with Steam-redeemable offers from IsThereAnyDeal's authorized retailers: Green Man Gaming, GamersGate, GameBillet, Fanatical, Gamesplanet, Humble Store, and other active feed shops.
- Checks Fanatical's direct Thailand catalog and validated 2Game Thai products.
- Sends the cheapest eligible offer per product when that offer is discounted, in one logical digest. Large digests split at Telegram's size limit.
- Alerts on the first check, newly wishlisted discounts, later sales, and further price reductions. Unchanged offers and exchange-rate changes alone stay quiet.
- Responds to `/deals` with all discounts from the latest saved hourly checks, even if you deleted Telegram chat history. This does not reset automatic alerts.
- Shows source currency and estimated THB using dated ECB rates through Frankfurter.
- Clearly marks **Thailand activation unverified** when regional eligibility is unknown. Explicit Thailand restrictions, non-Steam keys, bundles, substitute editions, conditional vouchers, and key resale marketplaces are excluded.
- Preserves price history on failed reads, retries unsent digests, and reports persistent failures once rather than every hour.

**Validation:** all 63 tests pass, including private command authorization, saved-list restoration, polling acknowledgements, and delivery retries. Hourly cloud execution and private delivery are confirmed; retailer rate limits can pause comparisons.

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

The command first checks local directory permissions, hides secret input, and verifies your bot. It prints a fresh setup link; open that link and press Start in your own private chat. Only a matching setup code can select the private recipient. It saves credentials atomically to ignored `.dev.vars`, without sending test messages. For manual setup, copy `wrangler.example.jsonc` to `wrangler.jsonc`, set `vars.STEAM_ID`, and copy `.dev.vars.example` to `.dev.vars` before filling in the bot token, private chat ID, and API key. Do not paste credentials into chat or commit them. See [security requirements](#security) if setup refuses unsafe directory permissions.

Before re-pairing a running polling installation, temporarily remove its `* * * * *` command cron in the Cloudflare dashboard and allow the schedule change to propagate. Keep the hourly cron. Otherwise the cloud poller could consume the setup message. Redeployment restores both schedules. Legacy webhooks are temporarily suspended during re-pairing and restored afterward until deployment migrates them to polling.

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

Choose a **Workers Free** account and verify its email address. New accounts also need their initial Workers setup. Deployment validates the live price feed, creates a KV namespace if needed, and publishes code and secrets together. It disables workers.dev, preview URLs, and configured HTTP routes. It registers `/deals` and `/help` for your private chat and removes any old Telegram webhook while preserving queued updates. Commands are fetched directly from Telegram every minute, so replies normally take up to one minute. No script upgrades your account to a paid plan. `.dev.vars` is uploaded as encrypted Worker secrets, not bundled into source.

Checks run at **minute 00 of each hour** (also minute 00 in Bangkok). Schedule changes may take about 15 minutes to propagate. Retailer data and free scheduling can lag; one-hour delivery is a target, not a guarantee. The first complete check sends existing qualifying discounts.

```powershell
npm run logs
```

Logs contain counts and redacted error codes. Check Cloudflare's dashboard for CPU usage after activation. Local benchmarks do not establish deployed CPU consumption. Free-plan limits stop work rather than authorizing a paid upgrade.

## Restore the full discount list

Send **`/deals`** to the bot, or select it from the command menu. It returns the cheapest discounted offer for each product in the latest saved hourly prices, including offers already sent earlier. Clearing the conversation does not lose access to this list. `/start` and `/help` explain the command.

This command reads saved prices rather than polling retailers again. Each game shows its comparison time; paused products retain their earlier timestamp, and prices older than 24 hours are omitted with a warning. Expired offers and unusable exchange rates are excluded. Missing saved data produces an explicit message. Store prices can change before the next hourly check.

Only your configured private Telegram account can request the list. Commands are checked every minute; requests processed within ten seconds of another new command are ignored. Command delivery checkpoints use separate KV keys and never change automatic alert baselines. Standard hourly messages continue to contain only new or cheaper discounts.

## Store coverage and exact matching

IsThereAnyDeal supplies broad per-retailer offers. The bot verifies forward and reverse Steam application mappings, rejects shared/ambiguous application containers, requires explicit Steam DRM, and rejects known edition mismatches in merchant URLs. Ordinary feed assignments remain dependent on the provider's catalog accuracy; the API does not expose independent per-offer SKU proof. There is no fuzzy title fallback. Returned attribution links are preserved.

Fanatical is queried with `region=TH` and exact Steam IDs. Direct stock and region observations supersede foreign feed copies. DLC must match a DLC product; a related base game is never substituted.

**2Game uses a direct adapter.** The initial validated mapping is **Mount & Blade II: Bannerlord**. Other wishlist products continue to use the broad feed and Fanatical but do not claim 2Game coverage until mapped. The digest states the mapping count.

To add another 2Game product, supply its Steam app ID and exact Thai product URL:

```powershell
npm run add:2game -- 261550 "https://www.2game.com/th-th/products/mount-blade-ii-bannerlord-steam-key"
```

This helper requires matching title and publisher, a single stable variant, Steam DRM, and Thai THB context before saving the mapping. It stops on rate limits and never guesses a URL. Review the resulting `config/2game-products.json`, then redeploy. The direct adapter allows eight mapped products per check to reserve the free runtime's request budget; broad feed coverage is independent of that limit. The batched source path has a 200-product safety limit.

## Reliability and privacy

- Commands are fetched directly from Telegram and accepted only from the configured private human sender. Public HTTP and preview URLs are disabled, and the HTTP handler always returns 404. Bot credentials and the allowed private chat ID stay in secret storage.
- A failed/private wishlist is never interpreted as an empty wishlist. Failed comparisons keep their last baseline; affected products pause until recovery.
- A required broad-feed failure pauses the scan. An optional direct-source failure pauses affected comparisons rather than fabricating a sale ending.
- Failure notices start after three unsuccessful checks and repeat only after recovery and a new outage.
- A persisted outbox resumes after acknowledged digest parts. If Telegram accepts a message but the subsequent storage write fails, a duplicate remains possible; delivery is not exactly-once. Pending digests older than two hours are discarded and recalculated.
- Production state writes are serialized with at least 1.1 seconds after each completed write, respecting KV's one-write-per-second limit for the same key.
- Only the hourly `0 * * * *` cron scans stores. The separate `* * * * *` cron polls commands and reads saved prices. `/deals` does not trigger another scan. Do not run a second production scheduler or Telegram update consumer against the same bot. The local preview uses no delivery history writes; `npm run send` uses separate local state and is for deliberate local testing, not a second scheduler.
- Each minute poll reads at most 100 updates. Empty polls make no KV reads or writes; ignored users also cause no KV access. Telegram retains unconfirmed updates until processing succeeds, and separate delivery checkpoints prevent ordinary retries from resending completed parts. Scheduling and Telegram outages can delay commands.
- Rates are cached daily, retain their observation date, and can be reused for up to seven days through outages/holidays. Missing conversion data pauses affected comparisons.

## Security

### Credentials and local access

Keep `.dev.vars`, real `wrangler.jsonc`, `.data/`, `.wrangler/`, and deployment logs out of Git. Credential examples must remain empty. Ignore rules protect publication; operating-system permissions protect local access.

Use a project directory trusted only by its owner and necessary administrators or automation. Anyone who can modify application code can change what runs with its credentials. Setup refuses broad Windows group access and group/other-writable Unix directories. Credential replacement uses an exclusive temporary file and atomic rename; Unix files use mode `0600`, which alone does not establish a private Windows ACL.

If setup reports `private_workspace_permissions_required_see_README_md`, inspect Windows permissions with:

```powershell
.\scripts\secure-workspace.ps1
```

The default is read-only. Optional `-Apply` removes broad-group allow rules from the project and credential file, protects inheritance, preserves specific user/automation entries and deny rules, and grants the current user, SYSTEM, and Administrators full access. Inherited changes can propagate to child files. Original root and credential ACLs are saved in ignored `.data/security-acl-backup.json`. Review necessary users before applying; no permissions outside the project are changed.

Cloudflare stores the bot token, private chat ID, and price-feed API key as Worker secrets. Logs contain counts and known error codes; Worker query strings are redacted. Check raw diagnostics before sharing them.

### Private Telegram access

Recipient setup uses a fresh cryptographically random `/start` link. Ordinary messages, previous codes, mismatched sender/chat IDs, groups, and ambiguous matches cannot select the recipient. Setup examines the latest 100 updates; Telegram's negative offset discards older queued updates. Use a dedicated personal bot.

There is no public command endpoint: workers.dev, preview URLs, and configured HTTP routes are disabled. This prevents arbitrary HTTP traffic from invoking the Worker and exhausting its free request quota. Do not enable a public route or add an inbound webhook. The fallback HTTP handler always returns 404.

The minute cron fetches updates over fixed-origin HTTPS using the bot token. Commands require a fresh private message from the configured human sender. Forwarded commands, edited messages, groups, and other users are ignored before KV access. Command text selects fixed actions; it is never executed. Telegram response sizes and per-poll requests are bounded.

Telegram documents [update acknowledgement and queue retention](https://core.telegram.org/bots/api#getupdates) and [private command menu scopes](https://core.telegram.org/bots/api#botcommandscopechat). Updates are acknowledged only after accepted commands finish. Updates returned during acknowledgement stay queued for the next poll. Command-menu visibility alone is not authorization. Command checkpoints are bounded and retained for 24 hours in separate KV keys; a ten-second processing cooldown limits repeat work. A Telegram message flood could delay command processing, so use a dedicated personal bot.

### External data and trust

- Requests use fixed, approved HTTPS hostnames. Redirects are returned manually and rejected without forwarding credentials. Responses are limited to 4 MiB, requests time out after 20 seconds, and scans have a 45-request budget.
- Purchase links require HTTPS, a standard port, no userinfo or control characters, and an exact approved origin. ITAD links use `itad.link` or `isthereanydeal.com`; direct links use the retailer's domain. Attribution parameters are preserved; changed provider link formats require review.
- Telegram text and link attributes are HTML-escaped. Storefront scripts and MCP instructions are never executed.
- Stored state, delivery cursors, message sizes, and commit snapshots are validated before use. Malformed state stops processing rather than resetting history. FX validation rejects invalid/future dates, duplicate or unrequested quotes, non-finite rates, and stale caches.

The application trusts its OS user, authorized Cloudflare administrators, private KV, Telegram, and price providers. Origin checks cannot independently authenticate an ITAD redirect's eventual destination or provider catalog assignments. KV is not a distributed lock; delivery followed by a failed checkpoint can produce a duplicate. Dependency checks cannot exclude undisclosed vulnerabilities.

Manual review and regression tests covered pairing, private command authorization, polling acknowledgements, disabled HTTP handling, destination checks, response limits, persisted state, FX validation, and local credential access. These checks do not constitute independent certification or provider/account penetration testing. Report vulnerabilities privately through GitHub's security reporting if enabled; never include real tokens or private chat IDs in public issues. Rotate credentials through their issuing services if compromise is confirmed.

## Validation

```powershell
npm test
npm run check
npm run build
npm run check:live
npm run benchmark
```

The test suite covers matching and exclusions, cheapest-offer selection, price and FX changes, initial/later alerts, removal/re-addition, failures, retry checkpoints, safe formatting, and private access. `check:live` sends no Telegram messages; it explicitly reports authenticated ITAD prices as **not tested** until the key exists. `benchmark` measures local parsing/comparison/formatting, not Cloudflare's deployed CPU accounting.

Verified on 19 October 2026: a live preview compared all 28 wishlist products, and a deployed `/deals` test restored the full saved list while leaving the production alert-history record unchanged. The owner also confirmed receiving the list after sending the command through Telegram. A complete cloud scan with every source available and its free-plan CPU consumption remain unverified.

## Repository and GitHub

The repository contains `wrangler.example.jsonc` and empty `.dev.vars.example` as shareable templates. Real `wrangler.jsonc`, `.dev.vars`, delivery history, logs, build output, and dependencies are ignored. Keep local configuration when updating an existing deployment; replacing its KV namespace would start new notification history.

GitHub Actions runs syntax checks, offline tests, and a dry-run Worker build on Node.js 22 and 24. CI requires no Telegram, IsThereAnyDeal, or Cloudflare credentials, sends no messages, and does not deploy. Action versions are pinned to commit hashes. Live source checks and deployment are explicit local commands.

The published repository protects `main` with both `validate (22)` and `validate (24)` checks, requires the branch to be current before merging, and blocks deletion and force pushes without bypass actors. Make changes on a feature branch, push it, and merge after CI passes.

Use your GitHub-provided noreply address in this checkout's `git config user.email` before committing. The original six published commits were rewritten with a noreply address while preserving their files, messages, and dates. Other clones must resync; do not merge old history back into `main`. Rewriting cannot erase addresses from existing copies or GitHub caches. Local backup refs must stay private; never publish them with `git push --mirror`.
