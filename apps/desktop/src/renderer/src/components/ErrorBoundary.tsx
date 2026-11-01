import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  readonly label: string;
  readonly children: ReactNode;
  /** Called by "Close" for surfaces that can simply go away (dialogs). */
  readonly onClose?: () => void;
}

/**
 * Keeps a render error in one surface (a dialog, Settings) from blanking the whole window. The
 * error goes to the console, which main's log file records.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[renderer] ${this.props.label} crashed:`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        data-testid="error-boundary"
        className="m-4 rounded-lg border border-danger/40 bg-bg p-4 text-sm"
      >
        <p className="font-medium text-danger">{this.props.label} hit an error.</p>
        <p className="mt-1 font-mono text-xs break-words text-fg-muted select-text">{error.message}</p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded border border-border px-2.5 py-1 text-xs hover:bg-bg-muted"
          >
            Try again
          </button>
          {this.props.onClose && (
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                this.props.onClose?.();
              }}
              className="rounded border border-border px-2.5 py-1 text-xs hover:bg-bg-muted"
            >
              Close
            </button>
          )}
        </div>
      </div>
    );
  }
}
