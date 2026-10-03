import { useEffect, useState } from "react";
import { fetchItems, fetchItemFilterOptions, type ItemFilters, type ItemFilterOptions, type ItemListResponse } from "@/lib/api";
import { selectedRealm, useSelectedRealm } from "@/lib/selected-realm";

export interface ItemBrowserRequest extends ItemFilters {
  page: number;
  limit: number;
}

export interface ItemBrowserAdapter {
  load(request: ItemBrowserRequest & { connectedRealmId?: number }): Promise<ItemListResponse>;
}

const httpAdapter: ItemBrowserAdapter = {
  load: (request) => fetchItems({ region: "eu", ...request }),
};

export function useItemBrowser(request: ItemBrowserRequest, adapter: ItemBrowserAdapter = httpAdapter, enabled = true) {
  const realm = useSelectedRealm();
  const { type } = request;
  const requestKey = JSON.stringify(request);
  const needsRealm = type !== "commodity";
  const connectedRealmId = needsRealm && realm.status === "ready" ? realm.selectedId : undefined;
  const key =
    !enabled || (needsRealm && connectedRealmId === undefined)
      ? null
      : JSON.stringify([connectedRealmId ?? "region", requestKey]);
  const [result, setResult] = useState<{ key: string; data: ItemListResponse } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  function retry() {
    if (needsRealm && realm.status === "error") { void selectedRealm.retry(); return; }
    setFailedKey(null);
    setAttempt((value) => value + 1);
  }

  useEffect(() => {
    if (key === null) return;
    let active = true;
    void adapter
      .load({ ...JSON.parse(requestKey) as ItemBrowserRequest, ...(connectedRealmId === undefined ? {} : { connectedRealmId }) })
      .then((data) => {
        if (!active) return;
        setResult({ key, data });
        setFailedKey(null);
      })
      .catch(() => active && setFailedKey(key));
    return () => {
      active = false;
    };
  }, [adapter, attempt, connectedRealmId, key, requestKey]);

  if (needsRealm && realm.status !== "ready") return { status: realm.status, data: null, retry } as const;
  if (failedKey === key && result?.key !== key) return { status: "error", data: null, retry } as const;
  if (result?.key !== key) return { status: "loading", data: null, retry } as const;
  return { status: failedKey === key ? "refresh-error" : "ready", data: result.data, retry } as const;
}

export function useItemFilterOptions() {
  const [data, setData] = useState<ItemFilterOptions | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    fetchItemFilterOptions().then(options => { if (active) { setData(options); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);
  return { data, failed, retry: () => { setFailed(false); setAttempt(value => value + 1); } };
}
