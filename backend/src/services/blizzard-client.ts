import { getRegion } from "../config/regions";
import { fetchWithTimeout, isRetryableStatus, retryDelayMs, sleep } from "./request-policy";

type BlizzardNamespace = "static" | "dynamic";
type TimedFetch = (input: string | URL, init: RequestInit, timeoutMs: number) => Promise<Response>;

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

export interface BlizzardClient {
  get<T>(
    regionId: string,
    endpoint: string,
    namespace: BlizzardNamespace,
    params?: Record<string, string>,
  ): Promise<T>;
  getAllPages<T>(regionId: string, endpoint: string, namespace: BlizzardNamespace): Promise<T[]>;
}

export interface BlizzardClientDependencies {
  clientId: string;
  clientSecret: string;
  requestTimeoutMs: number;
  maxRetries: number;
  timedFetch?: TimedFetch;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

interface RequestOptions {
  input: string | URL;
  init: RequestInit;
  label: string;
  acceptedStatus?: (status: number) => boolean;
}

export function createBlizzardClient(dependencies: BlizzardClientDependencies): BlizzardClient {
  const {
    clientId,
    clientSecret,
    requestTimeoutMs,
    maxRetries,
    timedFetch = fetchWithTimeout,
    wait = sleep,
    now = Date.now,
  } = dependencies;

  if (!Number.isInteger(maxRetries) || maxRetries < 0) throw new Error("maxRetries must be a non-negative integer");
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) throw new Error("requestTimeoutMs must be positive");

  let token: string | null = null;
  let tokenExpiresAt = 0;
  let refreshPromise: Promise<string> | null = null;

  async function requestWithRetry(options: RequestOptions): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let response: Response;
      try {
        response = await timedFetch(options.input, options.init, requestTimeoutMs);
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries) break;
        const delayMs = retryDelayMs(attempt);
        console.warn(`[BlizzardClient] Retrying ${options.label} in ${delayMs}ms after a request error`);
        await wait(delayMs);
        continue;
      }

      if (response.ok || options.acceptedStatus?.(response.status)) return response;

      lastError = new Error(`${options.label} failed: ${response.status} ${response.statusText}`);
      if (!isRetryableStatus(response.status) || attempt === maxRetries) throw lastError;

      const delayMs = retryDelayMs(attempt, response.headers.get("Retry-After"));
      console.warn(`[BlizzardClient] Retrying ${options.label} in ${delayMs}ms after HTTP ${response.status}`);
      await wait(delayMs);
    }

    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`${options.label} failed: ${detail}`);
  }

  async function fetchToken(): Promise<string> {
    console.log("[BlizzardClient] Fetching new OAuth token...");
    const credentials = btoa(`${clientId}:${clientSecret}`);
    const response = await requestWithRetry({
      input: "https://oauth.battle.net/token",
      init: {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      },
      label: "OAuth token request",
    });
    const data = (await response.json()) as Partial<TokenResponse>;
    const expiresIn = data.expires_in;
    if (!data.access_token || typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error("OAuth token response was invalid");
    }

    token = data.access_token;
    tokenExpiresAt = now() + expiresIn * 1_000;
    console.log(`[BlizzardClient] Token acquired, expires in ${expiresIn}s`);
    return token;
  }

  async function getToken(): Promise<string> {
    if (token && now() < tokenExpiresAt - 5 * 60 * 1_000) return token;

    refreshPromise ??= fetchToken().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  function invalidateToken(usedToken: string): void {
    if (token !== usedToken) return;
    token = null;
    tokenExpiresAt = 0;
  }

  async function requestApi(url: URL, endpoint: string, authorization: string): Promise<Response> {
    return requestWithRetry({
      input: url,
      init: { headers: { Authorization: `Bearer ${authorization}` } },
      label: `GET ${endpoint}`,
      acceptedStatus: (status) => status === 401,
    });
  }

  async function get<T>(
    regionId: string,
    endpoint: string,
    namespace: BlizzardNamespace,
    params?: Record<string, string>,
  ): Promise<T> {
    const region = getRegion(regionId);
    const url = new URL(`https://${region.apiHost}${endpoint}`);
    url.searchParams.set("namespace", `${namespace}-${regionId}`);
    url.searchParams.set("locale", region.locale);
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);

    console.log(`[BlizzardClient] GET ${endpoint}`);
    let authorization = await getToken();
    let response = await requestApi(url, endpoint, authorization);

    if (response.status === 401) {
      invalidateToken(authorization);
      authorization = await getToken();
      response = await requestApi(url, endpoint, authorization);
    }

    if (!response.ok) throw new Error(`GET ${endpoint} failed: ${response.status} ${response.statusText}`);
    return (await response.json()) as T;
  }

  async function getAllPages<T>(regionId: string, endpoint: string, namespace: BlizzardNamespace): Promise<T[]> {
    const results: T[] = [];
    let page = 1;

    while (true) {
      const data = await get<{ results: T[]; _pageCount?: number }>(regionId, endpoint, namespace, { _page: String(page) });
      results.push(...(data.results ?? []));
      if (!data._pageCount || page >= data._pageCount) return results;
      page++;
    }
  }

  return { get, getAllPages };
}
