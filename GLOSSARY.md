# Game Discount Notifications

A personal game-buying context for tracking wanted games and receiving discount notifications through Telegram.

## Language

**Wishlist**:
The collection of games a person wants to buy and monitor for discounts.
_Avoid_: Watchlist, shopping list

**Wishlist entry**:
A specific game or downloadable-content product on the Steam wishlist. Other editions and bundles are separate products rather than interchangeable substitutes.
_Avoid_: Game family, equivalent edition

**Discount alert**:
A Telegram message telling a recipient that a wishlisted game meets their discount conditions.
_Avoid_: Deal ping, sale notification

**Discount**:
A reduction in a game's regular selling price. Any positive discount qualifies for an alert in the initial version.
_Avoid_: Deal

**Buying region**:
The country used to determine which offers are available to the buyer. The buying region for this project is Thailand.
_Avoid_: Locale, location

**Offer**:
A store's price for a particular game edition, together with the conditions under which it can be bought and activated.
_Avoid_: Listing, deal

**Retailer**:
An authorized business selling a game or activation key to the buyer.
_Avoid_: Price source

**Price source**:
A retailer catalog or price-comparison service supplying observations about retailer offers.
_Avoid_: Retailer

**Cheapest eligible offer**:
The lowest comparable price among monitored offers that match the buyer's store and product requirements and are not known to block activation in Thailand. This may be an unverified offer, whose status must be shown explicitly.
_Avoid_: Global lowest price, cheapest anywhere

**Unverified offer**:
An otherwise matching Steam offer whose availability or activation in Thailand has not been confirmed. It may appear in an alert with a clear unverified label; an offer explicitly blocked in Thailand is excluded instead.
_Avoid_: Verified Thai offer, guaranteed activation

**THB estimate**:
An approximate baht equivalent of a foreign-currency purchase price, calculated using a reference exchange rate. The original currency remains the amount charged by the retailer.
_Avoid_: Thai checkout price, guaranteed baht price
