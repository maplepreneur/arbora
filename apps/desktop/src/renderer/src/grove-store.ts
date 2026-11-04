import { useMemo } from 'react';
import { create } from 'zustand';
import {
  cycleListedProject,
  deriveSessionStatus,
  groveProjectSections,
  type ProjectFramework,
  inboxTarget,
  shouldStartDefaultSession,
  taskTitle,
  visibleModels,
  type GroveInboxItem,
  type TerminalInfo,
  type ThreadState,
  type ThreadSummary,
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
import { markSeen, seedWaitingAttention, useAttention } from './attention-store';
import {
  buildGroveModel,
  neighbourSession,
  selectionAfterRemoval,
  type GroveModel,
  type GroveSession,
} from './grove-model';
import { buildGroveSidebar, type GroveSidebarModel } from './grove-sidebar-model';
import { replaceGroveThreadIndex } from './grove-thread-index';
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
  /** Grove is showing this project's agents and terminals. Null follows the window's project. */
  readonly focusPath: string | null;
  /** A terminal in the focused project, shown instead of the agent transcript. */
  readonly terminalId: string | null;
  /** Bumped to move focus into the Grove terminal, including when it is already showing. */
  readonly terminalFocusRequest: number;
  readonly searchOpen: boolean;
  /** Terminals per project path, including projects that are not the focused one. */
  readonly terminalsByProject: Readonly<Record<string, readonly TerminalInfo[]>>;
  /** ACP threads per project path, including projects that are not the focused one. */
  readonly threadsByProject: Readonly<Record<string, readonly ThreadSummary[]>>;
  /**
   * The window project the user removed from Grove. An empty remembered list would otherwise show
   * it again, because that project is still open on the window.
   */
  readonly dismissedOpenPath: string | null;
  /** Ctrl+Tab highlight. Null when the switcher is closed. */
  readonly projectSwitch: { readonly paths: readonly string[]; readonly index: number } | null;
  /** Framework logo per Grove project path. Missing paths render as Arbora. */
  readonly frameworkByPath: Readonly<Record<string, ProjectFramework>>;
  readonly usage: readonly {
    projectPath: string;
    kind: 'terminal' | 'agent';
    id: string;
    rssKb: number;
    cpuPercent: number;
    agentCli: string | null;
  }[];
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
  focusPath: null,
  terminalId: null,
  terminalFocusRequest: 0,
  searchOpen: false,
  terminalsByProject: {},
  threadsByProject: {},
  dismissedOpenPath: null,
  projectSwitch: null,
  frameworkByPath: {},
  usage: [],
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
  return useApp.getState().layout.workspace === 'grove';
}

