// Imported before application modules: never fall back to a developer's .env.
const target = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (!target || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  || !target.pathname.endsWith("_test")) {
  throw new Error("Set DATABASE_URL explicitly to a disposable localhost database whose name ends in _test.");
}
process.env.BLIZZARD_CLIENT_ID = "synthetic-test";
process.env.BLIZZARD_CLIENT_SECRET = "synthetic-test";
process.env.NODE_ENV = "test";
