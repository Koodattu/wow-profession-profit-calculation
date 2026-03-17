const STORAGE_KEY = "wow-selected-connected-realm";
const REALM_CHANGE_EVENT = "realm-change";

let cachedRealmId: number | null = null;

function load(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function getSelectedConnectedRealmId(): number | null {
  const stored = load();
  if (cachedRealmId === stored) return cachedRealmId;
  cachedRealmId = stored;
  return stored;
}

export function setSelectedConnectedRealmId(connectedRealmId: number): void {
  localStorage.setItem(STORAGE_KEY, String(connectedRealmId));
  cachedRealmId = connectedRealmId;
  window.dispatchEvent(new Event(REALM_CHANGE_EVENT));
}

export function subscribeToConnectedRealm(callback: () => void): () => void {
  window.addEventListener(REALM_CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(REALM_CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
