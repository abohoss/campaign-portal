import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase.js";

export interface DailySignups {
  day: string;
  signups: number;
}

/** §6: 30 days, zero-filled by the SQL function itself (generate_series) so an empty brand
 *  (Karoo/Marrakech, whose data ends 2026-04-17) still returns exactly 30 rows of zero rather than
 *  an empty array the UI would have to special-case as "still loading". */
export function useDashboardSignups(brandId: string) {
  return useQuery({
    queryKey: ["dashboard-signups", brandId],
    queryFn: async (): Promise<DailySignups[]> => {
      const { data, error } = await supabase.rpc("dashboard_signups_daily", { p_brand_id: brandId });
      if (error) throw error;
      return ((data ?? []) as { day: string; signups: number }[]).map((row) => ({
        day: row.day,
        signups: Number(row.signups),
      }));
    },
  });
}
