/**
 * Demo mode is on whenever Supabase is not configured, or when PORTAL_DEMO=true.
 * In demo mode there is no login and every page renders the seeded demo client,
 * so the portal can be previewed before any integration exists.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const demoMode = process.env.PORTAL_DEMO === "true" || !supabaseConfigured;
