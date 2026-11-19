import { create } from 'zustand';
import {
  newGroupId,
  type AgentAvailability,
  type AgentDefinition,
  type AgentGroup,
  type Attachment,
  type ConfirmationRequest,
  type ThreadState,
  type ThreadSummary,
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
  /** Pending Arbora confirmation cards by request id (browser tools, Grove helper starts). */
  confirmations: Record<string, ConfirmationRequest>;
  /** Composer text per thread, kept while switching threads. */
  drafts: Record<string, string>;
  attachments: Record<string, Attachment[]>;
  /** Bumped to move focus to the composer. */
  composerFocusRequest: number;
  /** Bumped to focus the new-thread picker with the default agent highlighted. */
  pickerFocusRequest: number;
  /** The new-group name field: `''` for an empty group, or the thread to move into it. */
  newGroupFor: string | null;
  /** Files that changed while an agent's turn was running, for the "Agent changes" group. */
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
  confirmations: {},
  drafts: {},
  attachments: {},
  composerFocusRequest: 0,
  pickerFocusRequest: 0,
  newGroupFor: null,
  changedFiles: [],
  loaded: false,
};

export const useAgents = create<AgentPanelState>()(() => ({ ...INITIAL }));

export function resetAgents(): void {
  useAgents.setState({ ...INITIAL });
}

export function applyThreadState(threadId: string, state: ThreadState): void {
  useAgents.setState((s) => ({ threads: s.threads.map((t) => (t.id === threadId ? { ...t, state } : t)) }));
}

/** Listed in the docked panel and Grove; archived threads only show in Grove's Recent. */
export function isListed(thread: Pick<ThreadSummary, 'archivedAt'>): boolean {
  return thread.archivedAt === null;
}

export function applyThreadList(threads: ThreadSummary[]): void {
  useAgents.setState((s) => {
    const activeThreadId = threads.some((t) => t.id === s.activeThreadId && isListed(t)) ? s.activeThreadId : null;
    return {
      threads,
      activeThreadId,
      view: activeThreadId === null && s.view === 'thread' ? 'threads' : s.view,
      loaded: true,
    };
  });
}

/** A confirmation card main raised for this thread (a guarded browser tool, a helper start). */
export function applyConfirmation(request: ConfirmationRequest): void {
  useAgents.setState((s) => ({ confirmations: { ...s.confirmations, [request.requestId]: request } }));
}

/** The card was answered (or withdrawn); the agent terminal's state says what happens next. */
export function resolveConfirmation(requestId: string): void {
  useAgents.setState((s) => {
    const { [requestId]: _answered, ...confirmations } = s.confirmations;
    return { confirmations };
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
  const thread = await window.arbora.invoke('agent.getThread', { threadId });
  if (!thread) return;
  useAgents.setState((s) => ({
    threads: s.threads.some((t) => t.id === threadId)
      ? s.threads.map((t) => (t.id === threadId ? { ...t, state: thread.state } : t))
      : [{ ...thread }, ...s.threads],
  }));
}

export interface NewThreadOptions {
  /** Files it in an agent group. */
  readonly groupId?: string | null | undefined;
  /** Grove's launcher names the session after its task. */
  readonly title?: string | undefined;
}

/** Creates a thread (the agent CLI starts in its terminal at once) without opening it anywhere. */
export async function newThread(agentId: string, options: NewThreadOptions = {}): Promise<ThreadSummary> {
  const summary = await window.arbora.invoke('agent.createThread', {
    agentId,
    ...(options.groupId ? { groupId: options.groupId } : {}),
    ...(options.title ? { title: options.title } : {}),
  });
  useAgents.setState((s) => ({
    threads: s.threads.some((t) => t.id === summary.id) ? s.threads : [summary, ...s.threads],
  }));
  return summary;
}

/** `groupId` files the new thread in a group and opens it with the composer focused. */
export async function createThread(agentId: string, groupId?: string | null): Promise<void> {
  const summary = await newThread(agentId, { groupId });
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

/**
 * Sends the composer's text; attachments become path mentions main adds to the prompt. The turn's
 * progress arrives through `agent.threadState`.
 */
export async function sendPrompt(threadId: string): Promise<{ error?: string }> {
  const state = useAgents.getState();
  const text = (state.drafts[threadId] ?? '').trim();
  const attachments = state.attachments[threadId] ?? [];
  if (!text && attachments.length === 0) return {};
  useAgents.setState((s) => ({
    drafts: { ...s.drafts, [threadId]: '' },
    attachments: { ...s.attachments, [threadId]: [] },
  }));
  try {
    const result = await window.arbora.invoke('agent.sendPrompt', {
      threadId,
      text,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
    return result.error ? { error: result.error } : {};
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** Answers one of Arbora's own confirmation cards. */
export async function answerConfirmation(threadId: string, requestId: string, optionId: string): Promise<void> {
  resolveConfirmation(requestId);
  await window.arbora.invoke('agent.answerConfirmation', { threadId, requestId, optionId });
}

/** Interrupts the agent's current work (Ctrl+C in its terminal). */
export async function stopAgent(threadId: string): Promise<void> {
  await window.arbora.invoke('agent.stop', { threadId });
}

/** Whether Stop has something to interrupt. */
export function isStoppable(status: ThreadSummary['state']['status']): boolean {
  return status === 'working' || status === 'starting';
}

/** Ends the agent process in any state (Grove's power toggle); the next prompt starts it again. */
export async function stopProcess(threadId: string): Promise<void> {
  await window.arbora.invoke('agent.stopProcess', { threadId });
}

/** Restarts the agent CLI in a fresh terminal. */
export async function restartThread(threadId: string): Promise<void> {
  await window.arbora.invoke('agent.restart', { threadId });
}

/** Moves a thread to Grove's Recent (main stops its process first) or back to the list. */
export async function archiveThread(threadId: string, archived: boolean): Promise<void> {
  const archivedAt = archived ? Date.now() : null;
  useAgents.setState((s) => {
    const closing = archived && s.activeThreadId === threadId;
    return {
      threads: s.threads.map((t) => (t.id === threadId ? { ...t, archivedAt } : t)),
      ...(closing ? { activeThreadId: null, view: s.view === 'thread' ? ('threads' as const) : s.view } : {}),
    };
  });
  await window.arbora.invoke('agent.archiveThread', { threadId, archived });
}

/**
 * Where agent mode (`Mod+K`) sends by default: the thread in the chat column, else a new thread
 * with the default agent (or the first detected agent, or the first listed one).
 */
export function defaultAgentModeTarget(
  state: Pick<AgentPanelState, 'threads' | 'agents' | 'availability'>,
  openThreadId: string | null,
  defaultAgentId: string | undefined,
): string | null {
  const open = state.threads.find((t) => t.id === openThreadId && isListed(t));
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

/** Interrupts every working thread in a group (Herdr's "stop the herd"). */
export async function stopGroup(groupId: string): Promise<number> {
  const working = useAgents.getState().threads.filter((t) => t.groupId === groupId && isStoppable(t.state.status));
  await Promise.all(working.map((t) => stopAgent(t.id)));
  return working.length;
}
