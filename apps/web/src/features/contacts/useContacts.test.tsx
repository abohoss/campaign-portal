import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useContacts, CONTACTS_PAGE_SIZE } from "./useContacts.js";
import { supabase } from "@/lib/supabase.js";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function rawContact(id: string, createdAt: string) {
  return {
    id,
    external_id: `CT-${id}`,
    full_name: "Fatima Achieng",
    email: "a@vg-eval.test",
    phone_e164: "+254712345678",
    country: "KE",
    city: "Nairobi",
    status: "active",
    consent_marketing: true,
    signup_at: "2026-01-01T00:00:00Z",
    created_at: createdAt,
  };
}

describe("useContacts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the first page with a null cursor and maps snake_case rows", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [rawContact("1", "2026-09-01T00:00:00Z")], error: null });
    vi.spyOn(supabase, "rpc").mockImplementation(rpc);

    const { result } = renderHook(() => useContacts("brand-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpc).toHaveBeenCalledWith("contacts_page", {
      p_brand_id: "brand-1",
      p_limit: CONTACTS_PAGE_SIZE,
      p_after_created_at: null,
      p_after_id: null,
    });
    expect(result.current.data?.pages[0]).toEqual([
      {
        id: "1",
        externalId: "CT-1",
        fullName: "Fatima Achieng",
        email: "a@vg-eval.test",
        phoneE164: "+254712345678",
        country: "KE",
        city: "Nairobi",
        status: "active",
        consentMarketing: true,
        signupAt: "2026-01-01T00:00:00Z",
        createdAt: "2026-09-01T00:00:00Z",
      },
    ]);
  });

  it("reports no next page when a page comes back shorter than the page size", async () => {
    vi.spyOn(supabase, "rpc").mockResolvedValue({
      data: [rawContact("1", "2026-09-01T00:00:00Z")],
      error: null,
    } as never);

    const { result } = renderHook(() => useContacts("brand-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("fetches the next page using the last row's (createdAt, id) as the cursor", async () => {
    const fullPage = Array.from({ length: CONTACTS_PAGE_SIZE }, (_, i) =>
      rawContact(String(i), `2026-09-01T00:00:${String(i).padStart(2, "0")}Z`),
    );
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: fullPage, error: null })
      .mockResolvedValueOnce({ data: [rawContact("last", "2026-09-02T00:00:00Z")], error: null });
    vi.spyOn(supabase, "rpc").mockImplementation(rpc);

    const { result } = renderHook(() => useContacts("brand-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    const lastOfFirstPage = fullPage[fullPage.length - 1]!;
    expect(rpc).toHaveBeenLastCalledWith("contacts_page", {
      p_brand_id: "brand-1",
      p_limit: CONTACTS_PAGE_SIZE,
      p_after_created_at: lastOfFirstPage.created_at,
      p_after_id: lastOfFirstPage.id,
    });
  });

  it("surfaces an RPC error as isError", async () => {
    vi.spyOn(supabase, "rpc").mockResolvedValue({ data: null, error: new Error("boom") } as never);

    const { result } = renderHook(() => useContacts("brand-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
