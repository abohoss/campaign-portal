import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase.js";

export interface DailySignups {
  day: string;
  signups: number;
}

/** §6: zero-filled by the SQL function itself (generate_series) so an empty window (e.g. Karoo/
 *  Marrakech's fixed 30-day default, whose data ends 2026-04-17) still returns a full run of zero
 *  rows rather than an empty array the UI would have to special-case as "still loading". `days`
 *  is a real RPC argument (clamped server-side to 1..1825), not a client-only slice — added after
 *  the fixed 30-day window shipped with no way to look further back. */
export function useDashboardSignups(brandId: string, days: number) {
  return useQuery({
    queryKey: ["dashboard-signups", brandId, days],
    queryFn: async (): Promise<DailySignups[]> => {
      const { data, error } = await supabase.rpc("dashboard_signups_daily", { p_brand_id: brandId, p_days: days });
      if (error) throw error;
      return ((data ?? []) as { day: string; signups: number }[]).map((row) => ({
        day: row.day,
        signups: Number(row.signups),
      }));
    },
  });
}
