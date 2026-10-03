import { describe, expect, test, vi } from "vitest";
import { createSelectedRealmModule } from "./selected-realm";

const groups = [
  {
    connected_realm_id: 20,
    realms: [{ id: 2, connectedRealmId: 20, name: "Zulu", slug: "zulu" }],
  },
  {
    connected_realm_id: 10,
    realms: [{ id: 1, connectedRealmId: 10, name: "Alpha", slug: "alpha" }],
  },
];

describe("selected realm interface", () => {
  test("a failed catalog load can be retried without losing the saved realm", async () => {
    const loadCatalog = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(groups);
    const realm = createSelectedRealmModule({ loadCatalog, readStored: () => 20, writeStored: () => {} });
    await realm.initialize();
    expect(realm.getSnapshot().status).toBe("error");
    await realm.retry();
    expect(realm.getSnapshot()).toEqual(expect.objectContaining({ status: "ready", selectedId: 20 }));
  });

  test("unavailable browser storage does not prevent an in-session realm choice", async () => {
    const realm = createSelectedRealmModule({
      loadCatalog: async () => groups,
      readStored: () => { throw new Error("Storage blocked"); },
      writeStored: () => { throw new Error("Storage blocked"); },
    });
    await realm.initialize();
    expect(realm.getSnapshot().status).toBe("selection-required");
    realm.select(10);
    expect(realm.getSnapshot()).toEqual(expect.objectContaining({ status: "ready", selectedId: 10 }));
  });
  test("requires an explicit first selection and persists a valid choice", async () => {
    let stored: number | null = null;
    const realm = createSelectedRealmModule({
      loadCatalog: async () => groups,
      readStored: () => stored,
      writeStored: (value) => {
        stored = value;
      },
    });

    await realm.initialize();
    expect(realm.getSnapshot()).toEqual({
      status: "selection-required",
      options: [
        { id: 10, label: "Alpha", fullLabel: "Alpha" },
        { id: 20, label: "Zulu", fullLabel: "Zulu" },
      ],
      selectedId: null,
    });

    realm.select(20);
    expect(stored).toBe(20);
    expect(realm.getSnapshot()).toEqual(expect.objectContaining({ status: "ready", selectedId: 20 }));
  });

  test("clears a stored realm that is no longer in the catalog", async () => {
    let stored: number | null = 999;
    const realm = createSelectedRealmModule({
      loadCatalog: async () => groups,
      readStored: () => stored,
      writeStored: (value) => {
        stored = value;
      },
    });

    await realm.initialize();

    expect(stored).toBeNull();
    expect(realm.getSnapshot().status).toBe("selection-required");
  });
});
