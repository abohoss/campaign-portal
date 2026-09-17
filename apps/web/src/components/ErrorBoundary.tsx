import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** AC-UX-07: a thrown render error must show an explicit message, never a blank white screen.
 *  Class component because React only supports error boundaries via getDerivedStateFromError —
 *  there is no hook equivalent. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background p-4 text-center text-foreground">
          <p role="alert" className="text-sm text-destructive">
            Something went wrong: {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={() => location.reload()}
            className="min-h-11 rounded-md border border-input px-4 py-2 text-sm font-medium"
          >
            Reload
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
