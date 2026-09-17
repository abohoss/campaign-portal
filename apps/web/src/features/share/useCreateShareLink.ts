import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase.js";

/** Returns the plaintext token exactly once — the RPC never returns it again after this call, and
 *  the caller must show/copy it immediately (only its SHA-256 is stored). */
export function useCreateShareLink(campaignId: string) {
  return useMutation({
    mutationFn: async (password: string): Promise<string> => {
      const { data, error } = await supabase.rpc("create_share_link", {
        p_campaign_id: campaignId,
        p_password: password,
      });
      if (error) throw error;
      return data as string;
    },
  });
}
