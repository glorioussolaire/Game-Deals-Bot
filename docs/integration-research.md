# Integration Research

Research checked on 18 October 2026 and used for the approved implementation. See validation.md for implementation checks and remaining activation prerequisites.

## Steam wishlist and regional baseline

A read-only request to Steam's current `IWishlistService/GetWishlist/v1/` endpoint returned 27 wishlist items for the supplied profile without login. Steam's store `api/appdetails` endpoint with `cc=TH` returned a THB price for wishlist game 261550, Mount & Blade II: Bannerlord. This verifies current access for this wishlist and one regional price; it does not make these undocumented endpoints a supported long-term contract.

The [documented Steamworks Web API catalog](https://partner.steamgames.com/doc/webapi?l=english) does not document the wishlist endpoint or this consumer store price endpoint. Isolate these dependencies and report source failures without treating an inaccessible wishlist as empty.

## Cross-store price discovery

### Verified direct retailer: Fanatical

Fanatical publishes a [free catalog for automated clients](https://www.fanatical.com/for-ai) at its first-party MCP endpoint, `https://mcp.fanatical.com/mcp`. A read-only call to `get_product` with Steam ID 261550 and region TH returned the exact base game, Steam DRM, in-stock availability, a 16% discount, and an original purchase currency of USD. This provides a viable initial retailer integration without an account or API key. The catalog's Thai region filtering and activation semantics still need to be distinguished precisely; do not describe a country-filtered offer as an unconditional activation guarantee.

This live sample was USD 41.99 against USD 49.99. Those are USD checkout amounts for the requested region, not native THB prices. Any THB conversion would be an estimate requiring explicit presentation and a reference exchange rate. Catalog ingestion can lag retailer changes by approximately ten minutes according to the first-party documentation.

The user prefers more stores than Steam plus Fanatical. The supported-store set must be stated explicitly; cheapest means cheapest among the supported, eligible offers.

### Verified additional retailer: Gamesplanet

The [US Bannerlord base-product page](https://us.gamesplanet.com/game/mount-blade-ii-bannerlord-steam-key--3901-1) returned public JSON-LD with current USD price, Steam-key delivery, stock information, and activation restriction notices. The same SKU is sold on the UK and DE storefronts; those live pages explicitly showed activation in Thailand. The product's restriction list excluded China, Hong Kong, Taiwan, and Macao, rather than Thailand. A negative-control product, [Kerbal Space Program](https://uk.gamesplanet.com/game/kerbal-space-program-steam-key--3384-1), explicitly included Thailand in its denylist.

[Gamesplanet's official support](https://uk.gamesplanet.com/support) states that keys come directly from publishers, worldwide ordering is supported, and product notices disclose activation restrictions. The [US robots file](https://us.gamesplanet.com/robots.txt) had no active disallow rules; no explicit automation restriction or request quota was found in the [US public terms](https://us.gamesplanet.com/legal_terms) during this check. Treat changed or blocked pages as unavailable rather than attempting to bypass them.

The tested pages do not expose a Steam app ID. Establish identity through validated Steam-app-to-Gamesplanet-SKU mappings; search results and similar titles are only candidate discovery. Current sample mapping: Steam app 261550 to Gamesplanet SKU 3901-1. Preserve this distinction for new wishlist entries and report incomplete store coverage honestly. A single Gamesplanet storefront is the proposed starting point to keep request volume within the free-hosting budget; the other storefronts are not separate retailer integrations.

### Other retailers investigated

[Green Man Gaming's Mount & Blade page](https://www.greenmangaming.com/games/mount-blade-pc/) exposes Steam app/package IDs, edition, price/currency, stock, sellability, and excluded countries in embedded product JSON. The test response reported Thailand, but explicit selection of Thai context from a cloud host remains unverified. Do not count this adapter as supported unless that prerequisite is validated.

No free supported Humble Store catalog API was verified. Its [current robots file](https://www.humblebundle.com/robots.txt) expressly requires written permission for automated extraction; exclude an automated Humble adapter from the initial plan.

### Broader discovery: IsThereAnyDeal

[IsThereAnyDeal's API](https://docs.isthereanydeal.com/) can batch price lookups for up to 200 game IDs and exposes retailer, currency, DRM, timestamps, expiry, and offer URLs. It requires an application API key. Its [shop policy](https://isthereanydeal.com/faq/#a:shops) fits the authorized-retailer scope. The public documentation does not establish a guaranteed free API entitlement; verify access during registration before committing to it.

Thailand is absent from the currently tracked region columns in the [status dataset](https://isthereanydeal.com/status/api/overview/). The official [country coverage FAQ](https://isthereanydeal.com/faq/#a:untracked) explains the US fallback for untracked countries, and its [currency FAQ](https://isthereanydeal.com/faq/#a:currencies) distinguishes conversion for convenience from local checkout prices. Current shop-list requests for TH and US returned identical data. Do not present fallback US prices as verified Thai prices.

The documented offer schema has Steam DRM metadata but no explicit activation-country allow/deny list. A Steam flag alone cannot establish activation in Thailand. [Fanatical's activation guidance](https://support.fanatical.com/hc/en-us/articles/202652231-Can-games-be-activated-in-the-country-that-my-gamer-account-is-associated-with) describes product-specific country restrictions. The user subsequently accepted offers with unknown Thailand activation if clearly labeled, making a broad per-offer feed viable; known Thailand restrictions still exclude an offer.

The current [active US shop feed](https://api.isthereanydeal.com/service/shops/v1?country=US) includes Fanatical (6), GameBillet (20), GamersGate (24), Gamesplanet UK/DE/FR/US (26/27/28/29), Green Man Gaming (36), and Humble Store (37). 2game (19) appears in the historical mapping but not this active feed. Do not count 2Game as live feed coverage.

An account-free documented batch lookup `POST /lookup/id/shop/61/v1` using `app/261550` and `app/1570510` successfully returned the exact ITAD identities for Bannerlord and Undernauts. The authenticated per-offer price response remains untested without a key. [Personal API onboarding](https://isthereanydeal.com/apps/) describes a regular account and app registration producing credentials, with no payment prerequisite found; do not claim a tested billing guarantee. Keep the zero-cost constraint and validate access before deployment.

### User-provided store-discovery references

The user supplied [GG.deals' Undernauts comparison](https://gg.deals/game/undernauts-labyrinth-of-yomi/) and [2Game's Thai storefront](https://www.2game.com/th-th) as evidence that retailer coverage should be broader. GG.deals separates official stores from keyshops; its [store directory](https://gg.deals/stores/) lists 2Game, Green Man Gaming, GamersGate, and Gamebillet as official stores. 2Game's Thai storefront displays THB prices. Direct catalog feasibility is under investigation; discovery is not a claim that an adapter is implemented.

GG.deals offers a [free personal API](https://gg.deals/api/) with exact Steam-app-ID lookup and separate aggregate official-store and keyshop prices. Its [documented response](https://gg.deals/api/prices/) supplies only aggregate minimums, currency, title, and the comparison-page URL; it does not identify the retailer, DRM, original/list price, or a particular purchase offer. Thailand is absent from its supported API region list. Do not infer Steam redemption, a retailer, Thai eligibility, or a discount percentage from an aggregate price. Its documented allowance supports up to 100 IDs per batch and 1,000 records per hour.

The current [GG.deals terms](https://gg.deals/terms/) prohibit automated page downloads; the free API's missing offer fields are not a reason to build a website-scraping workaround. Use per-retailer feeds or appropriate direct retailer sources instead.

2Game is listed in [SEGA's approved retailer list](https://privacy.sega.com/en/sega-europe-approved-partner-list), and its [help center](https://2game.zendesk.com/hc/en-us/articles/360007554031-2Game-is-an-Official-Authorized-Digital-Retailer-but-What-does-it-mean) describes publisher-direct keys. Its Thai Shopify storefront returned native THB prices, regular prices, and discount percentages. Subsequent Thai product/search requests returned HTTP 429, so testing stopped rather than bypassing the restriction. A reliable public product adapter, exact Steam-app matching, and Thai activation metadata remain unverified. Country uncertainty can be labeled under the accepted policy; identity and data-access uncertainty cannot be mistaken for valid offers.

## Private Telegram delivery

The user creates a bot through BotFather and starts its private chat before the bot can send personal alerts. Store the bot token as a secret and restrict delivery to the user's chat. Large digests may need to be split to respect Telegram's message limit. Sources: [official tutorial](https://core.telegram.org/bots/tutorial), [Bot API](https://core.telegram.org/bots/api#sendmessage).

## THB reference conversions

[Frankfurter v2](https://frankfurter.dev/) provides free, unauthenticated exchange-rate data. Its ECB-scoped [EUR-to-USD/GBP/THB batch endpoint](https://api.frankfurter.dev/v2/providers/ecb/rates?base=EUR&quotes=USD,GBP,THB) returned HTTP 200 with dated observations. Rates represent quote-currency units per one EUR. Convert a source-currency amount using its EUR reference cross rate and retain the observation date.

[ECB reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html) update on working days, so Friday's rate on a weekend is expected. Cache daily observations and attribute ECB via Frankfurter with the date. These are estimates rather than payment-provider checkout quotes. Frankfurter publishes no daily or monthly cap, but applies abuse limits. See its [license](https://frankfurter.dev/license/) and [ECB reuse terms](https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html).

## Free hosting

Cloudflare Workers Free supports scheduled work and is available [without a credit card](https://www.cloudflare.com/products/workers/). Its [limits](https://developers.cloudflare.com/workers/platform/limits/) include 10 ms CPU and 50 subrequests per invocation; waiting for upstream network responses does not count as CPU. Validate CPU use with actual price-source payloads before committing to this host. Hourly execution is a target, not a guarantee that every source change reaches Telegram within an hour.

[Workers KV Free quotas](https://developers.cloudflare.com/workers/platform/pricing/#workers-kv) permit 1,000 writes daily, enough for one compact alert-state snapshot per hourly check. KV has [eventual consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/) and is not a transactional lock; design for non-overlapping scheduled runs and avoid claiming exactly-once delivery.

GitHub Actions is not the recommended production runtime for this bot: its [current additional-product terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#actions) restrict hosted-runner workloads to the stated software development purposes.
