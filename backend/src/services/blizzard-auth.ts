import { env } from "../config/env";
import { fetchWithTimeout, isRetryableStatus, retryDelayMs, sleep } from "./request-policy";

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class BlizzardAuth {
  private static instance: BlizzardAuth;
  private token: string | null = null;
  private expiresAt = 0;
  private refreshPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): BlizzardAuth {
    if (!BlizzardAuth.instance) {
      BlizzardAuth.instance = new BlizzardAuth();
    }
    return BlizzardAuth.instance;
  }

  async getToken(): Promise<string> {
    if (!this.token || Date.now() >= this.expiresAt - 5 * 60 * 1000) {
      this.refreshPromise ??= this.fetchToken().finally(() => {
        this.refreshPromise = null;
      });
      await this.refreshPromise;
    }
    return this.token!;
  }

  invalidateToken(token?: string): void {
    if (!token || token === this.token) {
      this.token = null;
      this.expiresAt = 0;
    }
  }

  private async fetchToken(): Promise<void> {
    console.log("[BlizzardAuth] Fetching new OAuth token...");
    const credentials = btoa(`${env.BLIZZARD_CLIENT_ID}:${env.BLIZZARD_CLIENT_SECRET}`);
    let lastError: unknown;

    for (let attempt = 0; attempt <= env.BLIZZARD_MAX_RETRIES; attempt++) {
      let response: Response;
      try {
        response = await fetchWithTimeout(
          "https://oauth.battle.net/token",
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${credentials}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "grant_type=client_credentials",
          },
          env.BLIZZARD_REQUEST_TIMEOUT_MS,
        );
      } catch (error) {
        lastError = error;
        if (attempt === env.BLIZZARD_MAX_RETRIES) break;
        await sleep(retryDelayMs(attempt));
        continue;
      }

      if (response.ok) {
        const data = (await response.json()) as TokenResponse;
        this.token = data.access_token;
        this.expiresAt = Date.now() + data.expires_in * 1_000;
        console.log(`[BlizzardAuth] Token acquired, expires in ${data.expires_in}s`);
        return;
      }

      lastError = new Error(`[BlizzardAuth] Token fetch failed: ${response.status} ${response.statusText}`);
      if (!isRetryableStatus(response.status) || attempt === env.BLIZZARD_MAX_RETRIES) {
        throw lastError;
      }

      await sleep(retryDelayMs(attempt, response.headers.get("Retry-After")));
    }

    throw lastError instanceof Error ? lastError : new Error("[BlizzardAuth] Token fetch failed");
  }
}
