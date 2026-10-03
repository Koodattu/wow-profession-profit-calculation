import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import health from "./routes/health";
import itemRoutes from "./routes/items";
import professionRoutes from "./routes/professions";
import realmRoutes from "./routes/realms";
import craftingRoutes from "./routes/crafting";
import searchRoutes from "./routes/search";
import flippingRoutes from "./routes/flipping";
import marketRoutes from "./routes/market";

// HTTP assembly is separate from startup so tests use the real routes without
// launching scheduled jobs or contacting Blizzard.
const app = new Hono();
app.use("*", cors());
app.use("*", logger());
app.route("/api/health", health);
app.route("/api/items", itemRoutes);
app.route("/api/professions", professionRoutes);
app.route("/api/realms", realmRoutes);
app.route("/api/crafting", craftingRoutes);
app.route("/api/search", searchRoutes);
app.route("/api/flipping", flippingRoutes);
app.route("/api/market", marketRoutes);

export default app;
