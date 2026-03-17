import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./config/env";
import { startScheduler, runInitialSync } from "./jobs/scheduler";

import health from "./routes/health";
import itemRoutes from "./routes/items";
import professionRoutes from "./routes/professions";
import realmRoutes from "./routes/realms";
import craftingRoutes from "./routes/crafting";
import searchRoutes from "./routes/search";
import flippingRoutes from "./routes/flipping";

const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", logger());

// Routes
app.route("/api/health", health);
app.route("/api/items", itemRoutes);
app.route("/api/professions", professionRoutes);
app.route("/api/realms", realmRoutes);
app.route("/api/crafting", craftingRoutes);
app.route("/api/search", searchRoutes);
app.route("/api/flipping", flippingRoutes);

// Start cron jobs and initial data load
startScheduler();
runInitialSync().catch((err) => console.error("[Startup] Initial sync error:", err));

console.log(`WoW Tools Backend running on port ${env.BACKEND_PORT}`);

export default {
  port: env.BACKEND_PORT,
  fetch: app.fetch,
};
