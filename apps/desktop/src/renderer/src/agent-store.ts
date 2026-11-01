import { create } from 'zustand';
import { newGroupId } from '@arbora/shared';
import type {
  AcpLogEntry,
  AgentAvailability,
  AgentDefinition,
  AgentGroup,
  Attachment,
  ContentBlock,
  ThreadChange,
  ThreadEvent,
  ThreadState,
  ThreadSummary,
} from '@arbora/shared';

export type AgentView = 'threads' | 'picker' | 'thread';

export interface AgentPanelState {
  agents: AgentDefinition[];
  availability: AgentAvailability[];
  threads: ThreadSummary[];
  /** The project's agent groups, in display order. */
  groups: AgentGroup[];
  activeThreadId: string | null;
  view: AgentView;
  /** Transcripts by thread id; present once `agent.getThread` returned. */
  events: Record<string, ThreadEvent[]>;
  logs: Record<string, AcpLogEntry[]>;
  logOpen: boolean;
  /** Composer text per thread, kept while switching threads. */
  drafts: Record<string, string>;
  attachments: Record<string, Attachment[]>;
  /** Bumped to move focus to the composer. */
  composerFocusRequest: number;
  /** Bumped to focus the new-thread picker with the default agent highlighted. */
  pickerFocusRequest: number;
  /** The new-group name field: `''` for an empty group, or the thread to move into it. */
  newGroupFor: string | null;
  /** Bumped by Alt+P / Alt+M to open the open thread's model or mode menu. */
  modelMenuRequest: number;
  modeMenuRequest: number;
  /** Files written by agents this session (Stage 8 turns these into the "Agent changes" group). */
  changedFiles: { threadId: string; path: string; at: number }[];
  loaded: boolean;
}

const INITIAL: AgentPanelState = {
  agents: [],
  availability: [],
  threads: [],
  groups: [],
  activeThreadId: null,
  view: 'threads',
  events: {},
  logs: {},
  logOpen: false,
  drafts: {},
  attachments: {},
  composerFocusRequest: 0,
  pickerFocusRequest: 0,
  newGroupFor: null,
  modelMenuRequest: 0,
  modeMenuRequest: 0,
  changedFiles: [],
  loaded: false,
};

export const MAX_LOG_ENTRIES = 2000;

export const useAgents = create<AgentPanelState>()(() => ({ ...INITIAL }));

export function resetAgents(): void {
  useAgents.setState({ ...INITIAL });
}

/** Applies ordered transcript changes to a transcript. Unknown `replace` indexes append instead. */
export function applyChanges(events: readonly ThreadEvent[], changes: readonly ThreadChange[]): ThreadEvent[] {
  let next = [...events];
  for (const change of changes) {
    switch (change.type) {
      case 'append':
        next.push(change.event);
        break;
      case 'replace':
        if (change.index < next.length) next[change.index] = change.event;
        else next.push(change.event);
        break;
      case 'reset':
        next = [...change.events];
        break;
      default: {
        const unreachable: never = change;
        throw new Error(`Unhandled thread change ${String(unreachable)}`);
      }
    }
  }
  return next;
}

export function applyThreadChanges(threadId: string, changes: readonly ThreadChange[]): void {
  useAgents.setState((s) => {
    const current = s.events[threadId];
    // Before the transcript is fetched, changes would be applied to a partial list; skip them. The
    // fetch returns the complete transcript including these changes.
    if (!current) return {};
    return { events: { ...s.events, [threadId]: applyChanges(current, changes) } };
  });
}

export function applyThreadState(threadId: string, state: ThreadState): void {
  useAgents.setState((s) => ({ threads: s.threads.map((t) => (t.id === threadId ? { ...t, state } : t)) }));
}

export function applyThreadList(threads: ThreadSummary[]): void {
  useAgents.setState((s) => {
    const activeThreadId = threads.some((t) => t.id === s.activeThreadId) ? s.activeThreadId : null;
    const known = new Set(threads.map((t) => t.id));
    const events = Object.fromEntries(Object.entries(s.events).filter(([id]) => known.has(id)));
    return {
      threads,
      activeThreadId,
      events,
      view: activeThreadId === null && s.view === 'thread' ? 'threads' : s.view,
      loaded: true,
    };
  });
}

export function appendLog(threadId: string, entry: AcpLogEntry): void {
  useAgents.setState((s) => {
    const current = s.logs[threadId] ?? [];
    const next = [...current, entry];
    return { logs: { ...s.logs, [threadId]: next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next } };
  });
}

