import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { placeTooltip } from '../tooltip-place';
import { splitTooltip } from '../tooltip-text';

const SHOW_DELAY_MS = 350;

interface Tip {
  readonly text: string;
  readonly anchor: DOMRect;
}

/**
 * Replaces the small, slow native `title` tooltips everywhere in the app chrome with one larger,
 * high-contrast tooltip. While an element is hovered its `title` moves into the tooltip (so the
 * native one does not show too) and is put back when the pointer leaves, so the attribute stays
 * the source of truth for components, tests and accessibility.
 */
export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let target: HTMLElement | null = null;
    let text = '';
    let timer: ReturnType<typeof setTimeout> | undefined;

    const release = (): void => {
      clearTimeout(timer);
      // React may have written a newer title while it was hovered; that one wins.
      if (target && text && !target.hasAttribute('title')) target.setAttribute('title', text);
      target = null;
      text = '';
      setTip(null);
    };

    const over = (event: PointerEvent): void => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[title]') : null;
      if (!element || element === target) return;
      release();
      const title = element.getAttribute('title') ?? '';
      if (!title.trim()) return;
      target = element;
      text = title;
      element.removeAttribute('title');
      if (!element.hasAttribute('aria-label') && !element.textContent.trim()) {
        element.setAttribute('aria-label', title);
      }
      timer = setTimeout(() => {
        if (target === element && element.isConnected) setTip({ text: title, anchor: element.getBoundingClientRect() });
      }, SHOW_DELAY_MS);
    };

    const out = (event: PointerEvent): void => {
      if (!target) return;
      const next = event.relatedTarget;
      if (next instanceof Node && target.contains(next)) return;
      release();
    };

    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('pointerdown', release, true);
    document.addEventListener('keydown', release, true);
    document.addEventListener('scroll', release, true);
    window.addEventListener('blur', release);
    return () => {
      release();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('pointerdown', release, true);
      document.removeEventListener('keydown', release, true);
      document.removeEventListener('scroll', release, true);
      window.removeEventListener('blur', release);
    };
  }, []);

  return tip ? <TooltipBubble tip={tip} /> : null;
}

/** The browser page's box. It is a native view drawn above the DOM, so a tooltip over it is hidden. */
function pageRect(): DOMRect | null {
  return document.querySelector('[data-testid="browser-viewport"]')?.getBoundingClientRect() ?? null;
}

function TooltipBubble({ tip }: { tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const { label, shortcut } = splitTooltip(tip.text);

  useLayoutEffect(() => {
    const bubble = ref.current;
    if (!bubble) return;
    const { width, height } = bubble.getBoundingClientRect();
    setPosition(
      placeTooltip(tip.anchor, width, height, pageRect(), { width: window.innerWidth, height: window.innerHeight }),
    );
  }, [tip]);

  return (
    <div
      ref={ref}
      role="tooltip"
      data-testid="tooltip"
      style={position ? { left: position.left, top: position.top } : { left: -9999, top: -9999 }}
      className="pointer-events-none fixed z-[60] flex max-w-xs items-center gap-2 rounded-md border border-border bg-fg px-2.5 py-1.5 text-[12px] leading-snug font-medium text-bg shadow-lg"
    >
      <span className="break-words whitespace-pre-line">{label}</span>
      {shortcut && (
        <kbd className="shrink-0 rounded bg-bg/15 px-1.5 py-px font-mono text-[11px] text-bg/80">{shortcut}</kbd>
      )}
    </div>
  );
}
