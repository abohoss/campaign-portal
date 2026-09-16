import { AuthGate } from "./features/auth/AuthGate.js";
import { supabase } from "./lib/supabase.js";

/**
 * Placeholder authenticated shell. Contacts/campaigns/dashboard views (Phase 6), the send flow
 * (Phase 7) and the share link (Phase 9) replace this — Phase 4's job is only auth: six logins,
 * two methods, each landing in their own portal, analyst vs owner distinguishable.
 */
export function App(): JSX.Element {
  return (
    <AuthGate>
      {(membership) => (
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-4 text-foreground">
          <div className="text-center">
            <h1 className="text-2xl font-semibold">{membership.brandName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Signed in as <span className="font-medium">{membership.role}</span>
            </p>
          </div>
          <p className="max-w-md text-center text-sm text-muted-foreground">
            Contacts, campaigns and the dashboard land in later phases — see
            docs/IMPLEMENTATION_PLAN.md.
          </p>
          <button
            type="button"
            onClick={() => void supabase.auth.signOut()}
            className="min-h-11 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium"
          >
            Sign out
          </button>
        </main>
      )}
    </AuthGate>
  );
}
