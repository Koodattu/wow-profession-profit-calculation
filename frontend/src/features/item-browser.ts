import { useEffect, useState } from "react";
import { fetchItems, type ItemListResponse } from "@/lib/api";
import { useSelectedRealm } from "@/lib/selected-realm";

export interface ItemBrowserRequest {
  type?: "commodity" | "realm";
  search?: string;
  page: number;
  limit: number;
}

export interface ItemBrowserAdapter {
  load(request: ItemBrowserRequest & { connectedRealmId?: number }): Promise<ItemListResponse>;
}

const httpAdapter: ItemBrowserAdapter = {
  load: (request) => fetchItems({ region: "eu", ...request }),
};

export function useItemBrowser(request: ItemBrowserRequest, adapter: ItemBrowserAdapter = httpAdapter) {
  const realm = useSelectedRealm();
  const { type, search, page, limit } = request;
  const needsRealm = type !== "commodity";
  const connectedRealmId = realm.status === "ready" ? realm.selectedId : undefined;
  const key =
    needsRealm && connectedRealmId === undefined
      ? null
      : JSON.stringify([connectedRealmId ?? "region", type ?? "all", search ?? "", page, limit]);
  const [result, setResult] = useState<{ key: string; data: ItemListResponse } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  useEffect(() => {
    if (key === null) return;
    let active = true;
    void adapter
      .load({ type, search, page, limit, ...(connectedRealmId === undefined ? {} : { connectedRealmId }) })
      .then((data) => {
        if (!active) return;
        setResult({ key, data });
        setFailedKey(null);
      })
      .catch(() => active && setFailedKey(key));
    return () => {
      active = false;
    };
  }, [adapter, connectedRealmId, key, limit, page, search, type]);

  if (needsRealm && realm.status !== "ready") return { status: realm.status, data: null } as const;
  if (failedKey === key && result?.key !== key) return { status: "error", data: null } as const;
  if (result?.key !== key) return { status: "loading", data: null } as const;
  return { status: failedKey === key ? "refresh-error" : "ready", data: result.data } as const;
}
