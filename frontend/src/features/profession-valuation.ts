import { useEffect, useState } from "react";
import { fetchProfessionCostsForRealm, type ProfessionRecipeCost } from "@/lib/api";
import { useSelectedRealm } from "@/lib/selected-realm";

export interface ProfessionValuationAdapter {
  load(professionId: number, connectedRealmId: number): Promise<ProfessionRecipeCost[]>;
}

const httpAdapter: ProfessionValuationAdapter = {
  load: (professionId, connectedRealmId) => fetchProfessionCostsForRealm(professionId, "eu", connectedRealmId),
};

export function useProfessionValuation(professionId: number, adapter: ProfessionValuationAdapter = httpAdapter) {
  const realm = useSelectedRealm();
  const connectedRealmId = realm.status === "ready" ? realm.selectedId : null;
  const key = connectedRealmId === null ? null : `${professionId}:${connectedRealmId}`;
  const [result, setResult] = useState<{ key: string; data: ProfessionRecipeCost[] } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  useEffect(() => {
    if (key === null || connectedRealmId === null) return;
    let active = true;
    void adapter
      .load(professionId, connectedRealmId)
      .then((data) => {
        if (!active) return;
        setResult({ key, data });
        setFailedKey(null);
      })
      .catch(() => active && setFailedKey(key));
    return () => {
      active = false;
    };
  }, [adapter, connectedRealmId, key, professionId]);

  if (realm.status !== "ready") return { status: realm.status, data: null } as const;
  if (failedKey === key && result?.key !== key) return { status: "error", data: null } as const;
  if (result?.key !== key) return { status: "loading", data: null } as const;
  return { status: failedKey === key ? "refresh-error" : "ready", data: result.data } as const;
}
