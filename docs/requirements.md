# Telegram Game Discount Bot

## Purpose

Notify the user in a private Telegram chat when a game on their wishlist is discounted.

## Confirmed decisions

- Start with a Steam wishlist.
- Include offers from other game stores. The user explicitly rejected Steam-only monitoring because Steam's mobile app already provides alerts.
- Include authorized retailers and publisher stores; exclude key resale marketplaces.
- Only include purchases that activate on Steam.
- Show the cheapest eligible offer per game, rather than separate alerts for every store.
- Serve one person, with alerts in their private Telegram chat.
- Any positive discount qualifies; no minimum percentage or target price is required initially.
- Check hourly at minute 00, as requested after deployment. Detection within one hour is acceptable during normal operation.
- Use Thailand as the buying region and THB as the requested currency.
- Alert when a sale starts and when its price falls further. Do not repeat an unchanged offer every hour; a later sale can trigger a fresh alert.
- Alert for qualifying discounts already present on the first scan or when a game is newly added to the wishlist.
- Group new discounts from each hourly check into one digest, with delivery allowed at any hour.
- Run independently of the user's computer, with a monthly hosting budget of zero.
- Cloudflare Workers Free is acceptable, subject to verifying that the workload fits its free limits. Occasional delays in roughly hourly checks are acceptable.
- Foreign-currency offers may show their original purchase price plus a clearly labeled THB estimate. Exchange-rate changes alone must not trigger alerts.
- Match the exact wishlisted product. Include DLC only when explicitly wishlisted; exclude bundles and substitute editions.
- Include offers with unknown Thailand availability or activation, clearly labeled as unverified. Exclude offers explicitly blocked in Thailand. The cheapest reported offer may therefore be unverified and must carry that status.
- The user requested broader authorized-retailer coverage beyond Steam and Fanatical. The implementation uses IsThereAnyDeal's per-offer feed plus direct Fanatical and validated 2Game adapters; an authenticated live preview has passed.
- The user supplied GG.deals' Undernauts comparison page and 2Game's Thai storefront to broaden retailer coverage. The initial store set must not be arbitrarily capped at three retailers. Treat the linked game as a store-discovery example, not an instruction to add it to the wishlist.
- The selected wishlist is kept in ignored local `wrangler.jsonc`. A read-only access check returned 27 games on 18 October 2026.

## Design tree

- Wishlist source: Steam initially.
  - Offer coverage: Steam and other stores.
    - Authorized retailers and publisher stores only; Steam activation required.
    - Exact wishlisted products only, including explicitly wishlisted DLC; exclude bundles and substitute editions.
    - Broaden the proposed store set using GG.deals' official-store listings and 2Game's Thai storefront. Targets include Steam, Fanatical, Gamesplanet, Green Man Gaming, GamersGate, GameBillet, and 2Game; do not claim source coverage until verified.
    - Implemented broad source: IsThereAnyDeal's per-offer API, supplemented by direct regional data. A personal API key and live access validation are setup prerequisites.
    - 2Game's Thai adapter has a validated Bannerlord mapping with native THB context; additional products require validated mappings. 2Game is not supplied by ITAD's currently active feed.
  - Provided wishlist is accessible without login using Steam's current wishlist endpoint.
  - Follow additions/removals automatically; retain state and report source failure if the wishlist becomes unavailable.
- Discount qualification: any positive discount.
  - Buying region: Thailand; requested currency: THB.
    - Show original foreign currency plus an explicitly approximate THB conversion.
    - Exchange-rate changes alone do not qualify as new discounts.
    - Rate source: Frankfurter using dated ECB reference rates.
    - Q18 confirmed: include offers with unknown Thailand availability or activation, explicitly labeled as unverified; exclude known Thailand restrictions.
  - Include existing discounts at first scan and when a game is newly added.
  - Notify on sale starts, further reductions, and later sales; suppress unchanged repeats.
    - Compare the cheapest eligible offer per game, rather than generating separate store alerts.
  - Compare against the previous successful observation; later price falls can alert again, while exchange-rate-only movement cannot.
  - The cheapest eligible offer must itself be discounted; ignore a higher-priced store's advertised discount.
  - Exclude bundles and substitute editions; explicitly wishlisted DLC is in scope.
- Delivery: one private Telegram chat.
  - Alert format and private Telegram setup are documented in the specification and README.
  - One digest per hourly check; no quiet hours.
- Schedule: hourly checks.
  - Must run while the user's computer is off; monthly hosting budget: zero.
  - Cloudflare Workers Free accepted in principle; hourly checks are best-effort and occasional delays are acceptable.
  - Local build, runtime, and comparison benchmark passed. Deployed CPU and actual account quotas remain to be checked after activation.
  - Retain state across failed source reads, retry without inventing sale changes, and report persistent monitoring failures without hourly repeats.
- Review complete: the user approved implementation with "Build it". The implemented behavior is documented in [the specification](spec.md). Cloudflare deployment and hourly schedule registration are complete; the initial Telegram digest was delivered using production state. Native scheduled execution and its CPU usage remain to be observed.

## Integration research

Steam wishlist access, native THB Steam pricing, Fanatical's Thai-region catalog, Gamesplanet's prices and country restrictions, and a free dated THB conversion source have been checked. Cloudflare's published free limits have been checked; measured runtime feasibility remains an implementation validation step. See [integration research](integration-research.md).

Implementation results and remaining credential-dependent checks are recorded in [validation](validation.md).