export function noteFileChanged(threadId: string, path: string): void {
  useAgents.setState((s) => ({ changedFiles: [...s.changedFiles, { threadId, path, at: Date.now() }].slice(-500) }));
}

export async function loadAgentSnapshot(): Promise<void> {
  const { arbora } = window;
  const [agents, threads, groups] = await Promise.all([
    arbora.invoke('agent.listAgents'),
    arbora.invoke('agent.listThreads'),
    arbora.invoke('agent.listGroups'),
  ]);
  useAgents.setState({ agents: agents.agents, availability: agents.availability, groups, loaded: true });
  applyThreadList(threads);
}

export async function openThread(threadId: string): Promise<void> {
  useAgents.setState({ activeThreadId: threadId, view: 'thread' });
  const [thread, log] = await Promise.all([
    window.arbora.invoke('agent.getThread', { threadId }),
    window.arbora.invoke('agent.getLog', { threadId }),
  ]);
  if (!thread) return;
  useAgents.setState((s) => ({
    events: { ...s.events, [threadId]: thread.events },
    logs: { ...s.logs, [threadId]: log },
    threads: s.threads.some((t) => t.id === threadId)
      ? s.threads.map((t) => (t.id === threadId ? { ...t, state: thread.state } : t))
      : [{ ...thread }, ...s.threads],
  }));
}

/** `model` overrides the agent's default model for this thread; `groupId` files it in a group. */
export async function createThread(agentId: string, model?: string, groupId?: string | null): Promise<void> {
  const summary = await window.arbora.invoke('agent.createThread', {
    agentId,
    ...(model ? { model } : {}),
    ...(groupId ? { groupId } : {}),
  });
  useAgents.setState((s) => ({
    threads: s.threads.some((t) => t.id === summary.id) ? s.threads : [summary, ...s.threads],
    events: { ...s.events, [summary.id]: [] },
    logs: { ...s.logs, [summary.id]: [] },
  }));
  await openThread(summary.id);
  focusComposer();
}

export function showThreads(): void {
  useAgents.setState({ view: 'threads' });
}

export function requestNewGroup(): void {
  useAgents.setState({ view: 'threads', newGroupFor: '' });
}

export function showPicker(): void {
  useAgents.setState((s) => ({ view: 'picker', pickerFocusRequest: s.pickerFocusRequest + 1 }));
}

export function focusComposer(): void {
  useAgents.setState((s) => ({ composerFocusRequest: s.composerFocusRequest + 1 }));
}

export function toggleLog(): void {
  useAgents.setState((s) => ({ logOpen: !s.logOpen }));
}

export function setDraft(threadId: string, text: string): void {
  useAgents.setState((s) => ({ drafts: { ...s.drafts, [threadId]: text } }));
}

export function addAttachments(threadId: string, attachments: readonly Attachment[]): void {
  useAgents.setState((s) => {
    const current = s.attachments[threadId] ?? [];
    const paths = new Set(current.map((a) => a.path));
    return {
      attachments: { ...s.attachments, [threadId]: [...current, ...attachments.filter((a) => !paths.has(a.path))] },
    };
  });
}

export function removeAttachment(threadId: string, path: string): void {
  useAgents.setState((s) => ({
    attachments: { ...s.attachments, [threadId]: (s.attachments[threadId] ?? []).filter((a) => a.path !== path) },
  }));
}

export function activeThread(): ThreadSummary | undefined {
  const { threads, activeThreadId } = useAgents.getState();
  return threads.find((t) => t.id === activeThreadId);
}

