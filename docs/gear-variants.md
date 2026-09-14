# Gear versions and current listings

Realm auctions retain their full normalized identity: item ID, bonus IDs, modifiers, context and existing pet fields. We do not merge identities merely because their decoded labels match. Connected realms share one auction house; the UI shows its first alphabetical realm name and the count of additional names, with the full group available.

## Reference data and decoding

The compressed bundle in `backend/src/data/gear-reference.json.gz` contains the equippable item fields, bonus definitions, item curves, squish eras and content tuning needed by the decoder. A startup check and daily refresh use one Raidbots content hash for every downloaded file. The last successful reference is persisted once in `gear_reference`; an unavailable upstream leaves the cached reference usable. Update the committed fallback with `cd backend && bun run update-gear-reference`.

Sources:

- [Raidbots developer data](https://www.raidbots.com/developers): versioned public datasets and local caching.
- [Raidbots item-level notes](https://gist.github.com/seriallos/1b15ddda52ead945ab58e8140af5ca0a): era-specific level overrides, lower-priority selection, offsets and scaling curves.
- [SimulationCraft item bonuses](https://github.com/simulationcraft/simc/blob/midnight/engine/dbc/sc_item_data.cpp) and [item initialization](https://github.com/simulationcraft/simc/blob/midnight/engine/item/item.cpp): recursive bonuses, content-tuning caps and placeholder stat replacement.
- [SimulationCraft addon](https://github.com/simulationcraft/simc-addon/blob/master/core.lua): auction modifier equivalents for drop level (9), content tuning (28), crafted stats (29/30) and redirected base stats (64).
- [Wowhead tooltips](https://www.wowhead.com/tooltips): item links and colon-separated bonus lists. Live tooltip script inspection and browser verification additionally cover crafted stats and character level.

Upgrade names and ranks come from the reference bonus definitions, not a hardcoded list of seasons or raid difficulties. An item with no upgrade bonus has no inferred upgrade track. Secondary stat names come from base stats, placeholders, missives and stat bonuses; full amounts and effects are rendered by Wowhead.

Known limits are explicit: missing reference entries, missing drop-level modifiers, unresolved legacy scaling, profession-quality scaling and ambiguous equal-priority overrides cannot all be decoded confidently. Such versions retain their original identity and are flagged as incomplete. Era-zero operations and conflicting level overrides display no calculated level. Unknown bonus IDs may coexist with a level calculated from known bonuses. Special-case items are not guaranteed to match the game client. Wowhead is an independent upstream and can differ from the local reference build.

Wowhead links include original bonus IDs and supported crafted-stat/level parameters. Colons must remain literal: the tooltip script otherwise drops the second crafted stat. We do not force an `ilvl` override to conceal disagreements. The `mods` parameter belongs to Diablo tooltips and is not used for WoW; raw modifiers remain visible in version details.

## Persistence and endpoints

Migration `0012_gear_listings` adds a nullable JSONB column to `realm_latest` and the singleton reference table. It does not rewrite historical prices. Each current variant stores auction ID, stack buyout, quantity, bid and the feed's time-left category. A successful realm refresh replaces these atomically with the summary; a failed fetch preserves the previous complete snapshot. Null means the snapshot predates listing collection. Bid-only auctions remain outside the existing buyout market.

This stores individual listings only in the current snapshot, not in every historical observation. Existing quantity-weighted history and raw archives keep their previous policy. The price chart combines versions and is explicitly separate from the current version filters.

- `GET /api/items/:id/variants` reads the existing item index without fetching listing JSON, decodes each distinct identity once, and returns realm availability. Cache lifetime: 30 seconds.
- `GET /api/items/:id/listings?connectedRealmId=...&variant=...&page=1` reads one composite-key row and returns 50 listings per page, ordered by exact stack price/quantity comparison. Cache lifetime: 15 seconds.

The frontend filters one loaded version catalog locally, applies the same filters to realm comparisons, and loads individual listings only for the selected version and realm. Responses from superseded selections cannot replace current listings.

## Verification

Decoder fixtures cover current Mantle ranks, older crafted squishes, Midnight crafted gear, legacy single-version gear, drop curves, content tuning, recursive bonuses, missives, conflicting priorities, unknown bonuses and tooltip parameters. Database integration tests cover persistence, exact stack amounts, realm/version isolation, pagination, invalid requests, failed refreshes and empty feeds. Frontend tests cover matching filters, a single-version item, preserved tooltip identity and stale realm responses.

Local browser validation used 84 real Kazzak Mantle auctions copied through a read-only Blizzard request. Myth and stat filters selected individual auction IDs and prices; the Wowhead tooltip was checked against its public response.
