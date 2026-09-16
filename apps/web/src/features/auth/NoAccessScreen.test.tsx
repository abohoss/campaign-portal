import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NoAccessScreen } from "./NoAccessScreen.js";
import { supabase } from "@/lib/supabase.js";

describe("NoAccessScreen", () => {
  it("explains the situation rather than showing a blank page", () => {
    render(<NoAccessScreen />);
    expect(screen.getByRole("heading", { name: "No access" })).toBeInTheDocument();
  });

  it("signs the user out when they click Sign out", () => {
    const spy = vi.spyOn(supabase.auth, "signOut").mockResolvedValue({ error: null });
    render(<NoAccessScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(spy).toHaveBeenCalled();
  });
});
