import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Atlas Scholar crashed:", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg px-8 text-center">
        <p className="text-sm font-medium text-text">Something went wrong</p>
        <p className="max-w-md break-words text-xs text-text-weak">{error.message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded border border-border px-3 py-1.5 text-xs text-text hover:bg-panel"
        >
          Reload Atlas Scholar
        </button>
      </div>
    );
  }
}
