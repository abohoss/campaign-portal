import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase.js";

export interface SignupExtent {
  earliestSignup: string | null;
  latestSignup: string | null;
}

/** Backs the "most recent signup was …" empty-state message and sizes the "All time" window
 *  button — without this, a brand whose data predates the visible window just renders a wall of
 *  zeros with no indication that there is data, or when it is. */
export function useDashboardSignupExtent(brandId: string) {
  return useQuery({
    queryKey: ["dashboard-signup-extent", brandId],
    queryFn: async (): Promise<SignupExtent> => {
      const { data, error } = await supabase.rpc("dashboard_signup_extent", { p_brand_id: brandId });
      if (error) throw error;
      const row = data?.[0] as { earliest_signup: string | null; latest_signup: string | null } | undefined;
      return { earliestSignup: row?.earliest_signup ?? null, latestSignup: row?.latest_signup ?? null };
    },
  });
}
