import { create } from 'zustand';
import type { TerminalInfo, TerminalSize } from '@arbora/shared';

export type SplitDirection = 'horizontal' | 'vertical';

/** A tab holds one terminal or a split of several, side by side (`horizontal`) or stacked. */
export interface TerminalTab {
  readonly id: string;
  readonly panes: readonly string[];
  readonly direction: SplitDirection;
}

export interface TerminalState {
  terminals: TerminalInfo[];
  tabs: TerminalTab[];
  activeTabId: string | null;
  /** The pane that receives commands (clear, find, kill) and keyboard focus. */
  activePaneId: string | null;
  renamingId: string | null;
  searchOpen: boolean;
  /** Last fitted size, used for terminals created before their pane is laid out. */
  lastSize: TerminalSize;
  /** Main's list has been fetched for this project (so an empty list really means no terminals). */
  loaded: boolean;
  /** "Run Dev Server" is creating the dev terminal; the panel should not open a default shell. */
  devStarting: boolean;
  /** Bumped to move keyboard focus to the active pane, once it is mounted. */
  focusRequest: number;
}

const INITIAL: TerminalState = {
  terminals: [],
  tabs: [],
  activeTabId: null,
  activePaneId: null,
  renamingId: null,
  searchOpen: false,
  lastSize: { cols: 100, rows: 24 },
  loaded: false,
  devStarting: false,
  focusRequest: 0,
};

export const useTerminals = create<TerminalState>()(() => ({ ...INITIAL }));

export function resetTerminals(): void {
  useTerminals.setState({ ...INITIAL, lastSize: useTerminals.getState().lastSize });
}

/**
 * Reconciles tabs with main's terminal list: panes whose terminal is gone are dropped (and empty
 * tabs with them), and terminals not shown anywhere yet (the dev server, agent terminals) get a tab.
 */
export function reconcileTabs(
  state: Pick<TerminalState, 'tabs' | 'activeTabId' | 'activePaneId'>,
  terminals: readonly TerminalInfo[],
): Pick<TerminalState, 'tabs' | 'activeTabId' | 'activePaneId'> {
  const ids = new Set(terminals.map((t) => t.id));
  const tabs: TerminalTab[] = [];
  for (const tab of state.tabs) {
    const panes = tab.panes.filter((id) => ids.has(id));
    if (panes.length > 0) tabs.push({ ...tab, panes });
  }
  const shown = new Set(tabs.flatMap((t) => t.panes));
  let activeTabId = tabs.some((t) => t.id === state.activeTabId) ? state.activeTabId : null;
  for (const terminal of terminals) {
    if (shown.has(terminal.id)) continue;
    tabs.push({ id: terminal.id, panes: [terminal.id], direction: 'horizontal' });
    activeTabId ??= terminal.id;
  }
  activeTabId ??= tabs[0]?.id ?? null;
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activePaneId =
    activeTab && state.activePaneId && activeTab.panes.includes(state.activePaneId)
      ? state.activePaneId
      : (activeTab?.panes[0] ?? null);
  return { tabs, activeTabId, activePaneId };
}

export function applyTerminalList(terminals: TerminalInfo[]): void {
  useTerminals.setState((s) => ({ terminals, loaded: true, ...reconcileTabs(s, terminals) }));
}

/** Moves terminal `id` into `target` (a split of the active tab) or its own tab, and activates it. */
export function placeTerminal(
  state: Pick<TerminalState, 'tabs'>,
  id: string,
  target: { split: SplitDirection; tabId: string } | null,
): Pick<TerminalState, 'tabs' | 'activeTabId' | 'activePaneId'> {
  const tabs = state.tabs
    .map((t) => ({ ...t, panes: t.panes.filter((p) => p !== id) }))
    .filter((t) => t.panes.length > 0);
  const host = target ? tabs.find((t) => t.id === target.tabId) : undefined;
  if (target && host) {
    const next = tabs.map((t) => (t === host ? { ...t, panes: [...t.panes, id], direction: target.split } : t));
    return { tabs: next, activeTabId: host.id, activePaneId: id };
  }
  return { tabs: [...tabs, { id, panes: [id], direction: 'horizontal' }], activeTabId: id, activePaneId: id };
}

export function activateTerminal(id: string): void {
  useTerminals.setState((s) => {
    const tab = s.tabs.find((t) => t.panes.includes(id));
    return tab ? { activeTabId: tab.id, activePaneId: id } : {};
  });
}

export function focusActiveTerminal(): void {
  useTerminals.setState((s) => ({ focusRequest: s.focusRequest + 1 }));
}

export async function createTerminal(split?: SplitDirection): Promise<TerminalInfo> {
  const { lastSize, activeTabId } = useTerminals.getState();
  const info = await window.arbora.invoke('terminal.create', { ...lastSize });
  useTerminals.setState((s) => ({
    terminals: s.terminals.some((t) => t.id === info.id) ? s.terminals : [...s.terminals, info],
    ...placeTerminal(s, info.id, split && activeTabId ? { split, tabId: activeTabId } : null),
  }));
  return info;
}

export function activePane(): TerminalInfo | undefined {
  const { terminals, activePaneId } = useTerminals.getState();
  return terminals.find((t) => t.id === activePaneId);
}