/** Leaving Grove or the project ends the visit: the next visit may auto-start again. */
export function initGroveTracking(): () => void {
  return useApp.subscribe((state, previous) => {
    const left = previous.layout.workspace === 'grove' && state.layout.workspace !== 'grove';
    if (left || previous.project?.path !== state.project?.path) {
      if (left) {
        useGrove.setState({
          searchOpen: false,
          launcherOpen: false,
          renamingId: null,
          startError: null,
          autoStartedFor: null,
        });
        // Drop main's grove focus so browser IPC follows this window. Keep the renderer
        // selection so Mod+Shift+K can reopen Grove on it instead of the browser project.
        void window.arbora.invoke('grove.focusProject', { path: null }).finally(() => {
          useGrove.setState({ terminalId: null });
        });
        return;
      }
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
    useApp.setState({ settingsOpen: false });
    if (layout.workspace !== kind) updateLayout({ workspace: kind });
    if (kind === 'grove') reattachGroveFocus();
    return true;
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
  if (kind === 'grove') reattachGroveFocus();
  return true;
}

/** Main cleared grove focus while the browser was showing. Put that row back, without changing it. */
function reattachGroveFocus(): void {
  const focus = useGrove.getState().focusPath;
  const open = useApp.getState().project?.path ?? null;
  if (!focus || focus === open) return;
  void window.arbora.invoke('grove.focusProject', { path: focus }).catch(() => undefined);
}

export function toggleWorkspace(): void {
  if (useApp.getState().layout.workspace === 'grove') void showBrowserForGroveSelection();
  else void showGroveForBrowserProject();
}

/** The project Grove is showing: its focused row, or this window's project when the row follows it. */
export function groveSelectedProjectPath(): string | null {
  return useGrove.getState().focusPath ?? useApp.getState().project?.path ?? null;
}

/**
 * Grove → browser. Switches this window onto the project selected in Grove, then shows the browser.
 * A page that window already has for the folder is shown again. Another window does not take focus.
 */
export async function showBrowserForGroveSelection(): Promise<boolean> {
  const selected = groveSelectedProjectPath();
  if (!selected) return showWorkspace('browser');
  const current = useApp.getState().project?.path ?? null;
  if (selected !== current) {
    try {
      const result = await window.arbora.invoke('project.open', { path: selected, onThisWindow: true });
      if (result.focusedElsewhere) return false;
      if (!result.opened) {
        showToast(result.error ?? 'Could not open that project');
        return false;
      }
    } catch (error) {
      showToast(ipcError(error));
      return false;
    }
  }
  return showWorkspace('browser');
}

/** So the sidebar lists `path` before Grove mounts, if `settings.changed` has not arrived yet. */
function rememberGroveProject(path: string): void {
  useApp.setState((state) => {
    if (state.settings.grove.projects.some((entry) => entry.path === path)) return state;
    return {
      settings: {
        ...state.settings,
        grove: {
          ...state.settings.grove,
          projects: [...state.settings.grove.projects, { path, collapsed: false }].slice(0, 50),
        },
      },
    };
  });
}

/**
 * Browser → Grove. Shows Grove and focuses the project this window has open, adding it to the
 * remembered list when Grove does not list it yet. With no browser project, Grove just opens.
 */
export async function showGroveForBrowserProject(): Promise<boolean> {
  const path = useApp.getState().project?.path;
  if (!path) return showWorkspace('grove');
  if (useGrove.getState().dismissedOpenPath === path) useGrove.setState({ dismissedOpenPath: null });
  if (!useApp.getState().settings.grove.projects.some((entry) => entry.path === path)) {
    try {
      const result = await window.arbora.invoke('grove.addProject', { path });
      if (result.error || !result.added) {
        if (result.error) showToast(result.error);
        return false;
      }
    } catch (error) {
      showToast(ipcError(error));
      return false;
    }
    rememberGroveProject(path);
  }
  // Null follows the window's project. A different row would keep the previous Grove selection.
  if (useGrove.getState().focusPath !== null) {
    try {
      await focusGroveProject(null);
    } catch (error) {
      showToast(ipcError(error));
      return false;
    }
  }
  return showWorkspace('grove');
}

/** Shows one Grove project's agents and terminals in this window. */
export async function focusGroveProject(path: string | null): Promise<void> {
  await window.arbora.invoke('grove.focusProject', { path });
  useGrove.setState({ focusPath: path, terminalId: null, searchOpen: false });
}

export function selectGroveTerminal(id: string | null, options: { focus?: boolean } = {}): void {
  useGrove.setState((state) => ({
    terminalId: id,
    terminalFocusRequest: options.focus ? state.terminalFocusRequest + 1 : state.terminalFocusRequest,
  }));
}

/** Starts a shell in the Grove project on screen (or `path`) and focuses it. Does not leave Grove. */
export async function createGroveTerminal(path?: string): Promise<void> {
  const open = useApp.getState().project?.path ?? null;
  const target = path ?? useGrove.getState().focusPath ?? open;
  if (!target) {
    showToast('Open a project first');
    return;
  }
  const showing = useGrove.getState().focusPath ?? open;
  if (showing !== target) {
    try {
      await focusGroveProject(target === open ? null : target);
    } catch (error) {
      showToast(ipcError(error));
      return;
    }
  }
  try {
    const info = await window.arbora.invoke('terminal.create', { cols: 100, rows: 24 });
    selectGroveTerminal(info.id, { focus: true });
  } catch (error) {
    showToast(`Could not start a terminal: ${ipcError(error)}`);
  }
}

export function noteProjectTerminals(projectPath: string, terminals: readonly TerminalInfo[]): void {
  useGrove.setState((state) => ({ terminalsByProject: { ...state.terminalsByProject, [projectPath]: terminals } }));
}

function reindexThreads(threadsByProject: Readonly<Record<string, readonly ThreadSummary[]>>): void {
  replaceGroveThreadIndex(
    Object.entries(threadsByProject).flatMap(([projectPath, threads]) =>
      threads.map((thread) => ({
        projectPath,
        id: thread.id,
        title: thread.title,
        agentId: thread.agentId,
        parentThreadId: thread.parentThreadId,
      })),
    ),
  );
}

export function indexedThreadIds(): string[] {
  const ids: string[] = [];
  for (const threads of Object.values(useGrove.getState().threadsByProject)) {
    for (const thread of threads) ids.push(thread.id);
  }
  return ids;
}

export function noteProjectThreads(projectPath: string, threads: readonly ThreadSummary[]): void {
  useGrove.setState((state) => {
    const threadsByProject = { ...state.threadsByProject, [projectPath]: threads };
    reindexThreads(threadsByProject);
    return { threadsByProject };
  });
}

export function patchProjectThread(projectPath: string, threadId: string, state: ThreadState): void {
  useGrove.setState((current) => {
    const threads = current.threadsByProject[projectPath];
    if (!threads) return {};
    const threadsByProject = {
      ...current.threadsByProject,
      [projectPath]: threads.map((thread) => (thread.id === threadId ? { ...thread, state } : thread)),
    };
    reindexThreads(threadsByProject);
    return { threadsByProject };
  });
}

/** Thread lists for every Grove runtime, plus permissions that were already waiting. */
export function refreshGroveAgents(): void {
  void window.arbora.invoke('grove.agents').then((result) => {
    for (const project of result.projects) {
      noteProjectThreads(project.path, project.threads);
      for (const waiting of project.waiting) seedWaitingAttention(waiting.threadId, waiting);
    }
  });
}

/** The project that owns this terminal, or null when it is not in any project's list. */
export function projectPathForTerminal(id: string): string | null {
  const { terminalsByProject, focusPath } = useGrove.getState();
  const owners = Object.entries(terminalsByProject)
    .filter(([, terminals]) => terminals.some((terminal) => terminal.id === id))
    .map(([path]) => path);
  if (owners.length === 0) return null;
  if (owners.length === 1) return owners[0] ?? null;
  if (focusPath && owners.includes(focusPath)) return focusPath;
  const open = useApp.getState().project?.path;
  if (open && owners.includes(open)) return open;
  return owners[0] ?? null;
}

/**
 * Drops a project from Grove's remembered list. Quitting the app does not do this. A project with
 * something running asks first; confirming stops that runtime when nothing else holds it.
 */
export async function closeGroveProject(path: string, name: string): Promise<void> {
  const dropped = (): void => {
    const open = useApp.getState().project?.path;
    const listed = useApp.getState().settings.grove.projects.map((entry) => entry.path);
    const showing = useGrove.getState().focusPath ?? open;
    if (showing !== path) return;
    const next = listed.find((entry) => entry !== path) ?? null;
    void focusGroveProject(next === open ? null : next);
  };
  const result = await window.arbora.invoke('grove.removeProject', { path });
  if (result.running) {
    showToast(`Close ${name}? Its terminals and agents will stop.`, {
      label: 'Close',
      run: () => {
        void window.arbora.invoke('grove.removeProject', { path, confirm: true }).then(() => {
          if (useApp.getState().project?.path === path) useGrove.setState({ dismissedOpenPath: path });
          dropped();
        });
      },
    });
    return;
  }
  if (result.removed) {
    if (useApp.getState().project?.path === path) useGrove.setState({ dismissedOpenPath: path });
    dropped();
  }
}

/** Next or previous project in the Grove sidebar, wrapping. */
export function cycleGroveProject(delta: 1 | -1): void {
  const { project, settings } = useApp.getState();
  const paths = settings.grove.projects.map((entry) => entry.path);
  if (paths.length === 0) return;
  const current = useGrove.getState().focusPath ?? project?.path ?? paths[0];
  const index = Math.max(0, current ? paths.indexOf(current) : 0);
  const next = paths[(index + delta + paths.length) % paths.length];
  if (!next) return;
  void focusGroveProject(next === project?.path ? null : next);
}

function switcherPaths(): string[] {
  const { project, settings } = useApp.getState();
  const listed = settings.grove.projects.map((entry) => entry.path);
  const open = project?.path ?? null;
  const paths = listed.length > 0 ? listed : open ? [open] : [];
  return groveProjectSections(paths, settings.projectGroups, settings.projects).flatMap((section) => section.paths);
}

/** Opens the project switcher on the next or previous project, or moves it if it is already open. */
export function stepProjectSwitch(delta: 1 | -1): void {
  const current = useGrove.getState().projectSwitch;
  if (current) {
    const highlighted = current.paths[current.index] ?? null;
    const next = cycleListedProject(current.paths, highlighted, delta);
    if (!next) return;
    useGrove.setState({ projectSwitch: { paths: current.paths, index: Math.max(0, current.paths.indexOf(next)) } });
    return;
  }
  const paths = switcherPaths();
  const selected = groveSelectedProjectPath();
  const next = cycleListedProject(paths, selected, delta);
  if (!next) return;
  useGrove.setState({ projectSwitch: { paths, index: Math.max(0, paths.indexOf(next)) } });
}

export function confirmProjectSwitch(): void {
  const current = useGrove.getState().projectSwitch;
  if (!current) return;
  const path = current.paths[current.index];
  useGrove.setState({ projectSwitch: null });
  if (!path) return;
  const open = useApp.getState().project?.path ?? null;
  void focusGroveProject(path === open ? null : path);
}

export function cancelProjectSwitch(): void {
  if (useGrove.getState().projectSwitch) useGrove.setState({ projectSwitch: null });
}

export function noteProjectFramework(path: string, framework: ProjectFramework): void {
  useGrove.setState((state) => ({ frameworkByPath: { ...state.frameworkByPath, [path]: framework } }));
}

export function openGroveSearch(): void {
  // The palette pick is the jump. Do not adopt the browser project as the Grove selection first.
  if (!isGroveShowing() && !showWorkspace('grove')) return;
  useGrove.setState({ searchOpen: true });
}

export function usageFor(kind: 'terminal' | 'agent', id: string): { rssKb: number; cpuPercent: number } | null {
  const { focusPath, usage } = useGrove.getState();
  const sample = usage.find(
    (entry) => entry.kind === kind && entry.id === id && (focusPath === null || entry.projectPath === focusPath),
  );
  return sample ? { rssKb: sample.rssKb, cpuPercent: sample.cpuPercent } : null;
}

export function formatUsage(rssKb: number, cpuPercent: number): string {
  const memory = rssKb >= 1024 * 1024 ? `${(rssKb / (1024 * 1024)).toFixed(1)} GB` : `${Math.round(rssKb / 1024)} MB`;
  return `CPU ${cpuPercent.toFixed(1)}% · MEM ${memory}`;
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

function sidebarModel(input: {
  listed: readonly { path: string; collapsed?: boolean }[];
  projectGroups: Parameters<typeof groveProjectSections>[1];
  projects: Readonly<Record<string, { groupId?: string | undefined; alias?: string | undefined } | undefined>>;
  openPath: string | null;
  openName: string | null;
  focusPath: string | null;
  dismissedOpenPath: string | null;
  threadsByProject: Readonly<Record<string, readonly ThreadSummary[]>>;
  liveThreads: readonly ThreadSummary[];
  liveGroups: ReturnType<typeof useAgents.getState>['groups'];
  liveAgents: ReturnType<typeof useAgents.getState>['agents'];
  liveEvents: ReturnType<typeof useAgents.getState>['events'];
  loaded: boolean;
  attention: ReturnType<typeof useAttention.getState>['threads'];
}): GroveSidebarModel {
  const remembered = input.listed.map((entry) => entry.path);
  const active = input.focusPath ?? input.openPath;
  const showOpen = remembered.length === 0 && active !== null && active !== input.dismissedOpenPath;
  const paths = remembered.length > 0 ? remembered : showOpen && active ? [active] : [];
  const collapsed = new Map(input.listed.map((entry) => [entry.path, entry.collapsed === true]));
  const sections = groveProjectSections(paths, input.projectGroups, input.projects);
  const expanded: string[] = [];
  for (const section of sections) {
    if (section.collapsed) continue;
    for (const path of section.paths) if (collapsed.get(path) !== true) expanded.push(path);
  }
  const nameOf = (path: string): string =>
    input.projects[path]?.alias ??
    (path === input.openPath ? (input.openName ?? path) : (path.split(/[/\\]/).pop() ?? path));
  return buildGroveSidebar({
    projects: paths.map((path) => ({
      path,
      threads: path === active && input.loaded ? input.liveThreads : (input.threadsByProject[path] ?? []),
      groups: path === active && input.loaded ? input.liveGroups : [],
      events: path === active && input.loaded ? input.liveEvents : {},
    })),
    expandedPaths: expanded,
    agents: input.liveAgents,
    attention: input.attention,
    projectName: nameOf,
  });
}

export function sidebarModelNow(): GroveSidebarModel {
  const { project, settings } = useApp.getState();
  const { focusPath, threadsByProject, dismissedOpenPath } = useGrove.getState();
  const { threads, groups, agents, events, loaded } = useAgents.getState();
  return sidebarModel({
    listed: settings.grove.projects,
    projectGroups: settings.projectGroups,
    projects: settings.projects,
    openPath: project?.path ?? null,
    openName: project?.name ?? null,
    focusPath,
    dismissedOpenPath,
    threadsByProject,
    liveThreads: threads,
    liveGroups: groups,
    liveAgents: agents,
    liveEvents: events,
    loaded,
    attention: useAttention.getState().threads,
  });
}

/** Agents under each Grove project, and the inbox across all of them. */
export function useGroveSidebar(): GroveSidebarModel {
  const listed = useApp((s) => s.settings.grove.projects);
  const projectGroups = useApp((s) => s.settings.projectGroups);
  const projects = useApp((s) => s.settings.projects);
  const open = useApp((s) => s.project);
  const focusPath = useGrove((s) => s.focusPath);
  const threadsByProject = useGrove((s) => s.threadsByProject);
  const dismissedOpenPath = useGrove((s) => s.dismissedOpenPath);
  const threads = useAgents((s) => s.threads);
  const groups = useAgents((s) => s.groups);
  const agents = useAgents((s) => s.agents);
  const events = useAgents((s) => s.events);
  const loaded = useAgents((s) => s.loaded);
  const attention = useAttention((s) => s.threads);
  return useMemo(
    () =>
      sidebarModel({
        listed,
        projectGroups,
        projects,
        openPath: open?.path ?? null,
        openName: open?.name ?? null,
        focusPath,
        dismissedOpenPath,
        threadsByProject,
        liveThreads: threads,
        liveGroups: groups,
        liveAgents: agents,
        liveEvents: events,
        loaded,
        attention,
      }),
    [
      listed,
      projectGroups,
      projects,
      open,
      focusPath,
      dismissedOpenPath,
      threadsByProject,
      threads,
      groups,
      agents,
      events,
      loaded,
      attention,
    ],
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

/** The project that owns this thread. The focused project's live list wins over a stale snapshot. */
export function projectPathForThread(threadId: string): string | null {
  const open = useApp.getState().project?.path ?? null;
  const showing = useGrove.getState().focusPath ?? open;
  if (showing && useAgents.getState().threads.some((thread) => thread.id === threadId)) return showing;
  for (const [path, threads] of Object.entries(useGrove.getState().threadsByProject)) {
    if (threads.some((thread) => thread.id === threadId)) return path;
  }
  return null;
}

/** Shows `threadId` in the Grove pane (on the Transcript tab) and, unless told not to, focuses its composer. */
export function selectSession(threadId: string, options: { focus?: boolean } = {}): void {
  const projectPath = projectPathForThread(threadId);
  const open = useApp.getState().project?.path ?? null;
  const showing = useGrove.getState().focusPath ?? open;
  const apply = (): void => {
    if (useApp.getState().layout.groveThreadId !== threadId) updateLayout({ groveThreadId: threadId });
    useGrove.setState({ tab: 'transcript', renamingId: null, terminalId: null });
    void loadThread(threadId).catch(() => undefined);
    if (options.focus !== false) focusComposer();
  };
  if (projectPath && projectPath !== showing) {
    if (useApp.getState().layout.groveThreadId !== threadId) updateLayout({ groveThreadId: threadId });
    useGrove.setState({ tab: 'transcript', renamingId: null, terminalId: null });
    const entry = useApp.getState().settings.grove.projects.find((item) => item.path === projectPath);
    if (entry?.collapsed) void window.arbora.invoke('grove.setCollapsed', { path: projectPath, collapsed: false });
    void focusGroveProject(projectPath === open ? null : projectPath).then(apply);
    return;
  }
  apply();
}

/** Inbox row: focus that project and open that agent. Does not answer a permission. */
export function openInboxItem(item: Pick<GroveInboxItem, 'threadId' | 'projectPath'>): void {
  const target = inboxTarget(item, useApp.getState().project?.path ?? null);
  selectSession(target.threadId);
}

/** Next/Previous Agent: one visible row down or up, including agents in other expanded projects. */
export function selectRelative(delta: 1 | -1): void {
  const id = neighbourSession(sidebarModelNow().order, useApp.getState().layout.groveThreadId, delta);
  if (id) selectSession(id);
}

/** `Mod+1`..`Mod+9`: the Nth visible agent row, including other expanded projects. */
export function selectIndex(index: number): void {
  const session = sidebarModelNow().order[index];
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
  /** Start the agent in a new git worktree, registered as its own Grove project. */
  readonly worktree?: boolean;
}

/** Creates a session, selects it, and sends the task as its first prompt. Resolves to its id. */
export async function startSession(options: StartSessionOptions): Promise<string | null> {
  const task = options.task?.trim() ?? '';
  const title = taskTitle(task);
  useGrove.setState({ starting: true, startError: null });
  try {
    if (options.worktree) {
      const parent = useGrove.getState().focusPath ?? useApp.getState().project?.path;
      if (!parent) throw new Error('Open a project first');
      const result = await window.arbora.invoke('grove.createWorktree', {
        parentPath: parent,
        title: title || 'grove-session',
        agentId: options.agentId,
        ...(options.model ? { model: options.model } : {}),
      });
      if (result.error || !result.path || !result.threadId) {
        throw new Error(result.error ?? 'Could not create the worktree');
      }
      const open = useApp.getState().project?.path;
      await focusGroveProject(result.path === open ? null : result.path);
      selectSession(result.threadId);
      if (task) sendTask(result.threadId, task);
      return result.threadId;
    }
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

/** New agent in `path`: focus that project, then start its default agent. */
export async function startAgentIn(path: string): Promise<void> {
  await showProject(path);
  startDefaultSession();
}

/** The launcher, for the project whose section was clicked. */
export async function openLauncherFor(path: string): Promise<void> {
  await showProject(path);
  openLauncher();
}

async function showProject(path: string): Promise<void> {
  const open = useApp.getState().project?.path ?? null;
  const showing = useGrove.getState().focusPath ?? open;
  if (showing !== path) await focusGroveProject(path === open ? null : path);
  if (path === open) useGrove.setState({ dismissedOpenPath: null });
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
  const next = selectionAfterRemoval(sidebarModelNow().order, session.id);
  try {
    await archiveThread(session.id, true);
  } catch (error) {
    showToast(`Could not archive ${session.name}: ${ipcError(error)}`);
    return;
  }
  markSeen(session.id);
  if (useApp.getState().layout.groveThreadId === session.id) {
    if (next) selectSession(next, { focus: false });
    else updateLayout({ groveThreadId: null });
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
  const next = selectionAfterRemoval(sidebarModelNow().order, threadId);
  try {
    await deleteThread(threadId);
  } catch (error) {
    showToast(ipcError(error));
    return;
  }
  if (useApp.getState().layout.groveThreadId === threadId) {
    if (next) selectSession(next, { focus: false });
    else updateLayout({ groveThreadId: null });
  }
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
