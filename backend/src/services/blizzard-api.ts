import { BlizzardAuth } from "./blizzard-auth";
import { getRegion } from "../config/regions";

export class BlizzardApi {
  private static instance: BlizzardApi;
  private auth: BlizzardAuth;

  private constructor() {
    this.auth = BlizzardAuth.getInstance();
  }

  static getInstance(): BlizzardApi {
    if (!BlizzardApi.instance) {
      BlizzardApi.instance = new BlizzardApi();
    }
    return BlizzardApi.instance;
  }

  async get<T>(regionId: string, endpoint: string, namespace: "static" | "dynamic", params?: Record<string, string>): Promise<T> {
    const region = getRegion(regionId);
    const token = await this.auth.getToken();

    const url = new URL(`https://${region.apiHost}${endpoint}`);
    url.searchParams.set("namespace", `${namespace}-${regionId}`);
    url.searchParams.set("locale", region.locale);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    console.log(`[BlizzardApi] GET ${endpoint}`);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After") || "1");
        const waitMs = retryAfter * 1000;
        console.log(`[BlizzardApi] Rate limited, retrying in ${retryAfter}s (attempt ${attempt + 1}/3)`);
        await this.sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        throw new Error(`[BlizzardApi] ${response.status} ${response.statusText} for ${endpoint}`);
      }

      return (await response.json()) as T;
    }

    throw lastError ?? new Error(`[BlizzardApi] Rate limited after 3 retries for ${endpoint}`);
  }

  async getAllPages<T>(regionId: string, endpoint: string, namespace: "static" | "dynamic"): Promise<T[]> {
    const results: T[] = [];
    let page = 1;

    while (true) {
      const data = await this.get<{ results: T[]; _pageCount?: number }>(regionId, endpoint, namespace, { _page: String(page) });

      if (data.results) {
        results.push(...data.results);
      }

      if (!data._pageCount || page >= data._pageCount) {
        break;
      }
      page++;
    }

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
