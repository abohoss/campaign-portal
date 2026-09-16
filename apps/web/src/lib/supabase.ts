import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to " +
      "apps/web/.env.local and fill in the project's URL and anon key (never the service-role key).",
  );
}

/** The one Supabase client the deployed app uses — anon key only, per the trust boundary in
 *  docs/IMPLEMENTATION_PLAN.md §4.3 (B1: browser → Postgres, RLS forced, default deny). */
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
