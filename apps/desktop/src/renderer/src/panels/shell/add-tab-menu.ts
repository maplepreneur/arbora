/** Options on the content pane's + menu, in display order. `separated` draws a rule above the row. */
export const ADD_TABS = [
  { id: 'file', label: 'File…', separated: false },
  { id: 'terminal', label: 'Terminal', separated: false },
  { id: 'browser', label: 'Browser', separated: false },
  { id: 'changes', label: 'Changes', separated: true },
  { id: 'problems', label: 'Problems', separated: false },
] as const;

export type AddTabId = (typeof ADD_TABS)[number]['id'];

export function isAddTabId(id: string): id is AddTabId {
  return ADD_TABS.some((item) => item.id === id);
}

interface Box {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

const GAP = 4;
const EDGE = 6;

/**
 * Puts the menu under the trigger, aligned to its right edge, and flips it above when the
 * window cannot hold it below. The result stays `EDGE` px inside the window.
 */
export function placeTabMenu(trigger: Box, menu: Size, viewport: Size): { top: number; left: number } {
  const below = trigger.bottom + GAP;
  const above = trigger.top - GAP - menu.height;
  let top = below;
  if (below + menu.height > viewport.height - EDGE) {
    top = above >= EDGE ? above : Math.max(EDGE, viewport.height - EDGE - menu.height);
  }
  const left = Math.min(Math.max(EDGE, trigger.right - menu.width), viewport.width - EDGE - menu.width);
  return { top, left };
}

/** How far the menu hangs below the tab strip, which is the padding that keeps it off the page. */
export function menuContentInset(stripBottom: number, menuBottom: number): number {
  return Math.max(0, menuBottom - stripBottom);
}
