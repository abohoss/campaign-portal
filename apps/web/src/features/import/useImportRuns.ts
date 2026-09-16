import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase.js";

export interface ImportRun {
  id: string;
  kind: "contacts" | "campaigns";
  filename: string;
  status: "queued" | "running" | "succeeded" | "partial" | "failed";
  total_rows: number | null;
  processed_rows: number;
  inserted_count: number;
  updated_count: number;
  rejected_count: number;
  warning_count: number;
  detected_encoding: string | null;
  detected_delimiter: string | null;
  error_summary: string | null;
  created_at: string;
  finished_at: string | null;
}

const ACTIVE_STATUSES = new Set(["queued", "running"]);

/** Polls import_runs for the signed-in brand every 2s while anything is still queued/running,
 *  and stops polling once everything has settled — no point hammering the DB for a page nobody's
 *  watching progress bars on anymore. RLS (import_runs_select) already scopes this to the
 *  caller's own brand; there is no brandId filter to get wrong here. */
export function useImportRuns() {
  return useQuery({
    queryKey: ["import-runs"],
    queryFn: async (): Promise<ImportRun[]> => {
      const { data, error } = await supabase
        .from("import_runs")
        .select(
          "id, kind, filename, status, total_rows, processed_rows, inserted_count, updated_count, rejected_count, warning_count, detected_encoding, detected_delimiter, error_summary, created_at, finished_at",
        )
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as ImportRun[];
    },
    refetchInterval: (query) => {
      const runs = query.state.data as ImportRun[] | undefined;
      return runs?.some((r) => ACTIVE_STATUSES.has(r.status)) ? 2000 : false;
    },
  });
}
