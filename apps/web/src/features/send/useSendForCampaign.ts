import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase.js";

export interface Send {
  id: string;
  status: "draft" | "approved" | "sending" | "sent" | "failed" | "cancelled";
  snapshotCount: number;
  chunksTotal: number;
  chunksDone: number;
  createdAt: string;
  approvedAt: string | null;
}

const ACTIVE_STATUSES = new Set(["approved", "sending"]);

function mapRow(row: Record<string, unknown>): Send {
  return {
    id: row.id as string,
    status: row.status as Send["status"],
    snapshotCount: row.snapshot_count as number,
    chunksTotal: row.chunks_total as number,
    chunksDone: row.chunks_done as number,
    createdAt: row.created_at as string,
    approvedAt: row.approved_at as string | null,
  };
}

/** The most recent send for this campaign — at most one can be draft/approved/sending at a time
 *  (sends_one_active_per_campaign), so "most recent" and "the active one" coincide while a send is
 *  in flight. Polls while a send is actually moving (approved/sending), stops once settled. */
export function useSendForCampaign(campaignId: string) {
  return useQuery({
    queryKey: ["send-for-campaign", campaignId],
    queryFn: async (): Promise<Send | null> => {
      const { data, error } = await supabase
        .from("sends")
        .select("id, status, snapshot_count, chunks_total, chunks_done, created_at, approved_at")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] ? mapRow(data[0]) : null;
    },
    refetchInterval: (query) => (ACTIVE_STATUSES.has(query.state.data?.status ?? "") ? 2000 : false),
  });
}
