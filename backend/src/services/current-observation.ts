import { and, eq, sql } from "drizzle-orm";
import { commodityLatest, marketObservations, realmLatest } from "../db/schema";

export const commodityObservationJoin = and(
  eq(marketObservations.regionId, commodityLatest.regionId), eq(marketObservations.connectedRealmId, 0),
);
export const realmObservationJoin = and(
  eq(marketObservations.regionId, realmLatest.regionId), eq(marketObservations.connectedRealmId, realmLatest.connectedRealmId),
);
// Existing rows remain readable before their first incremental refresh.
export const commodityObservedAt = sql<Date>`coalesce(${marketObservations.observedAt}, ${commodityLatest.observedAt})`.mapWith(commodityLatest.observedAt);
export const realmObservedAt = sql<Date>`coalesce(${marketObservations.observedAt}, ${realmLatest.observedAt})`.mapWith(realmLatest.observedAt);
