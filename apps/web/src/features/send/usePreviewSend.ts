import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase.js";

export interface PreviewResult {
  sendId: string;
  recipientCount: number;
}

/** Freezes the audience (or returns the existing draft, unchanged, if one is already open —
 *  preview_send is idempotent). The count this returns is what confirm_send will re-validate
 *  against at approval time (AC-SEND-04). */
export function usePreviewSend(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<PreviewResult> => {
      const { data, error } = await supabase.rpc("preview_send", { p_campaign_id: campaignId }).single();
      if (error) throw error;
      const row = data as { send_id: string; recipient_count: number };
      return { sendId: row.send_id, recipientCount: row.recipient_count };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["send-for-campaign", campaignId] });
    },
  });
}
