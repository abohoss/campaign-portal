import { SignInForm } from "./SignInForm.js";

export function SignInPage(): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold">Campaign Portal</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your brand's workspace.</p>
        </div>
        <SignInForm />
      </div>
    </main>
  );
}
