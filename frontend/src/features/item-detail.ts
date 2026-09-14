import { useEffect, useState } from "react";
import { fetchItemPrices, type Item, type PricePoint } from "@/lib/api";
import { useSelectedRealm } from "@/lib/selected-realm";
import type { HistoryRange } from "@/lib/time-ranges";

export interface ItemDetailAdapter {
  loadHistory(item: Item, range: HistoryRange, connectedRealmId: number | null): Promise<PricePoint[]>;
}

const httpAdapter: ItemDetailAdapter = {
  loadHistory: (item, range, connectedRealmId) =>
    fetchItemPrices(
      item.id,
      "eu",
      range,
      item.marketType === "realm" ? { type: "realm", connectedRealmId: connectedRealmId ?? undefined } : { type: "auto" },
    ),
};

export function useItemDetail(item: Item, range: HistoryRange, adapter: ItemDetailAdapter = httpAdapter) {
  const realm = useSelectedRealm();
  const connectedRealmId = realm.status === "ready" ? realm.selectedId : null;
  const needsRealm = item.marketType === "realm";
  const historyKey = needsRealm && connectedRealmId === null ? null : `${item.id}:${range}:${connectedRealmId ?? "eu"}`;
  const [history, setHistory] = useState<{ key: string; data: PricePoint[] } | null>(null);
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

  if (needsRealm && realm.status !== "ready") {
    return { status: realm.status, connectedRealmId: null, prices: [] } as const;
  }
  if (failedKey === historyKey && history?.key !== historyKey) {
    return { status: "error", connectedRealmId, prices: [] } as const;
  }
  if (history?.key !== historyKey) {
    return { status: "loading", connectedRealmId, prices: [] } as const;
  }
  return {
    status: failedKey === historyKey ? "refresh-error" : "ready",
    connectedRealmId,
    prices: history.data,
  } as const;
}
