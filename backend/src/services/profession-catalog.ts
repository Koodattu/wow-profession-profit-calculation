import { db } from "../db";
import { withAdvisoryLockWait } from "../db/advisory-lock";
import { professions } from "../db/schema";
import {
  publishProfessionCatalog,
  readBundledProfessionCatalog,
  type ProfessionCatalogData,
} from "./game-data-import";

export interface ProfessionCatalogResult {
  outcome: "published" | "already-present";
}

interface ProfessionCatalogDependencies {
  load(): Promise<ProfessionCatalogData>;
  publish(catalog: ProfessionCatalogData): Promise<void>;
  lockTimeoutMs?: number;
}

export interface ProfessionCatalogModule {
  ensurePresent(): Promise<ProfessionCatalogResult>;
  replace(): Promise<ProfessionCatalogResult>;
}

export function createProfessionCatalogModule(dependencies: ProfessionCatalogDependencies): ProfessionCatalogModule {
  const { load, publish, lockTimeoutMs = 30_000 } = dependencies;

  async function run(mode: "ensure" | "replace"): Promise<ProfessionCatalogResult> {
    const catalog = await load();
    const lock = await withAdvisoryLockWait("copper:profession-catalog", lockTimeoutMs, async () => {
      if (mode === "ensure") {
        const existing = await db.select({ id: professions.id }).from(professions).limit(1);
        if (existing.length > 0) return { outcome: "already-present" } as const;
      }
      await publish(catalog);
      return { outcome: "published" } as const;
    });
    if (!lock.acquired) throw new Error("Timed out waiting for Profession Catalog publication");
    return lock.value;
  }

  return {
    ensurePresent: () => run("ensure"),
    replace: () => run("replace"),
  };
}

const productionModule = createProfessionCatalogModule({
  load: readBundledProfessionCatalog,
  publish: publishProfessionCatalog,
});

export const ensureProfessionCatalog = productionModule.ensurePresent;
export const replaceProfessionCatalog = productionModule.replace;
