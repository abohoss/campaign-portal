import { SignInForm } from "./SignInForm.js";

export function SignInPage(): JSX.Element {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4 text-foreground">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-primary" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">Velocity Growth</p>
          <h1 className="text-3xl font-semibold tracking-tight">Campaign Portal</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to your brand's workspace.</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-[0_18px_50px_hsl(177_55%_24%/0.10)] sm:p-6">
          <SignInForm />
        </div>
      </div>
    </main>
  );
}
