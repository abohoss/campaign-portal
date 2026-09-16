import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase.js";

export interface DashboardTotals {
  totalCustomers: number;
  contactable: number;
}

/** §6: both figures come straight from the SQL function `dashboard_totals` — never counted from a
 *  fetched row array, which PostgREST truncates at 1000 rows regardless. */
export function useDashboardTotals(brandId: string) {
  return useQuery({
    queryKey: ["dashboard-totals", brandId],
    queryFn: async (): Promise<DashboardTotals> => {
      const { data, error } = await supabase.rpc("dashboard_totals", { p_brand_id: brandId }).single();
      if (error) throw error;
      const row = data as { total_customers: number; contactable: number };
      return { totalCustomers: Number(row.total_customers), contactable: Number(row.contactable) };
    },
  });
}
