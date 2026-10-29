import { create } from 'zustand';
import type {
  AcpLogEntry,
  AgentAvailability,
  AgentDefinition,
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
  /** Files written by agents this session (Stage 8 turns these into the "Agent changes" group). */
  changedFiles: { threadId: string; path: string; at: number }[];
  loaded: boolean;
}

const INITIAL: AgentPanelState = {
  agents: [],
  availability: [],
  threads: [],
  activeThreadId: null,
  view: 'threads',
  events: {},
  logs: {},
  logOpen: false,
  drafts: {},
  attachments: {},
  composerFocusRequest: 0,
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
  const [agents, threads] = await Promise.all([arbora.invoke('agent.listAgents'), arbora.invoke('agent.listThreads')]);
  useAgents.setState({ agents: agents.agents, availability: agents.availability, loaded: true });
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

export async function createThread(agentId: string): Promise<void> {
  const summary = await window.arbora.invoke('agent.createThread', { agentId });
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

export function showPicker(): void {
  useAgents.setState({ view: 'picker' });
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

export async function deleteThread(threadId: string): Promise<void> {
  await window.arbora.invoke('agent.deleteThread', { threadId });
  useAgents.setState((s) => ({
    threads: s.threads.filter((t) => t.id !== threadId),
    activeThreadId: s.activeThreadId === threadId ? null : s.activeThreadId,
    view: s.activeThreadId === threadId ? 'threads' : s.view,
  }));
}
