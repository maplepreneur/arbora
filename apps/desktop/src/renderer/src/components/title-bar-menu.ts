import type { KeyboardEvent } from 'react';
import type { ContextMenuItem } from '@arbora/shared';

/**
 * The title-bar menus use the native popup. A DOM menu cannot paint over the browser panel's
 * `WebContentsView` (`contextMenu.show`). Arrow keys, Enter, Escape, and a click outside are the
 * menu's own.
 */
export async function openTitleBarMenu(items: readonly ContextMenuItem[]): Promise<string | null> {
  if (items.length === 0) return null;
  try {
    const { id } = await window.arbora.invoke('contextMenu.show', { items: [...items] });
    return id;
  } catch {
    return null;
  }
}

/** Arrow keys open the menu; Enter and Space already activate the button. */
export function menuTriggerKeyDown(open: () => void): (event: KeyboardEvent<HTMLButtonElement>) => void {
  return (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    open();
  };
}
