import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A modal over the whole window: traps Tab, closes on Escape and on a backdrop click, and gives
 * focus back to what had it. The browser view is hidden while the store's `overlay` is set.
 */
export function Dialog({
  label,
  testId,
  onClose,
  width = 560,
  children,
}: {
  label: string;
  testId: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first =
      ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-testid={testId}
        tabIndex={-1}
        style={{ width: `min(${width}px, 100%)` }}
        className="flex max-h-full flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-2xl outline-none"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== 'Tab' || !ref.current) return;
          const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
            (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
          );
          const firstItem = items[0];
          const lastItem = items[items.length - 1];
          if (!firstItem || !lastItem) return;
          if (event.shiftKey && document.activeElement === firstItem) {
            event.preventDefault();
            lastItem.focus();
          } else if (!event.shiftKey && document.activeElement === lastItem) {
            event.preventDefault();
            firstItem.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
