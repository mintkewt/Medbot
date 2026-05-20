#!/usr/bin/env node
/**
 * Fresh-database setup from repo root:
 * 1) Ensure env files exist (copy from .env.example if missing)
 * 2) Apply SQL schema (pnpm db:schema → apps/api)
 * 3) Seed first app user if SEED_USER_EMAIL / SEED_USER_PASSWORD are set (or skip with --if-present on seed)
 *
 * Prerequisites: pnpm install completed; apps/api/.env filled for DB + Supabase.
 * Run: pnpm bootstrap
 */
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";

function run(label, cmd, args) {
  console.log(`\n── ${label} ──`);
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: isWin,
    env: process.env,
  });
  if (res.error) {
    console.error(res.error);
    process.exit(1);
  }
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

if (!existsSync(join(root, "node_modules"))) {
  console.error("Run `pnpm install` from the repository root first.");
  process.exit(1);
}

if (!existsSync(join(root, "apps", "api", ".env"))) {
  console.error("Missing apps/api/.env — run `pnpm setup:env` and edit the file.");
  process.exit(1);
}

run("Copy env examples (if missing)", process.execPath, [join(root, "scripts", "setup-env.mjs")]);

run("Apply database schema (full_schema_empty_database.sql)", "pnpm", [
  "--filter",
  "@medical-chatbot/api",
  "run",
  "db:schema",
]);

run("Seed login user (skipped if SEED_* unset)", "pnpm", [
  "--filter",
  "@medical-chatbot/api",
  "run",
  "seed:user:maybe",
]);

console.log("\nBootstrap finished.");
console.log("   • Ensure apps/web/.env.local has NEXT_PUBLIC_API_URL (e.g. http://localhost:5000).");
console.log("   • Start stack: pnpm dev");
console.log("   • Optional: cd apps/api && pnpm nomic:cache   (faster first embedding)\n");
