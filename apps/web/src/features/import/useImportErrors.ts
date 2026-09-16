import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase.js";

export interface ImportError {
  row_number: number;
  field: string | null;
  value_excerpt: string | null;
  reason_code: string;
  reason: string;
  severity: "error" | "warning";
}

const PAGE_SIZE = 50;

/** Paginated (never the whole table — a large run can have thousands of rows here) and
 *  filterable by severity. RLS scopes this to the caller's own brand via the run's brand_id. */
export function useImportErrors(importRunId: string | null, page: number, severity: "all" | "error" | "warning") {
  return useQuery({
    queryKey: ["import-errors", importRunId, page, severity],
    queryFn: async (): Promise<{ rows: ImportError[]; count: number }> => {
      let query = supabase
        .from("import_errors")
        .select("row_number, field, value_excerpt, reason_code, reason, severity", { count: "exact" })
        .eq("import_run_id", importRunId!)
        .order("row_number", { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (severity !== "all") query = query.eq("severity", severity);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as ImportError[], count: count ?? 0 };
    },
    enabled: importRunId !== null,
  });
}

export const IMPORT_ERRORS_PAGE_SIZE = PAGE_SIZE;
