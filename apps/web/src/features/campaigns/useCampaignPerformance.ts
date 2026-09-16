import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase.js";

export interface CampaignPerformance {
  campaignId: string;
  externalId: string;
  name: string;
  channel: string;
  sentAt: string | null;
  reportedSent: number | null;
  reportedDelivered: number | null;
  reportedBounced: number | null;
  reportedOpens: number | null;
  reportedClicks: number | null;
  spend: number | null;
  uniqueOpens: number;
  totalOpens: number;
  uniqueUnsubscribes: number;
  openRate: number | null;
  bounceRate: number | null;
  opensExceedDelivered: boolean;
  reportedTotalsInconsistent: boolean;
}

function mapRow(row: Record<string, unknown>): CampaignPerformance {
  return {
    campaignId: row.campaign_id as string,
    externalId: row.external_id as string,
    name: row.name as string,
    channel: row.channel as string,
    sentAt: row.sent_at as string | null,
    reportedSent: row.reported_sent as number | null,
    reportedDelivered: row.reported_delivered as number | null,
    reportedBounced: row.reported_bounced as number | null,
    reportedOpens: row.reported_opens as number | null,
    reportedClicks: row.reported_clicks as number | null,
    spend: row.spend === null ? null : Number(row.spend),
    uniqueOpens: Number(row.unique_opens),
    totalOpens: Number(row.total_opens),
    uniqueUnsubscribes: Number(row.unique_unsubscribes),
    openRate: row.open_rate === null ? null : Number(row.open_rate),
    bounceRate: row.bounce_rate === null ? null : Number(row.bounce_rate),
    opensExceedDelivered: row.opens_exceed_delivered as boolean,
    reportedTotalsInconsistent: row.reported_totals_inconsistent as boolean,
  };
}

/** §6/§2.8: reported (as supplied) and computed (from the engagement log) figures side by side,
 *  plus the two data-quality flags — never silently reconciled. */
export function useCampaignPerformance(brandId: string) {
  return useQuery({
    queryKey: ["campaign-performance", brandId],
    queryFn: async (): Promise<CampaignPerformance[]> => {
      const { data, error } = await supabase.rpc("dashboard_campaign_performance", { p_brand_id: brandId });
      if (error) throw error;
      return (data ?? []).map(mapRow);
    },
  });
}
