const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const url = process.env.SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const fallbackKey = process.env.SUPABASE_KEY;

/** Prefer service role so `app_users` works with RLS enabled (no policies for anon). */
const key = serviceRole && String(serviceRole).trim() !== '' ? serviceRole : fallbackKey;

const supabaseAuth = createClient(url, key);

module.exports = supabaseAuth;
