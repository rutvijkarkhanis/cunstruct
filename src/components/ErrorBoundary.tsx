import { Component, ReactNode } from "react";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] Caught render error", { error, info });
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="min-h-screen flex items-center justify-center bg-background p-6">
            <div className="max-w-md text-center space-y-3">
              <h1 className="text-lg font-bold text-foreground">Something went wrong</h1>
              <p className="text-sm text-muted-foreground break-words">
                {this.state.error.message}
              </p>
              <button
                onClick={() => {
                  this.setState({ error: null });
                  window.location.reload();
                }}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
              >
                Reload
              </button>
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;