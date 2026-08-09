# Copper

Copper models EU Retail auction markets and profession recipes for price comparison and crafting valuation.

## Language

**Current Market State**:
The latest successfully synchronized auction summaries for commodities and connected-realm items. Historical observations are not part of current market state.
_Avoid_: Latest prices, current snapshot

**Market Quote**:
A current price and availability summary for one item in one market scope: either EU commodities or a single connected realm.
_Avoid_: Price, market value

**Selected Realm Quote**:
The Market Quote for a realm-specific item in the user’s selected connected realm. A missing Selected Realm Quote remains missing rather than falling back to a regional estimate.
_Avoid_: Realm price

**EU Realm Benchmark**:
The unweighted arithmetic mean of each connected realm’s minimum current buyout, excluding connected realms where the item is not listed.
_Avoid_: EU average, region price

**Recipe Valuation**:
The set of Recipe Scenarios for one profession recipe in a market scope. It excludes auction fees and profession-stat effects unless explicitly stated.
_Avoid_: Recipe cost, profit calculation

**Recipe Scenario**:
A cost, output value, and gross-profit estimate for one reagent/output-rank combination or one salvage input.
_Avoid_: Rank result, calculation row

**Recipe Scenario Key**:
The stable identity of a Recipe Scenario: its reagent/output-rank pair for normal crafting, or its salvage input item for salvage recipes.
_Avoid_: Scenario index, card key

**Auction Refresh**:
One complete attempt to fetch and atomically replace Current Market State for either EU commodities or one connected realm. A failed Auction Refresh preserves the previous Current Market State and records the failure.
_Avoid_: Auction sync, price update

**Market Observation**:
The normalized, timestamped auction summaries produced by a successful Auction Refresh. One observation may replace Current Market State and may also be retained as history according to the history cadence.
_Avoid_: Snapshot, sync result
