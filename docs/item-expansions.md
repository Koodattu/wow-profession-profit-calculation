# Market expansion filtering

The Market's **Expansion** selector filters by the expansion in which an item was
introduced. It works with commodities, realm items and every other Market filter.
It does not describe an item's level, upgrade season, or which profession uses it.
All expansions is the default; Unknown expansion selects IDs missing from the
reference. Selections are saved in the URL and retained when returning from an item.

## Source and coverage

The offline bundle combines the historical
[shatari-data item mapping](https://github.com/erorus/shatari-data/blob/a7ace459f7461001dcec00e974aa7dbb41997e7a/expansion-items.json)
with expansion fields in Undermine Exchange's public
[unbound](https://undermine.exchange/json/mainline/items.unbound.json) and
[crafting-relevant bound](https://undermine.exchange/json/mainline/items.bound.json)
mainline catalogs. The initial snapshot contains 204,887 item IDs, including
1,985 Midnight IDs absent from the historical mapping. It contains game metadata,
not prices, auctions or user records.

Undermine [assigns historical eras and defaults other known game items to the
current era](https://github.com/erorus/shatari-data/blob/a7ace459f7461001dcec00e974aa7dbb41997e7a/src/items.php).
Copper imports only explicitly enumerated IDs. It does **not** apply that default
to arbitrary IDs or infer eras from item-ID ranges. Consequently, new patch items
can appear as Unknown until the bundle is refreshed. Era assignments inherit the
upstream mapping's limitations; the catalog is not a claim of independently
verified release dates. Old reagents used in new recipes retain their original era.

`backend/src/data/item-expansions.json.gz` includes source URLs, the historical
source commit, retrieval time, SHA-256 source checksums and a content checksum.
The Apache-2.0 license and modification/attribution notice are alongside it.

## Updating the bundle

From `backend/`, run `bun run update-item-expansions [full-shatari-data-commit-sha]`.
Without an argument, the updater uses the pinned historical commit above and
refreshes the published item catalogs. No API key or paid endpoint is needed.
Review a newer upstream commit before supplying it. The command validates source
coverage, conflicting mappings, IDs and supported eras before atomically replacing
the file; failed downloads or validation leave the previous bundle intact.

Review source/count changes, run `bun run typecheck`, `bun test` and
`bun run test:integration` against an explicit disposable local database, then
commit the bundle with any relevant source/documentation changes. Refresh for
new patches; a new expansion also requires updating the supported era range and
frontend option list. No upstream requests happen during startup or browsing.

## Database and API

Migration `0016_item_expansions` adds an item-ID reference table and a content
version marker. Startup publishes the bundled reference transactionally under an
advisory lock, only when its content changes. There is deliberately no foreign key
to discovered items: a later auction immediately inherits its known era without
altering ingestion or backfilling item rows. Item metadata and price history are
untouched. Rollback to the prior app can leave these additive tables in place.

`GET /api/items?expansion=12` selects Midnight. Values use Undermine's **one-based
era IDs**, not Blizzard expansion indexes:

| ID | Expansion |
| --- | --- |
| 1 | Classic / original WoW |
| 2 | The Burning Crusade |
| 3 | Wrath of the Lich King |
| 4 | Cataclysm |
| 5 | Mists of Pandaria |
| 6 | Warlords of Draenor |
| 7 | Legion |
| 8 | Battle for Azeroth |
| 9 | Shadowlands |
| 10 | Dragonflight |
| 11 | The War Within |
| 12 | Midnight |

Use `expansion=unknown` for unmapped IDs; omit the parameter for all items.
Invalid values return HTTP 400. Filtering happens in PostgreSQL before counts,
sorting and pagination, within the existing consistent market-read transaction.
