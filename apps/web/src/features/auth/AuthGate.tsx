import type { ReactNode } from "react";
import { useSession } from "./useSession.js";
import { useMembership, type Membership } from "./useMembership.js";
import { SignInPage } from "./SignInPage.js";
import { NoAccessScreen } from "./NoAccessScreen.js";

/**
 * The one route guard the whole app goes through. Order matters:
 *   1. session loading -> explicit loading state (AC-UX-04)
 *   2. no session -> sign-in page
 *   3. membership loading -> explicit loading state
 *   4. membership query failed -> explicit error state (AC-UX-06), not a crash
 *   5. zero memberships -> NoAccessScreen (AC-AUTH-06), not a blank page or another brand's data
 *   6. else -> render children with the membership
 *
 * Inline loading/error markup for now — apps/web/src/components/{LoadingState,ErrorState}.tsx
 * (Phase 10) extracts and audits this pattern across every screen, not just this one.
 */
export function AuthGate({
  children,
}: {
  children: (membership: Membership) => ReactNode;
}): JSX.Element {
  const { session, loading: sessionLoading } = useSession();

  if (sessionLoading) {
    return <CenteredMessage>Loading…</CenteredMessage>;
  }
  if (!session) {
    return <SignInPage />;
  }

  return <RequireMembership session={session}>{children}</RequireMembership>;
}

function RequireMembership({
  session,
  children,
}: {
  session: NonNullable<ReturnType<typeof useSession>["session"]>;
  children: (membership: Membership) => ReactNode;
}): JSX.Element {
  const { data: memberships, isLoading, isError, error } = useMembership(session);

  if (isLoading) {
    return <CenteredMessage>Loading your workspace…</CenteredMessage>;
  }
  if (isError) {
    return (
      <CenteredMessage>
        Couldn't load your account. {error instanceof Error ? error.message : "Please retry."}
      </CenteredMessage>
    );
  }
  if (!memberships || memberships.length === 0) {
    return <NoAccessScreen />;
  }

  // A person has exactly one brand in this build (docs/MANUAL_SETUP.md). If that ever changes,
  // this is the one place a brand switcher would plug in — not a silent pick of index 0 elsewhere.
  return <>{children(memberships[0]!)}</>;
}

function CenteredMessage({ children }: { children: ReactNode }): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <p className="text-sm text-muted-foreground">{children}</p>
    </main>
  );
}
