import { env } from "../config/env";

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class BlizzardAuth {
  private static instance: BlizzardAuth;
  private token: string | null = null;
  private expiresAt: number = 0;

  private constructor() {}

  static getInstance(): BlizzardAuth {
    if (!BlizzardAuth.instance) {
      BlizzardAuth.instance = new BlizzardAuth();
    }
    return BlizzardAuth.instance;
  }

  async getToken(): Promise<string> {
    // Refresh if token is missing or expires within 5 minutes
    if (!this.token || Date.now() >= this.expiresAt - 5 * 60 * 1000) {
      await this.fetchToken();
    }
    return this.token!;
  }

  private async fetchToken(): Promise<void> {
    console.log("[BlizzardAuth] Fetching new OAuth token...");

    const credentials = btoa(`${env.BLIZZARD_CLIENT_ID}:${env.BLIZZARD_CLIENT_SECRET}`);

    const response = await fetch("https://oauth.battle.net/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      throw new Error(`[BlizzardAuth] Token fetch failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as TokenResponse;
    this.token = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;

    console.log(`[BlizzardAuth] Token acquired, expires in ${data.expires_in}s`);
  }
}
