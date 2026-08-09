import { env } from "../config/env";
import { getRegion } from "../config/regions";
import { BlizzardAuth } from "./blizzard-auth";
import { fetchWithTimeout, isRetryableStatus, retryDelayMs, sleep } from "./request-policy";

export class BlizzardApi {
  private static instance: BlizzardApi;
  private readonly auth: BlizzardAuth;

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
    const url = new URL(`https://${region.apiHost}${endpoint}`);
    url.searchParams.set("namespace", `${namespace}-${regionId}`);
    url.searchParams.set("locale", region.locale);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }

    console.log(`[BlizzardApi] GET ${endpoint}`);
    let token = await this.auth.getToken();
    let tokenRefreshed = false;
    let lastError: unknown;

    for (let attempt = 0; attempt <= env.BLIZZARD_MAX_RETRIES; attempt++) {
      let response: Response;
      try {
        response = await fetchWithTimeout(
          url,
          { headers: { Authorization: `Bearer ${token}` } },
          env.BLIZZARD_REQUEST_TIMEOUT_MS,
        );
      } catch (error) {
        lastError = error;
        if (attempt === env.BLIZZARD_MAX_RETRIES) break;
        const delayMs = retryDelayMs(attempt);
        console.warn(`[BlizzardApi] Retrying ${endpoint} in ${delayMs}ms after a request error`);
        await sleep(delayMs);
        continue;
      }

      if (response.ok) {
        return (await response.json()) as T;
      }

      if (response.status === 401 && !tokenRefreshed) {
        this.auth.invalidateToken(token);
        token = await this.auth.getToken();
        tokenRefreshed = true;
        attempt--;
        continue;
      }

      lastError = new Error(`[BlizzardApi] ${response.status} ${response.statusText} for ${endpoint}`);
      if (!isRetryableStatus(response.status) || attempt === env.BLIZZARD_MAX_RETRIES) {
        throw lastError;
      }

      const delayMs = retryDelayMs(attempt, response.headers.get("Retry-After"));
      console.warn(`[BlizzardApi] Retrying ${endpoint} in ${delayMs}ms after HTTP ${response.status}`);
      await sleep(delayMs);
    }

    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`[BlizzardApi] Request failed for ${endpoint}: ${detail}`);
  }

  async getAllPages<T>(regionId: string, endpoint: string, namespace: "static" | "dynamic"): Promise<T[]> {
    const results: T[] = [];
    let page = 1;

    while (true) {
      const data = await this.get<{ results: T[]; _pageCount?: number }>(regionId, endpoint, namespace, { _page: String(page) });
      results.push(...(data.results ?? []));

      if (!data._pageCount || page >= data._pageCount) break;
      page++;
    }

    return results;
  }
}
