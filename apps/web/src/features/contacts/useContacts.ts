import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase.js";

export interface Contact {
  id: string;
  externalId: string;
  fullName: string | null;
  email: string | null;
  phoneE164: string | null;
  country: string | null;
  city: string | null;
  status: string;
  consentMarketing: boolean | null;
  signupAt: string | null;
  createdAt: string;
}

export const CONTACTS_PAGE_SIZE = 50;

interface Cursor {
  createdAt: string;
  id: string;
}

function mapRow(row: Record<string, unknown>): Contact {
  return {
    id: row.id as string,
    externalId: row.external_id as string,
    fullName: row.full_name as string | null,
    email: row.email as string | null,
    phoneE164: row.phone_e164 as string | null,
    country: row.country as string | null,
    city: row.city as string | null,
    status: row.status as string,
    consentMarketing: row.consent_marketing as boolean | null,
    signupAt: row.signup_at as string | null,
    createdAt: row.created_at as string,
  };
}

/** Keyset pagination (AC-SCALE-02) — the cursor is the last row's (created_at, id), matching
 *  contacts_keyset_idx, so page N costs the same as page 1 regardless of how deep it is. Never
 *  OFFSET, which degrades linearly with depth at 84k+ rows. */
export function useContacts(brandId: string) {
  return useInfiniteQuery({
    queryKey: ["contacts", brandId],
    initialPageParam: null as Cursor | null,
    queryFn: async ({ pageParam }): Promise<Contact[]> => {
      const { data, error } = await supabase.rpc("contacts_page", {
        p_brand_id: brandId,
        p_limit: CONTACTS_PAGE_SIZE,
        p_after_created_at: pageParam?.createdAt ?? null,
        p_after_id: pageParam?.id ?? null,
      });
      if (error) throw error;
      return (data ?? []).map(mapRow);
    },
    getNextPageParam: (lastPage): Cursor | undefined => {
      if (lastPage.length < CONTACTS_PAGE_SIZE) return undefined;
      const last = lastPage[lastPage.length - 1]!;
      return { createdAt: last.createdAt, id: last.id };
    },
  });
}
