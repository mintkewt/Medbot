/**
 * One-off: create or update an app_users row (bcrypt password).
 * Requires SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY with service_role JWT). RLS on app_users blocks anon.
 *
 * Usage (from apps/api):
 *   SEED_USER_EMAIL=you@example.com SEED_USER_PASSWORD='secret' node scripts/seed-user.js
 *
 * With --if-present: if SEED_* are unset, print a hint and exit 0 (for pnpm bootstrap).
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const ifPresent = process.argv.includes('--if-present');

const email = String(process.env.SEED_USER_EMAIL || '').trim().toLowerCase();
const password = process.env.SEED_USER_PASSWORD || '';
const url = process.env.SUPABASE_URL;
const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY && String(process.env.SUPABASE_SERVICE_ROLE_KEY).trim() !== ''
        ? process.env.SUPABASE_SERVICE_ROLE_KEY
        : process.env.SUPABASE_KEY;

/** Supabase JWT payload includes role: anon | service_role | authenticated */
function supabaseJwtRole(jwt) {
    if (!jwt || typeof jwt !== 'string') return null;
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    try {
        const json = Buffer.from(parts[1], 'base64url').toString('utf8');
        const payload = JSON.parse(json);
        return payload.role || null;
    } catch {
        return null;
    }
}

if (!email || !password) {
    if (ifPresent) {
        console.log('Skipping user seed: set SEED_USER_EMAIL and SEED_USER_PASSWORD in apps/api/.env');
        process.exit(0);
    }
    console.error('Set SEED_USER_EMAIL and SEED_USER_PASSWORD');
    process.exit(1);
}
if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY with service role)');
    process.exit(1);
}

const jwtRole = supabaseJwtRole(key);
if (jwtRole === 'anon') {
    console.error(
        'This script needs the service_role key (RLS blocks anon on app_users). Set SUPABASE_SERVICE_ROLE_KEY in apps/api/.env — Supabase Dashboard → Project Settings → API → service_role (secret).'
    );
    process.exit(1);
}

const rounds = Number(process.env.SEED_BCRYPT_ROUNDS || 12);
const supabase = createClient(url, key);

(async () => {
    const password_hash = await bcrypt.hash(password, rounds);
    const { data, error } = await supabase
        .from('app_users')
        .upsert({ email, password_hash }, { onConflict: 'email' });

    if (error) {
        console.error('Supabase error:', error.message, error.code || '');
        console.error(
            'If RLS/permission: set SUPABASE_SERVICE_ROLE_KEY (Dashboard → Project Settings → API → service_role).'
        );
        process.exit(1);
    }
    console.log('OK: user ready for login:', email, data);
})();
