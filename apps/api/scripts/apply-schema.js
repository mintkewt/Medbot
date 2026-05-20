#!/usr/bin/env node
/** Runs `supabase/schema/full_schema_empty_database.sql`. Requires `DATABASE_URL` in apps/api/.env (Postgres URI from Supabase Dashboard → Database). From repo root: `pnpm db:schema` / `pnpm bootstrap`. */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

function trimEnv(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function resolveDbUrl() {
  let d = trimEnv(process.env.DATABASE_URL);
  if (!d) return null;
  if (!/[?&]sslmode=/.test(d)) {
    d += d.includes('?') ? '&sslmode=require' : '?sslmode=require';
  }
  return d;
}

const url = resolveDbUrl();
if (!url) {
  console.error('Missing DATABASE_URL.');
  console.error('  In apps/api/.env set the Postgres connection string from Supabase:');
  console.error('  Dashboard → Project Settings → Database → Connection string → URI');
  console.error('  Example: postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres');
  console.error('  Prefer the direct connection (port 5432) for large DDL, not the pooler (6543), if both exist.');
  process.exit(1);
}

const sqlFile = path.join(__dirname, '..', '..', '..', 'supabase', 'schema', 'full_schema_empty_database.sql');
if (!fs.existsSync(sqlFile)) {
  console.error('File not found:', sqlFile);
  process.exit(1);
}
const body = fs.readFileSync(sqlFile, 'utf8');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const TRANSIENT_MSG =
  /shutting down|starting up|administrator command|connection.*refused|econnreset|etimedout|timed out|enotfound|eai_again|getaddrinfo/i;

(async () => {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const sql = postgres(url, { max: 1, connect_timeout: 90 });
    try {
      await sql`SET statement_timeout = 0`;
      await sql`SET lock_timeout = '300s'`;
      await sql.unsafe(body);
      console.log('Finished supabase/schema/full_schema_empty_database.sql');
      await sql.end({ timeout: 30 });
      process.exit(0);
    } catch (e) {
      const msg = e.message || String(e);
      await sql.end({ timeout: 5 }).catch(() => {});
      if (attempt < maxAttempts && TRANSIENT_MSG.test(msg)) {
        console.warn(`Attempt ${attempt}/${maxAttempts}: ${msg} — retry in 12s…`);
        await sleep(12000);
        continue;
      }
      console.error('SQL error:', msg);
      if (/EAI_AGAIN|ENOTFOUND|getaddrinfo|EAI_NODATA/i.test(msg)) {
        console.error('');
        console.error('DNS / network: could not reach the host in DATABASE_URL.');
        console.error('Try:');
        console.error('  1) Set system DNS to 8.8.8.8 or 1.1.1.1 (router DNS often causes EAI_AGAIN).');
        console.error('  2) Direct host db.<ref>.supabase.co is often IPv6-only; if IPv6 is broken, use the');
        console.error('     Session pooler URI instead (has IPv4): Dashboard → Database → Connection string');
        console.error('     → "Session pooler" / port 5432, user postgres.<project-ref>.');
        console.error('  3) Confirm the project is not paused; URI matches Dashboard → Database.');
      }
      process.exit(1);
    }
  }
})();