/** Sends the composer's text and attachments; the turn's progress arrives through events. */
export async function sendPrompt(threadId: string): Promise<{ error?: string }> {
  const state = useAgents.getState();
  const text = (state.drafts[threadId] ?? '').trim();
  const attachments = state.attachments[threadId] ?? [];
  if (!text && attachments.length === 0) return {};
  const blocks: ContentBlock[] = text ? [{ type: 'text', text }] : [];
  useAgents.setState((s) => ({
    drafts: { ...s.drafts, [threadId]: '' },
    attachments: { ...s.attachments, [threadId]: [] },
  }));
  try {
    const result = await window.arbora.invoke('agent.prompt', { threadId, blocks, attachments });
    return result.error ? { error: result.error } : {};
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function cancelTurn(threadId: string): Promise<void> {
  await window.arbora.invoke('agent.cancel', { threadId });
}

/** Stops the agent's work whatever it is doing (turn, start-up, login wait). */
export async function stopAgent(threadId: string): Promise<void> {
  await window.arbora.invoke('agent.stop', { threadId });
}

/** Whether Stop has something to stop. */
export function isStoppable(status: ThreadSummary['state']['status']): boolean {
  return status === 'prompting' || status === 'starting';
}

/**
 * Where agent mode (`Mod+K`) sends by default: the thread open in the agent panel, else a new
 * thread with the default agent (or the first detected agent, or the first listed one).
 */
export function defaultAgentModeTarget(
  state: Pick<AgentPanelState, 'view' | 'activeThreadId' | 'threads' | 'agents' | 'availability'>,
  defaultAgentId: string | undefined,
): string | null {
  const open = state.view === 'thread' ? state.threads.find((t) => t.id === state.activeThreadId) : undefined;
  if (open) return `thread:${open.id}`;
  const detected = new Set(state.availability.filter((a) => a.available).map((a) => a.id));
  const agent =
    state.agents.find((a) => a.id === defaultAgentId) ??
    state.agents.find((a) => detected.has(a.id)) ??
    state.agents[0];
  return agent ? `new:${agent.id}` : null;
}

export async function deleteThread(threadId: string): Promise<void> {
  await window.arbora.invoke('agent.deleteThread', { threadId });
  useAgents.setState((s) => ({
    threads: s.threads.filter((t) => t.id !== threadId),
    activeThreadId: s.activeThreadId === threadId ? null : s.activeThreadId,
    view: s.activeThreadId === threadId ? 'threads' : s.view,
  }));
}

// --- Agent groups ------------------------------------------------------------------------------

export function applyGroups(groups: AgentGroup[]): void {
  useAgents.setState({ groups });
}

export async function saveGroups(groups: AgentGroup[]): Promise<void> {
  useAgents.setState({ groups });
  applyGroups(await window.arbora.invoke('agent.saveGroups', { groups }));
}

const GROUP_COLOR_CYCLE: readonly AgentGroup['color'][] = ['blue', 'purple', 'green', 'orange', 'pink', 'yellow'];

export async function createGroup(name: string, threadIds: readonly string[] = []): Promise<string> {
  const { groups } = useAgents.getState();
  const id = newGroupId(name, groups);
  const color = GROUP_COLOR_CYCLE[groups.length % GROUP_COLOR_CYCLE.length] ?? 'gray';
  await saveGroups([...groups, { id, name: name.trim(), color, collapsed: false }]);
  for (const threadId of threadIds) await setThreadGroup(threadId, id);
  return id;
}

export async function updateGroup(id: string, patch: Partial<Omit<AgentGroup, 'id'>>): Promise<void> {
  await saveGroups(useAgents.getState().groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
}

export async function deleteGroup(id: string): Promise<void> {
  await saveGroups(useAgents.getState().groups.filter((g) => g.id !== id));
}

export async function moveGroup(id: string, delta: -1 | 1): Promise<void> {
  const groups = [...useAgents.getState().groups];
  const index = groups.findIndex((g) => g.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= groups.length) return;
  const [group] = groups.splice(index, 1);
  if (group) groups.splice(target, 0, group);
  await saveGroups(groups);
}

export async function setThreadGroup(threadId: string, groupId: string | null): Promise<void> {
  useAgents.setState((s) => ({ threads: s.threads.map((t) => (t.id === threadId ? { ...t, groupId } : t)) }));
  await window.arbora.invoke('agent.setThreadGroup', { threadId, groupId });
}

export async function setThreadPinned(threadId: string, pinned: boolean): Promise<void> {
  useAgents.setState((s) => ({ threads: s.threads.map((t) => (t.id === threadId ? { ...t, pinned } : t)) }));
  await window.arbora.invoke('agent.setThreadPinned', { threadId, pinned });
}

export async function renameThread(threadId: string, title: string): Promise<void> {
  await window.arbora.invoke('agent.renameThread', { threadId, title });
}

/** Stops every working thread in a group (Herdr's "stop the herd"). */
export async function stopGroup(groupId: string): Promise<number> {
  const working = useAgents.getState().threads.filter((t) => t.groupId === groupId && isStoppable(t.state.status));
  await Promise.all(working.map((t) => stopAgent(t.id)));
  return working.length;
}
