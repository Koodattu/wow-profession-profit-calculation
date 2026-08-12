import { useEffect, useState } from "react";
import { fetchMarketSummary, type MarketSummary } from "@/lib/api";
import { useSelectedRealm } from "@/lib/selected-realm";

export interface MarketDashboardAdapter {
  load(connectedRealmId?: number): Promise<MarketSummary>;
}

const httpAdapter: MarketDashboardAdapter = {
  load: (connectedRealmId) => fetchMarketSummary("eu", connectedRealmId),
};

export function useMarketDashboard(adapter: MarketDashboardAdapter = httpAdapter) {
  const realm = useSelectedRealm();
  const connectedRealmId = realm.status === "ready" ? realm.selectedId : undefined;
  const key = `eu:${connectedRealmId ?? "none"}`;
  const [result, setResult] = useState<{ key: string; data: MarketSummary } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void adapter
      .load(connectedRealmId)
      .then((data) => {
        if (!active) return;
        setResult({ key, data });
        setFailedKey(null);
      })
      .catch(() => active && setFailedKey(key));
    return () => {
      active = false;
    };
  }, [adapter, connectedRealmId, key]);

  return {
    realm,
    summary: result?.key === key ? result.data : null,
    loading: result?.key !== key && failedKey !== key,
    failed: failedKey === key,
  };
}
