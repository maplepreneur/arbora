import { useMemo } from 'react';
import { create } from 'zustand';
import {
  deriveSessionStatus,
  shouldStartDefaultSession,
  taskTitle,
  visibleModels,
  type WorkspaceKind,
} from '@arbora/shared';
import {
  archiveThread,
  deleteThread,
  focusComposer,
  isListed,
  loadThread,
  newThread,
  stopProcess,
  useAgents,
} from './agent-store';
import { defaultAgentId } from './agent-defaults';
import { markSeen, useAttention } from './attention-store';
import {
  buildGroveModel,
  neighbourSession,
  selectionAfterRemoval,
  type GroveModel,
  type GroveSession,
} from './grove-model';
import { ipcError } from './ipc-error';
import { updateProjectSettings } from './settings-client';
import { dispatchMode, showToast, updateLayout, useApp } from './store';

export type GroveTab = 'transcript' | 'changes';

export interface GroveState {
  readonly launcherOpen: boolean;
  /** The project whose current Grove visit already ran the auto-start check (`maybeAutoStart`). */
  readonly autoStartedFor: string | null;
  /** A session is being created from Grove. */
  readonly starting: boolean;
  /** Why the last start from Grove failed; the empty state shows it with Retry. */
  readonly startError: string | null;
  /** The selected session's name is being edited in the pane header. */
  readonly renamingId: string | null;
  readonly tab: GroveTab;
  readonly recentOpen: boolean;
  readonly showAllRecent: boolean;
  /** Bumped to move focus into the session list. */
  readonly listFocusRequest: number;
}

const INITIAL: GroveState = {
  launcherOpen: false,
  autoStartedFor: null,
  starting: false,
  startError: null,
  renamingId: null,
  tab: 'transcript',
  recentOpen: false,
  showAllRecent: false,
  listFocusRequest: 0,
};

export const useGrove = create<GroveState>()(() => ({ ...INITIAL }));

/** Recent shows this many archived sessions until **Show all**. */
export const RECENT_LIMIT = 5;

/** The list collapse, provided by the mounted Grove layout. */
export interface GroveLayoutController {
  toggleList(): void;
}

let layoutController: GroveLayoutController | null = null;

export function setGroveLayoutController(controller: GroveLayoutController | null): void {
  layoutController = controller;
}

export function isGroveShowing(): boolean {
  const { project, layout } = useApp.getState();
  return project !== null && layout.workspace === 'grove';
}

/** Leaving Grove or the project ends the visit: the next visit may auto-start again. */
export function initGroveTracking(): () => void {
  return useApp.subscribe((state, previous) => {
    const left = previous.layout.workspace === 'grove' && state.layout.workspace !== 'grove';
    if (left || previous.project?.path !== state.project?.path) {
      useGrove.setState({ autoStartedFor: null, launcherOpen: false, renamingId: null, startError: null });
    }
  });
}

/**
 * Shows the browser workspace or Grove. Entering Grove exits agent mode, and design mode when it
 * has nothing unsaved; unsaved design edits ask first (Send or Discard, then Grove), so this returns
 * false and does nothing else. The page, terminals and agent processes are left running.
 */
export function showWorkspace(kind: WorkspaceKind): boolean {
  const { project, layout, mode, design } = useApp.getState();
  if (!project) {
    showToast('Open a project first');
    return false;
  }
  if (kind === 'grove' && mode.kind === 'agent') dispatchMode({ type: 'exit' });
  if (kind === 'grove' && mode.kind === 'design') {
    if (mode.phase === 'confirm') return false;
    if (design.cursor > 0) {
      dispatchMode({ type: 'designConfirm', pending: 'grove' });
      return false;
    }
    dispatchMode({ type: 'toggleDesign' });
  }
  useApp.setState({ settingsOpen: false });
  if (layout.workspace !== kind) updateLayout({ workspace: kind });
  return true;
}

export function toggleWorkspace(): void {
  showWorkspace(useApp.getState().layout.workspace === 'grove' ? 'browser' : 'grove');
}

export function groveModelNow(): GroveModel {
  const { threads, groups, agents, events } = useAgents.getState();
  return buildGroveModel({ threads, groups, agents, events, attention: useAttention.getState().threads });
}

