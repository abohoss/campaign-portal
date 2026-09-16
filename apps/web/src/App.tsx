/**
 * Placeholder root. Auth (Phase 4), routing and the real feature views (Phases 4-9) replace this.
 * Phase 2's job is only to prove the toolchain — React, Tailwind, TanStack Query, the domain
 * package — is wired end to end.
 */
export function App(): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">Campaign Portal</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Scaffold complete. Auth and the brand views land in later phases — see
          docs/IMPLEMENTATION_PLAN.md.
        </p>
      </div>
    </main>
  );
}
