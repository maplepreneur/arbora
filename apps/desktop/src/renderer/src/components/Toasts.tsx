import { useAppState } from '../context';

export function Toasts() {
  const toasts = useAppState((state) => state.toasts);
  if (toasts.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="toast"
          className={`max-w-sm rounded-md border bg-surface px-3 py-2 shadow-lg ${
            toast.tone === 'error' ? 'border-danger text-danger' : 'border-border'
          }`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
