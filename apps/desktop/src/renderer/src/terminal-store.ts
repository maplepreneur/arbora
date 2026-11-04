import { create } from 'zustand';
import type { TerminalInfo, TerminalSize } from '@arbora/shared';
import { showRightView } from './store';

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
  /** The project `terminals` belongs to. A window that just switched project still holds the old list. */
  loadedFor: string | null;
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
  loadedFor: null,
  devStarting: false,
  focusRequest: 0,
};

export const useTerminals = create<TerminalState>()(() => ({ ...INITIAL }));

export function resetTerminals(): void {
  useTerminals.setState({ ...INITIAL, lastSize: useTerminals.getState().lastSize });
}

/** Every command an agent runs shares this one tab, listed beside the selected output. */
export const AGENT_TAB_ID = 'agent-commands';

/**
 * Reconciles tabs with main's terminal list: panes whose terminal is gone are dropped (and empty
 * tabs with them), terminals not shown anywhere yet (the dev server) get a tab, and agent
 * terminals are collected in the agent tab, oldest first.
 */
export function reconcileTabs(
  state: Pick<TerminalState, 'tabs' | 'activeTabId' | 'activePaneId'>,
  terminals: readonly TerminalInfo[],
): Pick<TerminalState, 'tabs' | 'activeTabId' | 'activePaneId'> {
  const ids = new Set(terminals.filter((t) => !t.readOnly).map((t) => t.id));
  const agentIds = terminals.filter((t) => t.readOnly).map((t) => t.id);
  const tabs: TerminalTab[] = [];
  for (const tab of state.tabs) {
    if (tab.id === AGENT_TAB_ID) continue;
    const panes = tab.panes.filter((id) => ids.has(id));
    if (panes.length > 0) tabs.push({ ...tab, panes });
  }
  if (agentIds.length > 0) tabs.push({ id: AGENT_TAB_ID, panes: agentIds, direction: 'horizontal' });
  const shown = new Set(tabs.flatMap((t) => t.panes));
  let activeTabId = tabs.some((t) => t.id === state.activeTabId) ? state.activeTabId : null;
  for (const terminal of terminals) {
    if (shown.has(terminal.id)) continue;
    tabs.splice(tabs.length - (agentIds.length > 0 ? 1 : 0), 0, {
      id: terminal.id,
      panes: [terminal.id],
      direction: 'horizontal',
    });
    activeTabId ??= terminal.id;
  }
  activeTabId ??= tabs[0]?.id ?? null;
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activePaneId =
    activeTab && state.activePaneId && activeTab.panes.includes(state.activePaneId)
      ? state.activePaneId
      : ((activeTab?.id === AGENT_TAB_ID ? activeTab.panes.at(-1) : activeTab?.panes[0]) ?? null);
  return { tabs, activeTabId, activePaneId };
}

/** A terminal main created that has not reached this store yet; it activates when the list has it. */
let pendingReveal: string | null = null;

export function applyTerminalList(terminals: TerminalInfo[], projectPath: string | null): void {
  useTerminals.setState((s) => ({ terminals, loaded: true, loadedFor: projectPath, ...reconcileTabs(s, terminals) }));
  if (pendingReveal && terminals.some((t) => t.id === pendingReveal)) {
    const id = pendingReveal;
    pendingReveal = null;
    activateTerminal(id);
  }
}

/** Shows terminal `id` as the right column's tab and focuses it. */
export function revealTerminal(id: string, info?: TerminalInfo): void {
  useTerminals.setState((s) => {
    if (s.tabs.some((t) => t.panes.includes(id))) return {};
    if (!info) return {};
    return {
      terminals: s.terminals.some((t) => t.id === id) ? s.terminals : [...s.terminals, info],
      ...placeTerminal(s, id, null),
    };
  });
  if (useTerminals.getState().tabs.some((t) => t.panes.includes(id))) activateTerminal(id);
  else pendingReveal = id;
  showRightView('terminal');
  focusActiveTerminal();
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
  const host = target && target.tabId !== AGENT_TAB_ID ? tabs.find((t) => t.id === target.tabId) : undefined;
  if (target && host) {
    const next = tabs.map((t) => (t === host ? { ...t, panes: [...t.panes, id], direction: target.split } : t));
    return { tabs: next, activeTabId: host.id, activePaneId: id };
  }
  const tab: TerminalTab = { id, panes: [id], direction: 'horizontal' };
  const agentAt = tabs.findIndex((t) => t.id === AGENT_TAB_ID);
  const next = agentAt === -1 ? [...tabs, tab] : [...tabs.slice(0, agentAt), tab, ...tabs.slice(agentAt)];
  return { tabs: next, activeTabId: id, activePaneId: id };
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

/** Closes the agent commands that have finished; running ones stay. */
export function clearFinishedAgentTerminals(): void {
  for (const terminal of useTerminals.getState().terminals) {
    if (terminal.readOnly && terminal.exitCode !== null)
      void window.arbora.invoke('terminal.close', { id: terminal.id });
  }
}

export function activePane(): TerminalInfo | undefined {
  const { terminals, activePaneId } = useTerminals.getState();
  return terminals.find((t) => t.id === activePaneId);
}
