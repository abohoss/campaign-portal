import { AuthGate } from "./features/auth/AuthGate.js";
import { ImportPage } from "./features/import/ImportPage.js";
import { supabase } from "./lib/supabase.js";

/**
 * Contacts/campaigns/dashboard (Phase 6), the send flow (Phase 7) and the share link (Phase 9)
 * add real navigation between views — for now the authenticated shell goes straight to Import,
 * the one feature built so far beyond auth itself.
 */
export function App(): JSX.Element {
  return (
    <AuthGate>
      {(membership) => (
        <div className="min-h-screen bg-background text-foreground">
          <header className="flex items-center justify-between border-b border-border p-4">
            <div>
              <h1 className="text-lg font-semibold">{membership.brandName}</h1>
              <p className="text-xs text-muted-foreground">Signed in as {membership.role}</p>
            </div>
            <button
              type="button"
              onClick={() => void supabase.auth.signOut()}
              className="min-h-11 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium"
            >
              Sign out
            </button>
          </header>
          <ImportPage membership={membership} />
        </div>
      )}
    </AuthGate>
  );
}
