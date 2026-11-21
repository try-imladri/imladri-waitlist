// Local configuration/build helper only. It never creates a cloud resource,
// deploys, uploads secrets, or executes remote SQL.
import { readFile, writeFile, readdir, mkdir, rm, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "wrangler.cloudflare.json");
const outputRoot = resolve(root, "outputs");
const placeholder = "00000000-0000-4000-8000-000000000000";
const args = process.argv.slice(2);
const allowedFlags = new Set(["--database-id", "--build", "--verify", "--help"]);
let suppliedId = null;
for (let at = 0; at < args.length; at++) {
  if (!allowedFlags.has(args[at])) throw new Error(`Unknown option: ${args[at]}`);
  if (args[at] === "--database-id") { suppliedId = args[++at]; if (!suppliedId) throw new Error("--database-id needs the dashboard UUID."); }
}
if (args.includes("--help")) {
  console.log("Usage: node scripts/prepare-cloudflare.mjs [--database-id UUID] [--build] [--verify]");
  console.log("Writes nonsecret D1 dashboard bootstrap SQL and an applied-migration ledger. --build uses only vite.cloudflare.config.ts. --verify rejects placeholder D1 and old Sites authentication markers.");
  process.exit(0);
}
const config = JSON.parse(await readFile(sourcePath, "utf8"));
if (suppliedId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(suppliedId) || suppliedId === placeholder) throw new Error("Supply the real Cloudflare D1 database UUID.");
  config.d1_databases.find(binding => binding.binding === "DB").database_id = suppliedId;
  await writeFile(sourcePath, JSON.stringify(config, null, 2) + "\n");
}
await mkdir(outputRoot, { recursive: true });
const migrationsRoot = resolve(root, "drizzle");
const migrationFiles = (await readdir(migrationsRoot)).filter(file => /^\d+_[A-Za-z0-9_-]+\.sql$/.test(file)).sort();
if (!migrationFiles.length) throw new Error("No authored schema migrations were found.");
const schema = [], steps = [];
for (const file of migrationFiles) {
  const sql = await readFile(resolve(migrationsRoot, file), "utf8");
  const statements = sql.split("--> statement-breakpoint").map(statement => statement.trim()).filter(Boolean);
  schema.push(`-- ${file}\n${statements.join("\n\n")}\n`);
  for (const [index, statement] of statements.entries()) steps.push({ migration: file, statement: index + 1, sql: statement });
}
const ledger = `-- Run ONLY after every schema statement above succeeds on the NEW empty database.\nCREATE TABLE IF NOT EXISTS d1_migrations (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT UNIQUE,\n  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL\n);\n${migrationFiles.map(file => `INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${file}');`).join("\n")}\n`;
await writeFile(resolve(outputRoot, "cloudflare-bootstrap.sql"), `-- SCHEMA ONLY for a NEW EMPTY Cloudflare D1 database.\n-- Do not replay on an initialized database. No user records or secrets are included.\n\n${schema.join("\n")}`);
await writeFile(resolve(outputRoot, "cloudflare-migration-ledger.sql"), ledger);
await writeFile(resolve(outputRoot, "cloudflare-bootstrap-steps.json"), JSON.stringify({ schemaStatements: steps, ledgerAfterAllSchemaSucceeds: ledger }, null, 2));

if (args.includes("--build")) {
  const result = spawnSync(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "build", "--config", "vite.cloudflare.config.ts"], { cwd: root, stdio: "inherit", env: { ...process.env, NODE_ENV: "production", WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  // A prior Sites build may have left this generated metadata folder. This
  // removes only that folder inside this checkout's own dist directory.
  const distRoot = resolve(root, "dist"), oldMetadata = resolve(distRoot, ".openai");
  if (!oldMetadata.startsWith(distRoot + sep)) throw new Error("Unexpected build metadata path.");
  await rm(oldMetadata, { recursive: true, force: true });
  // Vite emits local preview secrets beside the Worker. They are never needed
  // for a production upload; runtime secrets are configured directly in Cloudflare.
  for (const directory of ["server", "client"]) {
    const generatedSecrets = resolve(distRoot, directory, ".dev.vars");
    if (!generatedSecrets.startsWith(distRoot + sep)) throw new Error("Unexpected generated secrets path.");
    await rm(generatedSecrets, { force: true });
  }
}
let verified = false;
if (args.includes("--verify")) {
  const db = config.d1_databases.find(binding => binding.binding === "DB");
  if (!db || db.database_id === placeholder) throw new Error("The real Cloudflare D1 UUID must be configured before production verification.");
  const buildRoot = resolve(root, "dist/server");
  const deployed = JSON.parse(await readFile(resolve(buildRoot, "wrangler.json"), "utf8"));
  if (deployed.name !== "imladri-waitlist" || deployed.account_id !== config.account_id) throw new Error("Generated Worker identity does not match the standalone Cloudflare config.");
  if (deployed.d1_databases?.find(binding => binding.binding === "DB")?.database_id !== db.database_id) throw new Error("Generated D1 binding does not match the owner database.");
  if (deployed.assets?.binding !== "ASSETS") throw new Error("Vinext's ASSETS binding is missing.");
  await access(resolve(buildRoot, deployed.main));
  await access(resolve(buildRoot, deployed.assets.directory));
  async function checkAuthMarkers(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await checkAuthMarkers(path);
      else if (/\.(?:js|mjs)$/.test(entry.name)) {
        const text = await readFile(path, "utf8");
        if (/oai-authenticated-user-|signin-with-chatgpt|signout-with-chatgpt|__sites_local_auth/.test(text)) throw new Error("The production bundle still contains an old Sites authentication dependency.");
      }
    }
  }
  await checkAuthMarkers(resolve(root, "dist/server"));
  await checkAuthMarkers(resolve(root, "dist/client"));
  verified = true;
}
console.log(JSON.stringify({ configured: true, databaseIdConfigured: config.d1_databases.find(binding => binding.binding === "DB").database_id !== placeholder, migrations: migrationFiles, schemaStatements: steps.length, built: args.includes("--build"), verified, deployConfig: "dist/server/wrangler.json", cloudResourcesChanged: false }));
