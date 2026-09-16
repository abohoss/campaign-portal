import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { useSession } from "./useSession.js";
import { supabase } from "@/lib/supabase.js";

const fakeSession = { user: { id: "u1", email: "owner@vg-eval.test" } } as unknown as Session;

describe("useSession", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("starts loading, then reflects whatever getSession resolves to", async () => {
    vi.spyOn(supabase.auth, "getSession").mockResolvedValue({
      data: { session: fakeSession },
      error: null,
    } as never);
    vi.spyOn(supabase.auth, "onAuthStateChange").mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    } as never);

    const { result } = renderHook(() => useSession());

    expect(result.current.loading).toBe(true);
    expect(result.current.session).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBe(fakeSession);
  });

  it("reflects null when there is no session", async () => {
    vi.spyOn(supabase.auth, "getSession").mockResolvedValue({
      data: { session: null },
      error: null,
    } as never);
    vi.spyOn(supabase.auth, "onAuthStateChange").mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    } as never);

    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it("updates when onAuthStateChange fires (e.g. sign-out)", async () => {
    let capturedCallback: ((event: string, session: Session | null) => void) | undefined;
    const unsubscribe = vi.fn();

    vi.spyOn(supabase.auth, "getSession").mockResolvedValue({
      data: { session: fakeSession },
      error: null,
    } as never);
    vi.spyOn(supabase.auth, "onAuthStateChange").mockImplementation((cb) => {
      capturedCallback = cb as never;
      return { data: { subscription: { unsubscribe } } } as never;
    });

    const { result, unmount } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.session).toBe(fakeSession));

    capturedCallback?.("SIGNED_OUT", null);
    await waitFor(() => expect(result.current.session).toBeNull());

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
