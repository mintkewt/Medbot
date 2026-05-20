#!/usr/bin/env node
/**
 * Copy .env examples when targets are missing (safe to re-run).
 * Run from repository root: pnpm setup:env
 */
import { copyFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const copies = [
  { from: join(root, "apps", "api", ".env.example"), to: join(root, "apps", "api", ".env"), label: "API" },
  { from: join(root, "apps", "web", ".env.example"), to: join(root, "apps", "web", ".env.local"), label: "Web" },
];

let created = 0;
for (const { from, to, label } of copies) {
  if (!existsSync(from)) {
    console.error(`Missing example file: ${from}`);
    process.exit(1);
  }
  if (existsSync(to)) {
    console.log(`• ${label}: kept existing ${to}`);
    continue;
  }
  copyFileSync(from, to);
    console.log(`+ ${label}: created ${to}`);
  created += 1;
}

if (created > 0) {
  console.log("\nNext: edit apps/api/.env (Supabase, JWT_SECRET, API keys) and apps/web/.env.local (NEXT_PUBLIC_API_URL).");
  console.log("Then: pnpm bootstrap   # apply DB schema + optional user seed");
  console.log("Then: pnpm dev");
} else {
  console.log("\nEnv files already present. Run pnpm bootstrap when ready.");
}