export function useGroveModel(): GroveModel {
  const threads = useAgents((s) => s.threads);
  const groups = useAgents((s) => s.groups);
  const agents = useAgents((s) => s.agents);
  const events = useAgents((s) => s.events);
  const attention = useAttention((s) => s.threads);
  return useMemo(
    () => buildGroveModel({ threads, groups, agents, events, attention }),
    [threads, groups, agents, events, attention],
  );
}

/** Some listed session is working or starting: the title-bar switch's activity dot. */
export function useAnySessionWorking(): boolean {
  const threads = useAgents((s) => s.threads);
  const attention = useAttention((s) => s.threads);
  return useMemo(
    () =>
      threads.some((thread) => {
        if (!isListed(thread)) return false;
        const status = deriveSessionStatus(thread.state.status, attention[thread.id]);
        return status === 'working' || status === 'starting';
      }),
    [threads, attention],
  );
}

/** The session Grove shows, listed or archived. */
export function currentSession(): GroveSession | undefined {
  const id = useApp.getState().layout.groveThreadId;
  return id === null ? undefined : groveModelNow().byId.get(id);
}

/** Shows `threadId` in the Grove pane (on the Transcript tab) and, unless told not to, focuses its composer. */
export function selectSession(threadId: string, options: { focus?: boolean } = {}): void {
  if (useApp.getState().layout.groveThreadId !== threadId) updateLayout({ groveThreadId: threadId });
  useGrove.setState({ tab: 'transcript', renamingId: null });
  void loadThread(threadId).catch(() => undefined);
  if (options.focus !== false) focusComposer();
}

/** Next/Previous Agent: one row down or up in screen order, wrapping. */
export function selectRelative(delta: 1 | -1): void {
  const id = neighbourSession(groveModelNow().order, useApp.getState().layout.groveThreadId, delta);
  if (id) selectSession(id);
}

/** `Mod+1`..`Mod+9`: the Nth row in screen order, if there is one. */
export function selectIndex(index: number): void {
  const session = groveModelNow().order[index];
  if (session) selectSession(session.id);
}

export function focusSessionList(): void {
  useGrove.setState((s) => ({ listFocusRequest: s.listFocusRequest + 1 }));
}

let handledListFocus = 0;

/** Whether the list that just rendered takes `listFocusRequest`: once per request, not on every remount. */
export function claimListFocus(request: number): boolean {
  if (request <= handledListFocus) return false;
  handledListFocus = request;
  return true;
}

export function toggleSessionList(): void {
  layoutController?.toggleList();
}

/** The model a new session of `agentId` starts on: its default, else its first visible model. */
export function defaultModelFor(agentId: string): string | undefined {
  return visibleModels(useApp.getState().settings.agents, agentId)[0]?.value;
}

