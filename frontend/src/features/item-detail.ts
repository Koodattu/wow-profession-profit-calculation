import { useEffect, useState } from "react";
import { fetchItemPrices, type Item, type PricePoint } from "@/lib/api";
import { selectedRealm, useSelectedRealm } from "@/lib/selected-realm";
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
      item.marketType === "realm"
        ? { type: "realm", connectedRealmId: connectedRealmId ?? undefined }
        : { type: item.marketType === "commodity" ? "commodity" : "auto" },
    ),
};

export function useItemDetail(item: Item, range: HistoryRange, adapter: ItemDetailAdapter = httpAdapter) {
  const realm = useSelectedRealm();
  const needsRealm = item.marketType === "realm";
  const connectedRealmId = needsRealm && realm.status === "ready" ? realm.selectedId : null;
  const historyKey = needsRealm && connectedRealmId === null ? null : `${item.id}:${range}:${connectedRealmId ?? "eu"}`;
  const [history, setHistory] = useState<{ key: string; data: PricePoint[] } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  function retry() {
    if (needsRealm && realm.status === "error") { void selectedRealm.retry(); return; }
    setFailedKey(null);
    setAttempt((value) => value + 1);
  }

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
  }, [adapter, attempt, connectedRealmId, historyKey, item, range]);

  if (needsRealm && realm.status !== "ready") {
    return { status: realm.status, connectedRealmId: null, prices: [], retry } as const;
  }
  if (failedKey === historyKey && history?.key !== historyKey) {
    return { status: "error", connectedRealmId, prices: [], retry } as const;
  }
  if (history?.key !== historyKey) {
    return { status: "loading", connectedRealmId, prices: [], retry } as const;
  }
  return {
    status: failedKey === historyKey ? "refresh-error" : "ready",
    connectedRealmId,
    prices: history.data,
    retry,
  } as const;
}
