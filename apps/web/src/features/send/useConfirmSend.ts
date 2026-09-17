import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase.js";

/** Approves a previewed send. Passes the count the screen showed, which confirm_send re-validates
 *  under a row lock against the send's actual snapshot_count — if contacts changed between preview
 *  and confirm, this fails loudly with 'count_changed' rather than silently approving a different
 *  audience than the one displayed (AC-SEND-04). */
export function useConfirmSend(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sendId, expectedCount }: { sendId: string; expectedCount: number }): Promise<void> => {
      const { error } = await supabase.rpc("confirm_send", { p_send_id: sendId, p_expected_count: expectedCount });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["send-for-campaign", campaignId] });
    },
  });
}