function agentName(agentId: string): string {
  return useAgents.getState().agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

function sendTask(threadId: string, task: string): void {
  void window.arbora
    .invoke('agent.prompt', { threadId, blocks: [{ type: 'text', text: task }], attachments: [] })
    .then((result) => {
      if (result.error && result.error !== 'auth_required') showToast(result.error);
    })
    .catch((error: unknown) => showToast(ipcError(error)));
}

export interface StartSessionOptions {
  readonly agentId: string;
  readonly model?: string | undefined;
  /** The first prompt; its first line titles the session. */
  readonly task?: string | undefined;
}

/** Creates a session, selects it, and sends the task as its first prompt. Resolves to its id. */
export async function startSession(options: StartSessionOptions): Promise<string | null> {
  const task = options.task?.trim() ?? '';
  const title = taskTitle(task);
  useGrove.setState({ starting: true, startError: null });
  try {
    const summary = await newThread(options.agentId, { model: options.model, ...(title ? { title } : {}) });
    selectSession(summary.id);
    if (task) sendTask(summary.id, task);
    return summary.id;
  } catch (error) {
    const message = ipcError(error);
    useGrove.setState({ startError: message });
    showToast(`Could not start ${agentName(options.agentId)}: ${message}`);
    return null;
  } finally {
    useGrove.setState({ starting: false });
  }
}

/** The split button and `Mod+Alt+N`: the default agent on its default model, else the launcher. */
export function startDefaultSession(): void {
  if (!showWorkspace('grove')) return;
  const agentId = defaultAgentId();
  if (!agentId) {
    openLauncher();
    return;
  }
  void startSession({ agentId, model: defaultModelFor(agentId) });
}

export function openLauncher(): void {
  if (showWorkspace('grove')) useGrove.setState({ launcherOpen: true });
}

export function closeLauncher(): void {
  useGrove.setState({ launcherOpen: false });
}

/** The agent list has loaded, so the default agent and its detection are known. */
function agentsKnown(): boolean {
  const { loaded, agents } = useAgents.getState();
  return loaded && agents.length > 0;
}

/**
 * Opening Grove with nothing listed starts one session of the default agent, at most once per
 * visit (`shouldStartDefaultSession`). A visit that did not start one does not start one later.
 */
export function maybeAutoStart(): void {
  const { project } = useApp.getState();
  if (!project || !isGroveShowing() || !agentsKnown()) return;
  const alreadyTried = useGrove.getState().autoStartedFor === project.path;
  if (alreadyTried) return;
  useGrove.setState({ autoStartedFor: project.path });
  const agentId = defaultAgentId() ?? null;
  const { threads, availability } = useAgents.getState();
  const start = shouldStartDefaultSession({
    sessionCount: threads.filter(isListed).length,
    defaultAgentId: agentId,
    defaultAgentDetected: availability.some((entry) => entry.id === agentId && entry.available),
    startDefaultOnOpen: project.settings.startDefaultOnOpen !== false,
    alreadyTriedThisVisit: alreadyTried,
  });
  if (start && agentId) void startSession({ agentId, model: defaultModelFor(agentId) });
}

async function archiveNow(session: GroveSession): Promise<void> {
  const next = selectionAfterRemoval(groveModelNow().order, session.id);
  try {
    await archiveThread(session.id, true);
  } catch (error) {
    showToast(`Could not archive ${session.name}: ${ipcError(error)}`);
    return;
  }
  markSeen(session.id);
  if (useApp.getState().layout.groveThreadId === session.id) {
    updateLayout({ groveThreadId: next });
    if (next) void loadThread(next).catch(() => undefined);
  }
  showToast(`Archived ${session.name}`, { label: 'Undo', run: () => void restoreSession(session.id) });
}

/** Moves a session to Recent. A session whose process is running asks first. */
export function archiveSession(threadId: string): void {
  const session = groveModelNow().byId.get(threadId);
  if (!session || !isListed(session)) return;
  if (session.state.status === 'idle' || session.state.status === 'error') {
    void archiveNow(session);
    return;
  }
  showToast(`Stop ${session.name} and archive it? The transcript stays in Recent.`, {
    label: 'Archive',
    run: () => void archiveNow(session),
  });
}

/** Brings an archived session back to the list and shows it. */
export async function restoreSession(threadId: string): Promise<void> {
  try {
    await archiveThread(threadId, false);
  } catch (error) {
    showToast(`Could not restore: ${ipcError(error)}`);
    return;
  }
  if (isGroveShowing()) selectSession(threadId);
}

export async function stopSession(threadId: string): Promise<void> {
  try {
    await stopProcess(threadId);
  } catch (error) {
    showToast(ipcError(error));
  }
}

export async function restartSession(threadId: string): Promise<void> {
  try {
    await window.arbora.invoke('agent.restart', { threadId });
  } catch (error) {
    showToast(ipcError(error));
  }
}

export async function deleteSession(threadId: string): Promise<void> {
  const next = selectionAfterRemoval(groveModelNow().order, threadId);
  try {
    await deleteThread(threadId);
  } catch (error) {
    showToast(ipcError(error));
    return;
  }
  if (useApp.getState().layout.groveThreadId === threadId) updateLayout({ groveThreadId: next });
}

/** Edits the selected session's name in the pane header. */
export function renameSession(threadId: string): void {
  if (useApp.getState().layout.groveThreadId !== threadId) selectSession(threadId, { focus: false });
  useGrove.setState({ renamingId: threadId });
}

/** Writes the project's `defaultAgent` (`.arbora/project.json`). Never starts a session. */
export async function setProjectDefaultAgent(agentId: string): Promise<void> {
  if (await updateProjectSettings({ defaultAgent: agentId })) {
    showToast(`${agentName(agentId)} is the default agent for this project`);
  }
}

export async function setStartDefaultOnOpen(enabled: boolean): Promise<void> {
  // Missing means on, so on clears the field.
  await updateProjectSettings({ startDefaultOnOpen: enabled ? null : false });
}
