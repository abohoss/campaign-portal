import { supabase } from "@/lib/supabase.js";

/** AC-AUTH-06: a user who exists in auth.users but has no membership row sees this, explicitly —
 *  never a blank page, a crash, or (worse) another brand's data. */
export function NoAccessScreen(): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold">No access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account isn't linked to a brand on Velocity Growth's campaign portal. If you think
          this is a mistake, contact your Velocity Growth admin.
        </p>
        <button
          type="button"
          onClick={() => void supabase.auth.signOut()}
          className="mt-6 min-h-11 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
