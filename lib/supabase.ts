import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

// Visible in both the browser console and the server logs (Render).
console.log("[supabase] env", {
  url: SUPABASE_URL || "(missing NEXT_PUBLIC_SUPABASE_URL)",
  anonKey: SUPABASE_ANON_KEY ? "present" : "(missing NEXT_PUBLIC_SUPABASE_ANON_KEY)",
});

export const ARTICLES_TABLE = "articles";

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/**
 * Anon-key client. Reads/writes are constrained by the table's RLS policies
 * (see the SQL in the README / setup notes): public select + insert only.
 */
function createSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    console.warn("[supabase] client not created: env variables missing");
    return null;
  }

  console.log("[supabase] creating client", { url: SUPABASE_URL });

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!browserClient) browserClient = createSupabaseClient();
  return browserClient;
}

export function getSupabaseServerClient(): SupabaseClient | null {
  return createSupabaseClient();
}
