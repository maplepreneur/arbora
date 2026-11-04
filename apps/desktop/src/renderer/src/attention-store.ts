import { create } from 'zustand';
import {
  attentionCount,
  attentionKind,
  attentionMessage,
  nextAttentionThread,
  reduceAttention,
  type AttentionInput,
  type AttentionKind,
  type ThreadAttention,
  type ThreadChange,
  type ThreadState,
} from '@arbora/shared';
import { useAgents } from './agent-store';
import { playSound } from './sounds';
import { useApp } from './store';

export interface AttentionStoreState {
  readonly threads: Record<string, ThreadAttention>;
  /** The last cue played or skipped, for the e2e tests and the Settings preview. */
  readonly lastCue: { kind: AttentionKind; threadId: string; sound: boolean; notified: boolean } | null;
}

export const useAttention = create<AttentionStoreState>()(() => ({ threads: {}, lastCue: null }));

export function resetAttention(): void {
  useAttention.setState({ threads: {}, lastCue: null });
  syncCount();
}

/** The thread on screen in the workspace that shows: the Grove selection, or the docked panel's open thread. */
export function visibleThreadId(): string | null {
  const { settingsOpen, layout } = useApp.getState();
  if (settingsOpen) return null;
  if (layout.workspace === 'grove') return layout.groveThreadId;
  const { activeThreadId, view } = useAgents.getState();
  return view === 'thread' ? activeThreadId : null;
}

/** The thread is on screen and the window has focus. */
export function isThreadVisible(threadId: string): boolean {
  return useApp.getState().windowState.focused && visibleThreadId() === threadId;
}

let lastSentCount = -1;
function syncCount(): void {
  const count = attentionCount(useAttention.getState().threads);
  if (count === lastSentCount) return;
  lastSentCount = count;
  void window.arbora.invoke('app.setAttention', { count }).catch(() => undefined);
}

function threadName(threadId: string): string {
  const { threads, agents } = useAgents.getState();
  const thread = threads.find((t) => t.id === threadId);
  const agent = agents.find((a) => a.id === thread?.agentId)?.name ?? thread?.agentId ?? 'Agent';
  if (!thread || thread.title === 'New thread') return agent;
  return `${agent} · ${thread.title}`;
}

function soundFor(kind: AttentionKind): ReturnType<typeof useApp.getState>['settings']['sounds']['finished'] {
  const { sounds } = useApp.getState().settings;
  switch (kind) {
    case 'permission':
    case 'auth':
      return sounds.permission;
    case 'finished':
      return sounds.finished;
    case 'failed':
      return sounds.failed;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** Plays the cue and asks main for a desktop notification, unless the user is looking at it. */
function announce(threadId: string, kind: AttentionKind, attention: ThreadAttention): void {
  const visible = isThreadVisible(threadId);
  const { sounds } = useApp.getState().settings;
  const sound = sounds.enabled && (!visible || sounds.whenFocused) && soundFor(kind) !== 'none';
  if (sound) playSound(soundFor(kind), sounds.volume);
  const notified = !visible;
  if (notified) {
    const { title, body } = attentionMessage(kind, threadName(threadId), attention);
    void window.arbora.invoke('app.notify', { title, body, threadId, kind }).catch(() => undefined);
  }
  useAttention.setState({ lastCue: { kind, threadId, sound, notified } });
}

function apply(threadId: string, input: AttentionInput): void {
  const current = useAttention.getState().threads[threadId];
  const { next, signal } = reduceAttention(current, input);
  let settled = next;
  // A finish on the thread the user is reading is already seen.
  if (signal !== null && (signal === 'finished' || signal === 'failed') && isThreadVisible(threadId)) {
    settled = reduceAttention(next, { type: 'seen' }).next;
  }
  useAttention.setState((s) => ({ threads: { ...s.threads, [threadId]: settled } }));
  if (signal !== null) announce(threadId, signal, next);
  syncCount();
}

export function noteThreadChanges(threadId: string, changes: readonly ThreadChange[]): void {
  apply(threadId, { type: 'changes', changes, at: Date.now() });
}

export function noteThreadState(threadId: string, state: ThreadState): void {
  apply(threadId, { type: 'status', status: state.status, error: state.error, at: Date.now() });
}

export function markSeen(threadId: string): void {
  const current = useAttention.getState().threads[threadId];
  if (!current) return;
  const { next } = reduceAttention(current, { type: 'seen' });
  if (next === current) return;
  useAttention.setState((s) => ({ threads: { ...s.threads, [threadId]: next } }));
  syncCount();
}

/** Drops threads that were deleted. */
export function pruneAttention(threadIds: readonly string[]): void {
  const keep = new Set(threadIds);
  const threads = useAttention.getState().threads;
  if (Object.keys(threads).every((id) => keep.has(id))) return;
  useAttention.setState({ threads: Object.fromEntries(Object.entries(threads).filter(([id]) => keep.has(id))) });
  syncCount();
}

export function nextThreadNeedingYou(): string | null {
  return nextAttentionThread(useAttention.getState().threads);
}

export function useAttentionCount(): number {
  return useAttention((s) => attentionCount(s.threads));
}

export function useThreadAttention(threadId: string): AttentionKind | null {
  return useAttention((s) => attentionKind(s.threads[threadId]));
}

/** Clears "finished" and "failed" once the open thread is on screen in a focused window. */
export function initAttentionTracking(): () => void {
  const check = (): void => {
    const threadId = visibleThreadId();
    if (threadId && isThreadVisible(threadId)) markSeen(threadId);
  };
  const offAgents = useAgents.subscribe(check);
  const offApp = useApp.subscribe(check);
  return () => {
    offAgents();
    offApp();
  };
}
