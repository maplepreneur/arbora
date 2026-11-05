import { CommandId, type CommandId as Id } from '@arbora/shared';

/** Options on the content pane's + menu, in display order. `separated` draws a rule above the row. */
export const ADD_TABS = [
  { id: 'file', label: 'File…', separated: false, command: CommandId.quickOpen },
  { id: 'terminal', label: 'Terminal', separated: false, command: CommandId.showTerminal },
  { id: 'browser', label: 'Browser', separated: false, command: CommandId.showBrowser },
  { id: 'changes', label: 'Changes', separated: true, command: CommandId.showGitPanel },
  { id: 'problems', label: 'Problems', separated: false, command: CommandId.showProblems },
] as const;

export type AddTabId = (typeof ADD_TABS)[number]['id'];

export function isAddTabId(id: string): id is AddTabId {
  return ADD_TABS.some((item) => item.id === id);
}

/** The command a row runs. The menu prints that command's chord. */
export function addTabCommand(id: AddTabId): Id {
  switch (id) {
    case 'file':
      return CommandId.quickOpen;
    case 'terminal':
      return CommandId.showTerminal;
    case 'browser':
      return CommandId.showBrowser;
    case 'changes':
      return CommandId.showGitPanel;
    case 'problems':
      return CommandId.showProblems;
    default: {
      const unreachable: never = id;
      return unreachable;
    }
  }
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
