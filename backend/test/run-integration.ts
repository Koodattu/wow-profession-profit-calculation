import "./support/local-env";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const files = (await readdir(import.meta.dir)).filter((file) => file.endsWith(".integration.ts")).sort();
// Each suite owns and closes its database connection. Keep separate processes
// and run sequentially because catalog/maintenance tests share database state.
const commands = [
  ["run", "--no-env-file", join(import.meta.dir, "setup-database.ts")],
  ...files.map((file) => ["test", "--no-env-file", join(import.meta.dir, file)]),
];
for (const args of commands) {
  const child = Bun.spawn([process.execPath, ...args], { stdout: "inherit", stderr: "inherit", env: process.env });
  const code = await child.exited;
  if (code !== 0) process.exit(code);
}
