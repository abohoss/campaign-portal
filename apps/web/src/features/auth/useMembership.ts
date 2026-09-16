import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase.js";
import type { Session } from "@supabase/supabase-js";

export interface Membership {
  role: "owner" | "analyst";
  brandId: string;
  brandSlug: string;
  brandName: string;
}

/**
 * The signed-in user's own membership row(s) — RLS (`memberships_select`, scoped to
 * `user_id = auth.uid()`) already guarantees this can never return anyone else's row, so no
 * client-side filtering is needed or possible to get wrong.
 *
 * An empty result is a real, expected case (AC-AUTH-06): a user can exist in `auth.users` with
 * no membership at all — the allowlist hook keeps that from happening for a brand-new signup, but
 * doesn't retroactively apply to a user created before their allowlist entry existed. The caller
 * (AuthGate) renders the explicit "no access" screen for that case, not a spinner or a crash.
 */
export function useMembership(session: Session | null) {
  return useQuery({
    queryKey: ["membership", session?.user.id],
    queryFn: async (): Promise<Membership[]> => {
      const { data, error } = await supabase
        .from("memberships")
        .select("role, brand_id, brands:brand_id(slug, name)");
      if (error) throw error;
      return (data ?? []).map((row) => ({
        role: row.role as "owner" | "analyst",
        brandId: row.brand_id as string,
        brandSlug: (row.brands as unknown as { slug: string }).slug,
        brandName: (row.brands as unknown as { name: string }).name,
      }));
    },
    enabled: session !== null,
    staleTime: Infinity, // membership never changes during a session — users can't self-modify it
  });
}
