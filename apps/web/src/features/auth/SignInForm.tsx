import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase.js";
import { signInSchema } from "./sign-in-schema.js";

/**
 * Email/password + Google. Both are meant to reach the same six accounts (docs/IMPLEMENTATION_PLAN.md
 * "What the portal should do"): whichever an outsider tries, `public.before_user_created_hook`
 * rejects them on account creation — this form only handles the UI side of an already-legitimate
 * flow, it isn't itself a security boundary.
 */
export function SignInForm(): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setFormError(null);

    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors;
      setFieldErrors({ email: errors.email?.[0], password: errors.password?.[0] });
      return; // rejected before any network call — AC-UX-01
    }
    setFieldErrors({});
    setSubmitting(true);

    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setSubmitting(false);
    if (error) {
      // Deliberately generic: this form never distinguishes "wrong password" from "no such
      // account" from "not on the allowlist" — that distinction is exactly what a credential-
      // guessing outsider would use to learn something.
      setFormError("Couldn't sign you in. Check your email and password and try again.");
    }
  }

  async function handleGoogle(): Promise<void> {
    setFormError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) setFormError("Couldn't start Google sign-in. Try again.");
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm"
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
          />
          {fieldErrors.email && (
            <p id="email-error" className="mt-1 text-sm text-destructive">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm"
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? "password-error" : undefined}
          />
          {fieldErrors.password && (
            <p id="password-error" className="mt-1 text-sm text-destructive">
              {fieldErrors.password}
            </p>
          )}
        </div>

        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="min-h-11 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        or
        <div className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        onClick={handleGoogle}
        className="min-h-11 w-full rounded-md border border-input bg-background px-4 py-2 text-sm font-medium"
      >
        Continue with Google
      </button>
    </div>
  );
}
