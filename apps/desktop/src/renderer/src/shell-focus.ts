import { useEffect, useSyncExternalStore } from 'react';
import { isShellFocusPane, shellFocusPane, type ShellFocusPane } from '@arbora/shared';
import { useApp } from './store';

let pageFocused = false;
const pageListeners = new Set<() => void>();

let shellPane: ShellFocusPane | null = null;
const paneListeners = new Set<() => void>();

export function browserPageFocused(): boolean {
  return pageFocused;
}

export function setBrowserPageFocused(focused: boolean): void {
  if (pageFocused === focused) return;
  pageFocused = focused;
  for (const listener of pageListeners) listener();
}

export function subscribeBrowserPageFocus(listener: () => void): () => void {
  pageListeners.add(listener);
  return () => pageListeners.delete(listener);
}

function publishShellPane(next: ShellFocusPane | null): void {
  if (next === shellPane) return;
  shellPane = next;
  for (const listener of paneListeners) listener();
}

function subscribeShellPane(listener: () => void): () => void {
  paneListeners.add(listener);
  return () => paneListeners.delete(listener);
}

/** `data-landmark` of the focused element, when it sits in a shell pane. */
export function focusedShellLandmark(target: EventTarget | null): string | null {
  const element =
    target instanceof Element ? target : document.activeElement instanceof Element ? document.activeElement : null;
  return element?.closest('[data-landmark]')?.getAttribute('data-landmark') ?? null;
}

/** The shell pane that should draw the keyboard-focus border. */
export function useShellFocusPane(): ShellFocusPane | null {
  return useSyncExternalStore(
    subscribeShellPane,
    () => shellPane,
    () => null,
  );
}

const POINTER_KEEPS_FOCUS = 'input, textarea, select, button, a, [contenteditable="true"], .xterm, .cm-editor';

/**
 * Tracks which shell pane has the keyboard and, when a click lands on plain pane chrome
 * (the browser error state, an empty area), moves focus into that pane.
 */
export function useTrackShellFocus(): void {
  const terminalFocused = useApp((s) => s.terminalFocused);
  const livePage = useSyncExternalStore(subscribeBrowserPageFocus, browserPageFocused, () => false);
  useEffect(() => {
    const publish = (): void => {
      publishShellPane(
        shellFocusPane({
          landmark: focusedShellLandmark(document.activeElement),
          terminalFocused: useApp.getState().terminalFocused,
          pageFocused: browserPageFocused(),
          documentFocused: document.hasFocus(),
        }),
      );
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(POINTER_KEEPS_FOCUS)) return;
      const landmark = target.closest<HTMLElement>('[data-landmark]');
      if (!landmark || !isShellFocusPane(landmark.dataset['landmark'])) return;
      if (landmark.contains(document.activeElement)) return;
      const before = document.activeElement;
      requestAnimationFrame(() => {
        if (!landmark.isConnected || document.activeElement !== before) return;
        if (!landmark.hasAttribute('tabindex')) landmark.tabIndex = -1;
        landmark.focus({ preventScroll: true });
      });
    };
    publish();
    document.addEventListener('focusin', publish);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('focus', publish);
    window.addEventListener('blur', publish);
    return () => {
      document.removeEventListener('focusin', publish);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('focus', publish);
      window.removeEventListener('blur', publish);
    };
  }, [terminalFocused, livePage]);
}
