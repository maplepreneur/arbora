import { useApp } from '../store';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const warnings = useApp((s) => s.project?.settingsWarnings);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2" aria-live="polite">
      {warnings?.map((warning) => (
        <div
          key={warning}
          className="max-w-sm rounded-md border border-danger bg-bg-elevated px-3 py-2 text-xs shadow-lg"
        >
          {warning}
        </div>
      ))}
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="toast"
          className="max-w-sm rounded-md border border-border bg-bg-elevated px-3 py-2 text-xs shadow-lg"
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
