import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SignInForm } from "./SignInForm.js";
import { supabase } from "@/lib/supabase.js";

describe("SignInForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an empty submit without ever calling the network", async () => {
    const spy = vi
      .spyOn(supabase.auth, "signInWithPassword")
      .mockResolvedValue({ data: { user: null, session: null }, error: null } as never);

    render(<SignInForm />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a malformed email without calling the network", async () => {
    const spy = vi
      .spyOn(supabase.auth, "signInWithPassword")
      .mockResolvedValue({ data: { user: null, session: null }, error: null } as never);

    render(<SignInForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("calls signInWithPassword with the parsed, trimmed credentials on valid submit", async () => {
    const spy = vi
      .spyOn(supabase.auth, "signInWithPassword")
      .mockResolvedValue({ data: { user: null, session: null }, error: null } as never);

    render(<SignInForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "  owner@vg-eval.test  " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ email: "owner@vg-eval.test", password: "correct-horse" }),
    );
  });

  it("shows a generic error on a failed sign-in — never distinguishes the reason", async () => {
    vi.spyOn(supabase.auth, "signInWithPassword").mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials", name: "AuthApiError", status: 400 },
    } as never);

    render(<SignInForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@vg-eval.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/invalid login credentials/i);
    expect(alert.textContent).toMatch(/couldn't sign you in/i);
  });

  it("Google button starts an OAuth redirect", () => {
    const spy = vi
      .spyOn(supabase.auth, "signInWithOAuth")
      .mockResolvedValue({ data: { provider: "google", url: "https://example.test" }, error: null } as never);

    render(<SignInForm />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google" }),
    );
  });
});
