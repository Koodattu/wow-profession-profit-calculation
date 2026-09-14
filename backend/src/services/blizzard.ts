import { env } from "../config/env";
import { createBlizzardClient } from "./blizzard-client";

export const blizzardClient = createBlizzardClient({
  clientId: env.BLIZZARD_CLIENT_ID,
  clientSecret: env.BLIZZARD_CLIENT_SECRET,
  requestTimeoutMs: env.BLIZZARD_REQUEST_TIMEOUT_MS,
  maxRetries: env.BLIZZARD_MAX_RETRIES,
});
