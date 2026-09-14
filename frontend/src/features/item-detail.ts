import { useEffect, useState } from "react";
import { fetchItemPrices, fetchItemRealmPrices, type Item, type PricePoint, type RealmPrice } from "@/lib/api";
import { useSelectedRealm } from "@/lib/selected-realm";
import type { HistoryRange } from "@/lib/time-ranges";

export interface ItemDetailAdapter {
  loadHistory(item: Item, range: HistoryRange, connectedRealmId: number | null): Promise<PricePoint[]>;
  loadRealmComparison(itemId: number): Promise<RealmPrice[]>;
}

const httpAdapter: ItemDetailAdapter = {
  loadHistory: (item, range, connectedRealmId) =>
    fetchItemPrices(
      item.id,
      "eu",
      range,
      item.marketType === "realm" ? { type: "realm", connectedRealmId: connectedRealmId ?? undefined } : { type: "auto" },
    ),
  loadRealmComparison: (itemId) => fetchItemRealmPrices(itemId, "eu"),
};

export function useItemDetail(item: Item, range: HistoryRange, adapter: ItemDetailAdapter = httpAdapter) {
  const realm = useSelectedRealm();
  const connectedRealmId = realm.status === "ready" ? realm.selectedId : null;
  const needsRealm = item.marketType === "realm";
  const historyKey = needsRealm && connectedRealmId === null ? null : `${item.id}:${range}:${connectedRealmId ?? "eu"}`;
  const comparisonKey = String(item.id);
  const [history, setHistory] = useState<{ key: string; data: PricePoint[] } | null>(null);
  const [comparison, setComparison] = useState<{ key: string; data: RealmPrice[] } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  useEffect(() => {
    if (historyKey === null) return;
    let active = true;
    void adapter
      .loadHistory(item, range, connectedRealmId)
      .then((data) => {
        if (!active) return;
        setHistory({ key: historyKey, data });
        setFailedKey(null);
      })
      .catch(() => active && setFailedKey(historyKey));
    return () => {
      active = false;
    };
  }, [adapter, connectedRealmId, historyKey, item, range]);

  useEffect(() => {
    if (!needsRealm) return;
    let active = true;
    void adapter
      .loadRealmComparison(item.id)
      .then((data) => active && setComparison({ key: comparisonKey, data }))
      .catch(() => active && setComparison({ key: comparisonKey, data: [] }));
    return () => {
      active = false;
    };
  }, [adapter, comparisonKey, item.id, needsRealm]);

  if (needsRealm && realm.status !== "ready") {
    return { status: realm.status, connectedRealmId: null, prices: [], realmPrices: [], realmPricesLoading: needsRealm } as const;
  }
  if (failedKey === historyKey && history?.key !== historyKey) {
    return { status: "error", connectedRealmId, prices: [], realmPrices: comparison?.data ?? [], realmPricesLoading: comparison?.key !== comparisonKey } as const;
  }
  if (history?.key !== historyKey) {
    return { status: "loading", connectedRealmId, prices: [], realmPrices: comparison?.data ?? [], realmPricesLoading: needsRealm && comparison?.key !== comparisonKey } as const;
  }
  return {
    status: failedKey === historyKey ? "refresh-error" : "ready",
    connectedRealmId,
    prices: history.data,
    realmPrices: comparison?.key === comparisonKey ? comparison.data : [],
    realmPricesLoading: needsRealm && comparison?.key !== comparisonKey,
  } as const;
}
