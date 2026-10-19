# Telegram Wishlist Discount Bot

Status: implemented, with private Telegram delivery, live local comparisons, and hourly cloud execution confirmed. The latest cloud check paused comparisons after direct-retailer rate limits. A complete cloud scan and its CPU usage remain unverified; see [validation results](validation.md).

## User and purpose

One user receives private Telegram alerts about discounted Steam-activatable copies of products on their Steam wishlist. Their buying region is Thailand. The bot compares authorized stores because Steam-only alerts do not meet the user's need.

## Confirmed preferences

- Poll hourly at minute 00, independently of the user's computer, with zero monthly hosting cost.
- Any positive discount can qualify; no target price or minimum percentage is required.
- Show only the cheapest eligible offer per wishlist entry.
- Send an initial alert for existing qualifying discounts and for newly wishlisted discounted products.
- Alert on subsequent falls in the best eligible price, including later sales; suppress unchanged repeats.
- Group newly qualifying alerts into one hourly digest without quiet hours.
- Match exact wishlisted products, including explicitly wishlisted DLC. Exclude bundles, other editions, other launchers, and key resale marketplaces.
- Include offers with unknown Thailand availability or activation, clearly labeled as unverified. Exclude offers explicitly blocked in Thailand.
- Retain original purchase currency and display an explicitly approximate THB equivalent for foreign prices. Exchange-rate changes alone must not trigger alerts.
- Cloudflare Workers Free is acceptable, with occasional delays, subject to measured runtime feasibility.

## Integrations and broader coverage

Compare Steam, Fanatical, Gamesplanet, Green Man Gaming, GamersGate, GameBillet, and 2Game, plus other authorized retailers from the selected feed when exact product identity and explicit Steam DRM can be established. Coverage depends on each product being sold by a retailer and on a functioning data source.

- Steam: wishlist synchronization and native Thai Steam store prices.
- IsThereAnyDeal: exact Steam-app-ID mapping and batched per-retailer offers for authorized stores, filtered for explicit Steam DRM. Its active shop feed includes Fanatical, Gamesplanet, Green Man Gaming, GamersGate, GameBillet, and Humble Store. Authenticated price responses have passed live validation with a personal API key.
- Fanatical: first-party catalog queried for Thailand, supplementing the aggregate feed with direct regional evidence, exact Steam IDs, stock, and sale expiry.
- 2Game Thailand: a direct adapter reads native THB prices for explicitly validated product mappings. The initial mapping is Bannerlord; no full-wishlist 2Game coverage is claimed. 2Game is absent from the active IsThereAnyDeal shop feed and is not covered through that feed.
- Frankfurter with the ECB provider: dated reference exchange rates for approximate comparisons in THB.

ITAD does not directly cover Thailand: label fallback reference-region offers appropriately and mark Thai activation unverified unless direct evidence resolves it. Preserve the API-reported currency; call a price the merchant's original checkout price only when source evidence supports that description. Never present a converted US reference price as a verified Thai checkout quote.

Use a personal IsThereAnyDeal API key and validate live access during setup. A missing or invalid key must fail explicitly rather than silently reducing retailer coverage.

Cheapest means cheapest among the supported offers that meet the selected policy, including clearly labeled region-unverified candidates. Do not advertise a target retailer whose adapter or feed coverage has not been validated.

## Eligibility policy

Only compare offers with a trustworthy exact-product match, Steam activation, stock, and a valid price. Exclude offers with explicit Thailand purchase or activation restrictions, expired offers, and inaccessible offers.

Offers whose Thailand availability or activation cannot be verified are included, with a prominent "Thailand activation unverified" label. Such an offer may be the cheapest reported candidate; do not describe it as confirmed usable in Thailand. This exception applies only to regional availability, not to unknown product identity, unknown DRM, or missing prices.

Fanatical's Thailand-filtered catalog result is first-party regional-availability evidence rather than a guarantee of final checkout or activation. Feed offers without direct regional evidence remain labeled unverified.

## Notification behavior

1. Read the current wishlist and current eligible offers.
2. Compare offers in THB using native THB amounts or dated reference conversions. Retain each offer's original price and currency.
3. The cheapest eligible offer must itself be discounted to generate a discount alert. A more expensive retailer's advertised discount does not override a cheaper available offer.
4. Notify for an initial qualifying offer, a newly added qualifying wishlist entry, a return to a qualifying discount after none was available, or a fall in the best price since the previous successful comparison. Detect real store-price changes using original amounts and consistent conversion rates, rather than treating exchange-rate movement as a new sale.
5. An increase alone does not alert. A later fall may alert again even if the same price appeared during an earlier sale.
6. Include the product name, retailer, current original price, approximate THB when applicable, retailer's discount percentage, purchase link, and explicit Thailand verification status. Preserve required source attribution and returned affiliate parameters.
7. Send one logical digest per run, splitting it only if required by Telegram's message-size limit. Send nothing when no new offer qualifies.

## Wishlist changes and source failures

Automatically follow additions and removals. A failed or private wishlist is not an empty wishlist. Source outages are not sale endings: retain prior state and do not invent price changes from failed reads. Report persistent monitoring failures without repeating the same error notice every hour.

Coverage is per product and retailer. Missing product mappings, unavailable products, source errors, and region uncertainty are distinct conditions. Region uncertainty can qualify for a clearly labeled alert; missing identity or failed reads cannot. Do not call a partial comparison a verified comparison across all configured sources.

## Hosting and private setup

Use a scheduled Cloudflare Worker and persistent small alert state on its free plan, with secrets for the Telegram token, the price-feed API key, and an allowed private chat ID. Keep source adapters separate so changes in undocumented storefront structures can be repaired independently. Respect source limits and cache stable product mappings and dated exchange rates. Prefer batched identity/price APIs over a request per product per retailer.

Validate the real wishlist workload against Cloudflare's free CPU, subrequest, and storage quotas before deployment. Do not enable a paid service to make the design fit the zero-cost constraint. Hourly polling is best-effort, and retailer data may lag source updates.

The user will need a free Cloudflare account, a personal price-data account/API key, and a Telegram bot created through BotFather, then must start the private bot chat. Credentials belong in local secret configuration or the host's secret store, not in committed files or chat messages.

## Implementation validation

Check exact-product and region filtering; inclusion and clear labeling of region-unverified candidates; exclusion of known Thailand restrictions; cheapest-offer selection; native-currency and THB comparisons; first-run alerts; further reductions and later sales; suppression of unchanged and exchange-only changes; wishlist additions/removals; source-failure recovery; digest length handling; secret redaction; and operation within free-hosting limits. Validate live source adapters against the provided wishlist before claiming coverage.
