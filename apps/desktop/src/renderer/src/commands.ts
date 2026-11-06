import {
  baseName,
  browserViewAcceptsFocus,
  CommandId,
  CommandRegistry,
  commandIdSchema,
  DEFAULT_COMMANDS,
  groveSessionIndex,
  rightTabIndex,
  isPickableAgent,
  parentPath,
  toProjectPath,
  visibleModels,
  type AgentModeTarget,
  type BottomTab,
  type BrowserAction,
  type DesignCommand,
  type GroveWebsiteAction,
  type ScreenshotRequest,
  type SidebarView,
  type ThemeMode,
  type ThreadSummary,
  type ViewportPresetId,
  type WorkspacePanel,
} from '@arbora/shared';
import {
  isListed,
  isStoppable,
  focusComposer,
  loadThread,
  requestNewGroup,
  stopAgent,
  toggleLog,
  useAgents,
} from './agent-store';
import { defaultAgentId } from './agent-defaults';
import {
  activeTab,
  closeTab,
  editorController,
  openDiff,
  openFile,
  refreshTree,
  showBrowserTab,
  useFiles,
} from './files-store';
import { nextThreadNeedingYou } from './attention-store';
import { aiCommit, aiPullRequest, commitStaged, push, stageAll, syncNow } from './git-actions';
import {
  archiveSession,
  currentSession,
  cycleGroveProject,
  focusSessionList,
  openGroveSearch,
  useGrove,
  stepProjectSwitch,
  resumeProjectSwitch,
  openLauncher,
  renameSession,
  restartSession,
  selectIndex,
  selectRelative,
  selectSession,
  setProjectDefaultAgent,
  showWorkspace,
  createGroveTerminal,
  startDefaultSession,
  stopSession,
  toggleSessionList,
} from './grove-store';
import type { GroveSession } from './grove-model';
import { ipcError } from './ipc-error';
import type { DesignPending } from './mode';
import { updateSettings } from './settings-client';
import {
  closeOverlay,
  dispatchMode,
  openOverlay,
  openSettings,
  resetLayout,
  showRightView,
  showToast,
  useApp,
} from './store';
import { showRightTab } from './right-tabs';
import { checkForUpdates } from './update-store';
import { modeControl, nextValue, rotationOrder, selectValues, thinkingControl } from './thread-controls';
import {
  activePane,
  createTerminal,
  focusActiveTerminal,
  placeTerminal,
  useTerminals,
  type SplitDirection,
} from './terminal-store';

export const commands = new CommandRegistry();

/** xterm-level actions, provided by the mounted Terminal panel. */
export interface TerminalPanelController {
  clear(): void;
  find(): void;
}

let terminalPanel: TerminalPanelController | null = null;
let pendingTerminalAction: ((controller: TerminalPanelController) => void) | null = null;

export function setTerminalPanelController(controller: TerminalPanelController | null): void {
  terminalPanel = controller;
  if (controller && pendingTerminalAction) {
    const action = pendingTerminalAction;
    pendingTerminalAction = null;
    action(controller);
  }
}

/** Runs `action` on the Terminal panel, showing the panel first (it is lazy) if needed. */
function withTerminalPanel(action: (controller: TerminalPanelController) => void): void {
  withProject((w) => {
    w.showBottomTab('terminal');
    if (terminalPanel) action(terminalPanel);
    else pendingTerminalAction = action;
  });
}

export interface FileLocation {
  readonly path: string;
  readonly line: number;
  readonly column?: number;
}

/**
 * Terminal `path:line:col` links and agent tool-call locations land here. Paths may be absolute or
 * relative to the project; files outside the project are not opened.
 */
export function openFileAtLocation(location?: FileLocation): void {
  const project = useApp.getState().project;
  if (!project) return;
  if (!location) {
    useFiles.setState({ quickOpen: true });
    return;
  }
  const path = toProjectPath(location.path, project.path);
  if (path === null || path === '') {
    showToast(`${location.path} is outside the project`);
    return;
  }
  useApp.setState({ settingsOpen: false });
  openFile(path, {
    pinned: true,
    at: { line: location.line, ...(location.column !== undefined ? { column: location.column } : {}) },
  });
}

/** Opens a diff tab in the right column. */
export function openDiffTab(diff: Parameters<typeof openDiff>[0]): void {
  useApp.setState({ settingsOpen: false });
  openDiff(diff);
}

/** The active file tab's path, or null with a toast. */
function activeFilePath(): string | null {
  const tab = activeTab();
  if (tab?.kind === 'file') return tab.path;
  showToast('Open a file first');
  return null;
}

/** Folder that "New File" targets: the selected folder, or the selected file's folder. */
function newEntryFolder(): string {
  const { selected, children } = useFiles.getState();
  if (selected === null) return '';
  const entry = children[parentPath(selected)]?.find((e) => e.path === selected);
  return entry?.kind === 'directory' ? selected : parentPath(selected);
}

function compareWithSaved(): void {
  const path = activeFilePath();
  if (!path) return;
  const texts = editorController()?.texts(path);
  if (!texts) {
    showToast('Only text files can be compared');
    return;
  }
  openDiff({
    path,
    title: `${baseName(path)} (saved ↔ editor)`,
    left: texts.saved,
    right: texts.current,
    leftLabel: `${baseName(path)} (on disk)`,
    rightLabel: `${baseName(path)} (editor)`,
  });
}

function newTerminal(split?: SplitDirection): void {
  withProject((w) => {
    w.showBottomTab('terminal');
    createTerminal(split).then(focusActiveTerminal, (error: unknown) =>
      showToast(`Could not start a terminal: ${(error as Error).message}`),
    );
  });
}

export async function runDevServer(): Promise<void> {
  if (!hasProject()) return;
  useTerminals.setState({ devStarting: true });
  withProject((w) => w.showBottomTab('terminal'));
  try {
    const result = await window.arbora.invoke('devServer.run', useTerminals.getState().lastSize);
    if (result.error) showToast(result.error);
    const terminal = result.terminal;
    if (terminal) {
      useTerminals.setState((s) => ({
        terminals: s.terminals.some((t) => t.id === terminal.id) ? s.terminals : [...s.terminals, terminal],
        ...(s.tabs.some((t) => t.panes.includes(terminal.id))
          ? { activeTabId: s.tabs.find((t) => t.panes.includes(terminal.id))?.id ?? null, activePaneId: terminal.id }
          : placeTerminal(s, terminal.id, null)),
      }));
    }
  } catch (error) {
    showToast(`Could not run the dev server: ${(error as Error).message}`);
  } finally {
    useTerminals.setState({ devStarting: false });
  }
}

/** Imperative panel controls, provided by the mounted workspace layout. */
export interface WorkspaceController {
  toggleSidebar(): void;
  toggleAgentPanel(): void;
  showAgentPanel(): void;
  toggleBottomPanel(): void;
  /** Collapses the tree and the chat so the content pane fills the window, or puts them back. */
  toggleMaximizeRight(): void;
  /** Hides the content pane and the side column, or shows them again. */
  toggleContentPane(): void;
  showSidebarView(view: SidebarView): void;
  showBottomTab(tab: BottomTab): void;
  /** Expands a collapsed panel. */
  revealPanel(panel: Exclude<WorkspacePanel, 'center'>): void;
}

let workspace: WorkspaceController | null = null;
/** A command that needs the shell's panels, waiting for them to mount. */
let pendingWorkspaceAction: ((controller: WorkspaceController) => void) | null = null;

export function setWorkspaceController(controller: WorkspaceController | null): void {
  workspace = controller;
  if (controller && pendingWorkspaceAction) {
    const action = pendingWorkspaceAction;
    pendingWorkspaceAction = null;
    // The panel groups measure on their first layout; expanding a panel before that is lost.
    requestAnimationFrame(() => action(controller));
  }
}

/** Runs `action` on the shell's panels, once they are mounted. */
function withProject(action: (controller: WorkspaceController) => void): void {
  if (!useApp.getState().project) {
    showToast('Open a project first');
    return;
  }
  if (workspace) action(workspace);
  else pendingWorkspaceAction = action;
}

/** Shows a thread in the chat column. */
export function revealThread(threadId: string): void {
  useApp.setState({ settingsOpen: false, overlay: null });
  workspace?.showAgentPanel();
  selectSession(threadId);
}

const THEME_CYCLE: Readonly<Record<ThemeMode, ThemeMode>> = { system: 'light', light: 'dark', dark: 'system' };

/** Runs a Grove action; the shell always shows Grove, so this is a plain call. */
function withGrove(action: () => void): void {
  action();
}

/** The ACP log below the Grove selection's transcript; fetched the first time it opens. */
function toggleGroveLog(): void {
  const session = currentSession();
  if (!session) {
    showToast('Select an agent first');
    return;
  }
  toggleLog();
  if (useAgents.getState().logOpen) void loadThread(session.id, { log: true }).catch(() => undefined);
}

/** Runs `action` on the Grove selection; `listedOnly` refuses an archived one. */
function withGroveSession(action: (session: GroveSession) => void, listedOnly = false): void {
  withGrove(() => {
    const session = currentSession();
    if (!session) showToast('Select an agent first');
    else if (listedOnly && !isListed(session)) showToast(`${session.name} is archived. Restore it first.`);
    else action(session);
  });
}

/**
 * While onboarding asks the user to press the mode or workspace chords, it takes them instead of
 * the commands (main intercepts them before any renderer keydown, so this is the only place to see
 * them).
 */
let chordProbe: ((commandId: string) => boolean) | null = null;

export function setChordProbe(probe: ((commandId: string) => boolean) | null): void {
  chordProbe = probe;
}

export function toggleMode(mode: 'agent' | 'design'): void {
  if (chordProbe?.(mode === 'agent' ? CommandId.agentMode : CommandId.designMode)) return;
  const enter = (): void => {
    if (!useApp.getState().project) {
      showToast('Open a project first');
      return;
    }
    // Both modes act on the selected project's page.
    if (mode === 'agent' ? useApp.getState().mode.kind !== 'agent' : useApp.getState().mode.kind !== 'design') {
      showBrowserTab();
      workspace?.revealPanel('bottom');
    }
    dispatchMode({ type: mode === 'agent' ? 'toggleAgent' : 'toggleDesign' });
  };
  enter();
}

function designPending(): DesignPending {
  const mode = useApp.getState().mode;
  return mode.kind === 'design' && mode.phase === 'confirm' ? mode.pending : 'idle';
}

/** After design mode's edits were sent or discarded, go where the user was heading. */
function continueAfterDesign(pending: DesignPending): void {
  switch (pending) {
    case 'idle':
      return;
    case 'agent':
      dispatchMode({ type: 'toggleAgent' });
      return;
    case 'grove':
      void resumeProjectSwitch();
      return;
    default: {
      const unreachable: never = pending;
      throw new Error(`Unknown design destination ${String(unreachable)}`);
    }
  }
}

/** A new thread with the default agent and its default model, if that agent is signed in and shown. */
export function defaultDesignTarget(): AgentModeTarget | null {
  const { agents: settings, tasks } = useApp.getState().settings;
  const pickable = useAgents.getState().agents.filter((agent) => isPickableAgent(settings, agent.id));
  const agent =
    pickable.find((entry) => entry.id === tasks.design.agentId) ??
    pickable.find((entry) => entry.id === defaultAgentId()) ??
    pickable[0];
  if (!agent) return null;
  const models = visibleModels(settings, agent.id);
  const taskModel = tasks.design.agentId === agent.id ? tasks.design.model : null;
  const model = models.find((m) => m.value === taskModel)?.value ?? models[0]?.value;
  return { type: 'new', agentId: agent.id, ...(model ? { model } : {}) };
}

/** Saves the live design edits and opens the thread that received them. */
export async function saveDesignTo(target: AgentModeTarget | null): Promise<void> {
  if (!target) {
    showToast('No signed-in agent. Check your agents in Settings (Mod+,).');
    return;
  }
  const pending = designPending();
  try {
    const { threadId } = await window.arbora.invoke('design.save', { target });
    dispatchMode({ type: 'designLeave' });
    await showAgentThread(threadId);
    continueAfterDesign(pending);
  } catch (error) {
    showToast(ipcError(error));
  }
}

/** Reverts the live DOM and leaves design mode. */
export async function discardDesign(): Promise<void> {
  const pending = designPending();
  try {
    await window.arbora.invoke('design.discard');
    dispatchMode({ type: 'designLeave' });
    continueAfterDesign(pending);
  } catch (error) {
    showToast(ipcError(error));
  }
}

/** Asks where to save a design session as Markdown, and writes it. */
export async function exportDesignSession(id: string): Promise<void> {
  try {
    const { path } = await window.arbora.invoke('design.exportSession', { id });
    if (!path) return;
    const name = path.split(/[/\\]/).pop() ?? path;
    showToast(`Saved ${name}`);
  } catch (error) {
    showToast(ipcError(error));
  }
}

/** Sends a saved design session to an agent again. The live page is left alone. */
export async function resendDesignSession(id: string, target: AgentModeTarget | null): Promise<void> {
  if (!target) {
    showToast('No signed-in agent. Check your agents in Settings (Mod+,).');
    return;
  }
  try {
    const { threadId } = await window.arbora.invoke('design.resend', { id, target });
    if (useApp.getState().mode.kind === 'design') dispatchMode({ type: 'designLeave' });
    await showAgentThread(threadId);
  } catch (error) {
    showToast(ipcError(error));
  }
}

async function resendDesign(): Promise<void> {
  if (!hasProject()) return;
  let sessions = useApp.getState().design.sessions;
  if (sessions.length === 0) {
    sessions = await window.arbora.invoke('design.listSessions');
    useApp.setState((s) => ({ design: { ...s.design, sessions } }));
  }
  const latest = sessions[0];
  if (!latest) {
    showToast('No design sessions yet');
    return;
  }
  const target = defaultDesignTarget();
  if (!target) {
    showToast('Choose an agent');
    return;
  }
  try {
    const { threadId } = await window.arbora.invoke('design.resend', { id: latest.id, target });
    if (useApp.getState().mode.kind === 'design') dispatchMode({ type: 'designLeave' });
    await showAgentThread(threadId);
  } catch (error) {
    showToast(ipcError(error));
  }
}

async function runDesignCommand(command: DesignCommand): Promise<void> {
  if (useApp.getState().mode.kind !== 'design') return;
  try {
    await window.arbora.invoke('design.command', command);
  } catch (error) {
    showToast(ipcError(error));
  }
}

/** The thread in the chat column, if it is listed. */
function groveThread(): ThreadSummary | undefined {
  const id = useApp.getState().layout.groveThreadId;
  return useAgents.getState().threads.find((t) => t.id === id && isListed(t));
}

/** The thread on screen, or null with a toast saying why nothing happened. */
function shownThread(): ThreadSummary | null {
  const thread = groveThread();
  if (!thread) {
    showToast('Open a thread first');
    return null;
  }
  return thread;
}

/** Whether the open thread has the control a menu shortcut asks for. */
function openThreadControl(kind: 'model' | 'mode'): boolean {
  const thread = shownThread();
  if (!thread) return false;
  const has =
    kind === 'model'
      ? thread.state.configOptions.some((o) => o.type === 'select' && o.category === 'model')
      : modeControl(thread.state) !== null;
  if (!has) showToast(kind === 'model' ? 'This agent has no model choice' : 'This agent has no modes');
  return has;
}

/** Shift+Tab: the next mode, as in the agent CLIs (Ask → Code → …, Build → Plan → …). */
async function cycleThreadMode(): Promise<void> {
  const thread = shownThread();
  if (!thread) return;
  const control = modeControl(thread.state);
  if (!control) {
    showToast('This agent has no modes');
    return;
  }
  const values =
    control.kind === 'config'
      ? selectValues(control.option).map((v) => ({ id: v.value, name: v.name }))
      : control.values.map((m) => ({ id: m.id, name: m.name }));
  const current = control.kind === 'config' ? control.option.currentValue : control.current;
  const refused = refusedModes.get(thread.id) ?? new Set<string>();
  const failures: string[] = [];
  // Agents can list a mode they then refuse (Claude Code's Bypass Permissions when it is not
  // allowed): skip it and keep rotating, so Shift+Tab never sticks on the mode before it.
  for (const id of rotationOrder(
    values.map((v) => v.id),
    current,
    refused,
  )) {
    try {
      if (control.kind === 'config') {
        await window.arbora.invoke('agent.setConfigOption', {
          threadId: thread.id,
          configId: control.option.id,
          value: id,
        });
      } else {
        await window.arbora.invoke('agent.setMode', { threadId: thread.id, modeId: id });
      }
      break;
    } catch (error) {
      refused.add(id);
      refusedModes.set(thread.id, refused);
      failures.push(`${values.find((v) => v.id === id)?.name ?? id}: ${ipcError(error)}`);
    }
  }
  if (failures.length > 0) showToast(`The agent refused ${failures.join('; ')}. Skipped it.`);
}

/** Modes an agent refused per thread, skipped by Shift+Tab until the app restarts. */
const refusedModes = new Map<string, Set<string>>();

/** Alt+T: the next thinking level, or thinking on/off for agents with a switch. */
async function cycleThreadThinking(): Promise<void> {
  const thread = shownThread();
  if (!thread) return;
  const control = thinkingControl(thread.state);
  try {
    if (!control) {
      showToast('This agent has no thinking setting');
    } else if (control.kind === 'boolean') {
      await window.arbora.invoke('agent.setConfigOption', {
        threadId: thread.id,
        configId: control.option.id,
        value: !control.option.currentValue,
      });
    } else {
      const value = nextValue(
        selectValues(control.option).map((v) => v.value),
        control.option.currentValue,
      );
      if (value) {
        await window.arbora.invoke('agent.setConfigOption', {
          threadId: thread.id,
          configId: control.option.id,
          value,
        });
      }
    }
  } catch (error) {
    showToast(ipcError(error));
  }
}

/** Shows `threadId` where threads show now (agent mode and design mode hand their prompt over to it). */
export async function showAgentThread(threadId: string): Promise<void> {
  workspace?.showAgentPanel();
  selectSession(threadId);
  return Promise.resolve();
}

const DEFAULT_DEV_URL = 'http://localhost:5173';

function hasProject(): boolean {
  if (useApp.getState().project) return true;
  showToast('Open a project first');
  return false;
}

async function browserAction(action: BrowserAction): Promise<void> {
  if (hasProject()) await window.arbora.invoke('browser.action', { action });
}

async function setViewport(preset: ViewportPresetId): Promise<void> {
  if (hasProject()) await window.arbora.invoke('browser.setPreset', { preset });
}

export async function navigateBrowser(url: string): Promise<void> {
  const result = await window.arbora.invoke('browser.navigate', { url });
  if (!result.ok) showToast(result.error ?? `Could not open ${url}`);
  else useApp.setState({ suggestedUrl: null });
}

/**
 * Grove terminal link or dev-server confirmation: `showWorkspace('browser')`, open that project on
 * this window, then load the URL. The same project still switches and navigates. No project path
 * keeps the window's current project.
 */
export async function openGroveWebsite(action: GroveWebsiteAction): Promise<void> {
  const current = useApp.getState().project?.path ?? null;
  if (action.openProject && action.openProject !== current) {
    try {
      const result = await window.arbora.invoke('project.open', {
        path: action.openProject,
        onThisWindow: true,
        url: action.navigate,
      });
      if (result.focusedElsewhere) return;
      if (!result.opened) showToast(result.error ?? 'Could not open that project');
    } catch (error) {
      showToast(ipcError(error));
    }
  }
  if (!showWorkspace(action.switchWorkspace)) return;
  await navigateBrowser(action.navigate);
}

async function takeScreenshot(mode: ScreenshotRequest['mode']): Promise<void> {
  const project = useApp.getState().project;
  if (!hasProject() || !project) return;
  try {
    const shot = await window.arbora.invoke('browser.screenshot', { mode, save: true });
    const path = shot.path?.startsWith(project.path) ? shot.path.slice(project.path.length + 1) : shot.path;
    showToast(`Screenshot saved (${shot.width}×${shot.height}): ${path ?? ''}`);
  } catch (error) {
    showToast(
      `Screenshot failed: ${(error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`,
    );
  }
}

const LANDMARK_SELECTOR = '[data-landmark]';
const FOCUSABLE =
  'input:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * The parked page had the keyboard (it failed to load, or the tab is empty). Focus the content
 * pane's DOM so `Ctrl+Alt+Left`/`Right` and `Mod+1`..`9` keep working. A live page parked only
 * for a menu or dialog is left alone; so is an open palette.
 */
export function reclaimFocusFromParkedPage(): void {
  const { paletteOpen, overlay, browser } = useApp.getState();
  const { searchOpen, launcherOpen, projectSwitch } = useGrove.getState();
  if (paletteOpen || overlay !== null || searchOpen || launcherOpen || projectSwitch !== null) return;
  if (browserViewAcceptsFocus(browser)) return;
  const pane = document.querySelector<HTMLElement>('[data-landmark="center"]');
  if (!pane || pane.contains(document.activeElement)) return;
  focusWithin(pane);
}

/** Focuses a panel's `data-panel-focus` element (the file tree, the commit box), else its first control. */
function focusWithin(target: HTMLElement): void {
  const visible = (el: HTMLElement): boolean => el.offsetParent !== null;
  const inner =
    [...target.querySelectorAll<HTMLElement>('[data-panel-focus]')].find(visible) ??
    [...target.querySelectorAll<HTMLElement>(FOCUSABLE)].find(visible);
  if (inner) inner.focus();
  else {
    if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
    target.focus();
  }
}

/** F6 / Shift+F6: moves focus to the next visible landmark (title bar, sidebar, centre, agent, bottom). */
export function focusLandmark(direction: 1 | -1): void {
  const landmarks = [...document.querySelectorAll<HTMLElement>(LANDMARK_SELECTOR)].filter(
    (el) => el.offsetWidth > 0 && el.offsetHeight > 0,
  );
  if (landmarks.length === 0) return;
  const current = landmarks.findIndex((el) => el.contains(document.activeElement));
  const start = current === -1 ? (direction === 1 ? -1 : 0) : current;
  const target = landmarks[(start + direction + landmarks.length) % landmarks.length];
  if (target) focusWithin(target);
}

function focusAgentComposer(): void {
  const listed = useAgents.getState().threads.some(isListed);
  if (groveThread()) focusComposer();
  else if (listed) focusSessionList();
  else openLauncher();
}

/** `Mod+1`..`Mod+4`: expands the panel if it is collapsed and puts the keyboard in it. */
export function focusPanel(panel: WorkspacePanel): void {
  withProject((controller) => {
    if (panel !== 'center') controller.revealPanel(panel);
    focusPanelSoon(panel);
  });
}

function focusPanelSoon(panel: WorkspacePanel): void {
  // Let an expanded panel lay out before focusing inside it.
  requestAnimationFrame(() => {
    const landmark = document.querySelector<HTMLElement>(`[data-landmark="${panel}"]`);
    switch (panel) {
      case 'sidebar':
        if (landmark) focusWithin(landmark);
        return;
      case 'center': {
        const { settingsOpen, browser, layout } = useApp.getState();
        if (layout.contentHidden) workspace?.toggleContentPane();
        if (!settingsOpen && layout.rightView === 'editor' && useFiles.getState().active !== null)
          editorController()?.focus();
        else if (!settingsOpen && layout.rightView === 'terminal') focusActiveTerminal();
        else if (!settingsOpen && layout.rightView === 'browser' && browserViewAcceptsFocus(browser))
          void window.arbora.invoke('browser.action', { action: 'focusPage' });
        else if (landmark) focusWithin(landmark);
        return;
      }
      case 'bottom':
        showRightView('terminal');
        focusActiveTerminal();
        return;
      case 'agent':
        if (useApp.getState().mode.kind !== 'design' && groveThread()) focusAgentComposer();
        else if (landmark) focusWithin(landmark);
        return;
      default: {
        const unreachable: never = panel;
        throw new Error(`Unknown panel ${String(unreachable)}`);
      }
    }
  });
}

/** The shell's columns from left to right; up and down stay in the column. */
const SHELL_COLUMNS = ['tree', 'agent', 'center', 'sidebar'] as const;

function focusNeighbour(direction: 'left' | 'right' | 'up' | 'down'): void {
  if (direction === 'up' || direction === 'down') return;
  // The page lives in the right column; main moved keyboard focus to the app before sending this.
  const landmark =
    invokedFromPage || !document.hasFocus()
      ? 'center'
      : document.activeElement?.closest<HTMLElement>(LANDMARK_SELECTOR)?.dataset['landmark'];
  const at = SHELL_COLUMNS.findIndex((column) => column === landmark);
  const next = SHELL_COLUMNS[(at === -1 ? 2 : at) + (direction === 'left' ? -1 : 1)];
  if (next === 'tree') focusSessionList();
  else if (next) focusPanel(next);
}

function showAttentionThread(): void {
  const threadId = nextThreadNeedingYou();
  if (!threadId) {
    showToast('No agent needs you');
    return;
  }
  if (hasProject()) revealThread(threadId);
}

async function exportDiagnostics(): Promise<void> {
  try {
    const { path } = await window.arbora.invoke('diagnostics.export');
    if (path) showToast(`Diagnostics saved to ${path}`);
  } catch (error) {
    showToast(`Could not export diagnostics: ${ipcError(error)}`);
  }
}

async function toggleSetting(kind: 'notifications' | 'sounds'): Promise<void> {
  const enabled = !useApp.getState().settings[kind].enabled;
  await updateSettings(kind === 'notifications' ? { notifications: { enabled } } : { sounds: { enabled } });
  showToast(`Agent ${kind} ${enabled ? 'on' : 'off'}`);
}

async function runCommand(id: CommandId): Promise<void> {
  const { arbora } = window;
  switch (id) {
    case CommandId.commandPalette:
      useApp.setState((s) => ({ paletteOpen: !s.paletteOpen }));
      return;
    case CommandId.agentMode:
      toggleMode('agent');
      return;
    case CommandId.designMode:
      toggleMode('design');
      return;
    case CommandId.exitMode:
      dispatchMode({ type: 'exit' });
      return;
    case CommandId.quickOpen:
      if (hasProject()) useFiles.setState((s) => ({ quickOpen: !s.quickOpen }));
      return;
    case CommandId.openProject: {
      const result = await arbora.invoke('project.open', {});
      if (result.error) showToast(result.error);
      return;
    }
    case CommandId.closeProject:
      await arbora.invoke('project.close');
      return;
    case CommandId.toggleTheme: {
      const theme = await arbora.invoke('theme.set', { mode: THEME_CYCLE[useApp.getState().theme.mode] });
      useApp.setState({ theme });
      showToast(`Theme: ${theme.mode}`);
      return;
    }
    case CommandId.toggleSidebar:
      toggleSessionList();
      return;
    case CommandId.toggleSideColumn:
      withProject((w) => w.toggleSidebar());
      return;
    case CommandId.toggleAgentPanel:
      withProject((w) => w.toggleAgentPanel());
      return;
    case CommandId.toggleBottomPanel:
      withProject((w) => w.toggleBottomPanel());
      return;
    case CommandId.rightTab1:
    case CommandId.rightTab2:
    case CommandId.rightTab3:
    case CommandId.rightTab4:
    case CommandId.rightTab5:
    case CommandId.rightTab6:
    case CommandId.rightTab7:
    case CommandId.rightTab8:
    case CommandId.rightTab9:
      withProject((w) => {
        if (useApp.getState().layout.contentHidden) w.toggleContentPane();
        w.revealPanel('bottom');
        showRightTab(rightTabIndex(id) ?? 0);
      });
      return;
    case CommandId.toggleMaximizeRight:
      if (!chordProbe?.(id)) withProject((w) => w.toggleMaximizeRight());
      return;
    case CommandId.toggleContentPane:
      if (!chordProbe?.(id)) withProject((w) => w.toggleContentPane());
      return;
    case CommandId.resetLayout:
      if (hasProject()) resetLayout();
      return;
    case CommandId.openSettings:
      useApp.setState((s) => ({ settingsOpen: !s.settingsOpen, paletteOpen: false }));
      return;
    case CommandId.openSettingsFile:
      await arbora.invoke('settings.openFile');
      return;
    case CommandId.openProjectSettingsFile:
      if (useApp.getState().project) await arbora.invoke('project.openSettingsFile');
      else showToast('Open a project first');
      return;
    case CommandId.showFiles:
      withProject((w) => w.showSidebarView('files'));
      return;
    case CommandId.showGitSidebar:
      withProject((w) => w.showSidebarView('git'));
      return;
    case CommandId.showSearch:
      withProject((w) => w.showSidebarView('search'));
      return;
    case CommandId.showTerminal:
      withProject((w) => {
        w.showBottomTab('terminal');
        focusActiveTerminal();
      });
      return;
    case CommandId.showGitPanel:
      withProject((w) => w.showBottomTab('git'));
      return;
    case CommandId.showProblems:
      withProject((w) => w.showBottomTab('problems'));
      return;
    case CommandId.reloadWindow:
      await arbora.invoke('window.control', { action: 'reload' });
      return;
    case CommandId.toggleAppDevTools:
      await arbora.invoke('window.control', { action: 'toggleDevTools' });
      return;
    case CommandId.browserFocusUrl:
      if (hasProject()) {
        showBrowserTab();
        useApp.setState((s) => ({ urlFocusRequest: s.urlFocusRequest + 1 }));
      }
      return;
    case CommandId.browserOpenDevUrl: {
      const project = useApp.getState().project;
      if (!project) {
        showToast('Open a project first');
        return;
      }
      showBrowserTab();
      await navigateBrowser(project.settings.devUrl ?? DEFAULT_DEV_URL);
      return;
    }
    case CommandId.browserBack:
      await browserAction('back');
      return;
    case CommandId.browserForward:
      await browserAction('forward');
      return;
    case CommandId.browserReload:
      await browserAction('reload');
      return;
    case CommandId.browserHardReload:
      await browserAction('hardReload');
      return;
    case CommandId.browserOpenExternal:
      if (hasProject()) await arbora.invoke('browser.action', { action: 'openExternal' });
      return;
    case CommandId.browserToggleDevTools:
      await browserAction('toggleDevTools');
      return;
    case CommandId.browserZoomIn:
      await browserAction('zoomIn');
      return;
    case CommandId.browserZoomOut:
      await browserAction('zoomOut');
      return;
    case CommandId.browserZoomReset:
      await browserAction('zoomReset');
      return;
    case CommandId.browserViewportResponsive:
      await setViewport('responsive');
      return;
    case CommandId.browserViewportMobile:
      await setViewport('mobile');
      return;
    case CommandId.browserViewportTablet:
      await setViewport('tablet');
      return;
    case CommandId.browserViewportLaptop:
      await setViewport('laptop');
      return;
    case CommandId.browserViewportDesktop:
      await setViewport('desktop');
      return;
    case CommandId.browserScreenshot:
      await takeScreenshot('viewport');
      return;
    case CommandId.browserFullPageScreenshot:
      await takeScreenshot('fullPage');
      return;
    case CommandId.browserClearProblems:
      if (hasProject()) await arbora.invoke('browser.clearProblems');
      return;
    case CommandId.terminalNew:
      newTerminal();
      return;
    case CommandId.terminalSplitRight:
      newTerminal('horizontal');
      return;
    case CommandId.terminalSplitDown:
      newTerminal('vertical');
      return;
    case CommandId.terminalKill: {
      const pane = activePane();
      if (pane) await arbora.invoke('terminal.kill', { id: pane.id });
      else if (hasProject()) showToast('No terminal is open');
      return;
    }
    case CommandId.terminalClear:
      withTerminalPanel((c) => c.clear());
      return;
    case CommandId.terminalFind:
      withTerminalPanel((c) => c.find());
      return;
    case CommandId.terminalRename: {
      const pane = activePane();
      if (!pane) {
        if (hasProject()) showToast('No terminal is open');
        return;
      }
      withProject((w) => {
        w.showBottomTab('terminal');
        useTerminals.setState({ renamingId: pane.id });
      });
      return;
    }
    case CommandId.devServerRun:
    case CommandId.devServerRestart:
      await runDevServer();
      return;
    case CommandId.devServerStop:
      if (hasProject()) await arbora.invoke('devServer.stop');
      return;
    case CommandId.openFileAtLocation:
      openFileAtLocation();
      return;
    case CommandId.showBrowser:
      if (hasProject()) {
        useApp.setState({ settingsOpen: false });
        showBrowserTab();
      }
      return;
    case CommandId.editorSave: {
      const tab = activeTab();
      if (tab?.kind === 'file') await editorController()?.save(tab.path);
      return;
    }
    case CommandId.editorCloseTab: {
      const active = useFiles.getState().active;
      if (active) closeTab(active);
      // macOS convention: Cmd+W with nothing left to close closes the window.
      else if (useApp.getState().info.platform === 'darwin') await arbora.invoke('window.control', { action: 'close' });
      return;
    }
    case CommandId.editorFormat: {
      const path = activeFilePath();
      if (path) await editorController()?.format(path);
      return;
    }
    case CommandId.editorCompareWithSaved:
      if (activeFilePath()) compareWithSaved();
      return;
    case CommandId.filesNewFile:
    case CommandId.filesNewFolder:
      withProject((w) => {
        w.showSidebarView('files');
        useFiles.setState({
          creating: { dir: newEntryFolder(), kind: id === CommandId.filesNewFile ? 'file' : 'directory' },
        });
      });
      return;
    case CommandId.filesRevealInOS: {
      const path = activeFilePath();
      if (path) await arbora.invoke('files.reveal', { path });
      return;
    }
    case CommandId.filesRefresh:
      if (hasProject()) await refreshTree();
      return;
    case CommandId.agentNewThread:
      // The picker opens on the default agent, so the shortcut then Enter starts it.
      openLauncher();
      return;
    case CommandId.agentFocusComposer:
      focusAgentComposer();
      return;
    case CommandId.agentCancel: {
      const thread = groveThread();
      if (thread && isStoppable(thread.state.status)) await stopAgent(thread.id);
      else if (hasProject()) showToast('The agent is not working on anything');
      return;
    }
    case CommandId.agentToggleLog:
      toggleGroveLog();
      return;
    case CommandId.agentShowThreads:
      focusSessionList();
      return;
    case CommandId.agentCycleMode:
      await cycleThreadMode();
      return;
    case CommandId.agentPickMode:
      if (openThreadControl('mode')) useAgents.setState((s) => ({ modeMenuRequest: s.modeMenuRequest + 1 }));
      return;
    case CommandId.agentPickModel:
      if (openThreadControl('model')) useAgents.setState((s) => ({ modelMenuRequest: s.modelMenuRequest + 1 }));
      return;
    case CommandId.agentCycleThinking:
      await cycleThreadThinking();
      return;
    case CommandId.designUndo:
      await runDesignCommand({ type: 'undo' });
      return;
    case CommandId.designRedo:
      await runDesignCommand({ type: 'redo' });
      return;
    case CommandId.designDuplicate:
      await runDesignCommand({ type: 'duplicate' });
      return;
    case CommandId.designSave:
      await saveDesignTo(defaultDesignTarget());
      return;
    case CommandId.designDiscard:
      await discardDesign();
      return;
    case CommandId.designResend:
      await resendDesign();
      return;
    case CommandId.switchProject:
      if (useApp.getState().overlay === 'switcher') closeOverlay('switcher');
      else openOverlay('switcher');
      return;
    case CommandId.showOnboarding:
      openOverlay('onboarding');
      return;
    case CommandId.checkForUpdates:
      await checkForUpdates();
      return;
    case CommandId.exportDiagnostics:
      await exportDiagnostics();
      return;
    case CommandId.showKeybindings:
      if (useApp.getState().overlay === 'keybindings') closeOverlay('keybindings');
      else openOverlay('keybindings');
      return;
    case CommandId.openKeyboardShortcuts:
      openSettings('keyboard');
      return;
    case CommandId.toggleNotifications:
      await toggleSetting('notifications');
      return;
    case CommandId.toggleSounds:
      await toggleSetting('sounds');
      return;
    case CommandId.focusSidebarPanel:
      focusPanel('sidebar');
      return;
    case CommandId.focusCenterPanel:
      focusPanel('center');
      return;
    case CommandId.focusBottomPanel:
      focusPanel('bottom');
      return;
    case CommandId.focusAgentPanel:
      focusPanel('agent');
      return;
    case CommandId.focusPanelLeft:
      focusNeighbour('left');
      return;
    case CommandId.focusPanelRight:
      focusNeighbour('right');
      return;
    case CommandId.focusPanelUp:
      focusNeighbour('up');
      return;
    case CommandId.focusPanelDown:
      focusNeighbour('down');
      return;
    case CommandId.focusNextPanel:
      focusLandmark(1);
      return;
    case CommandId.focusPreviousPanel:
      focusLandmark(-1);
      return;
    case CommandId.browserResetData:
      if (!hasProject()) return;
      showToast('Clear cookies, storage and cache for this project’s browser?', {
        label: 'Reset',
        run: () => {
          void arbora
            .invoke('browser.resetData')
            .then(() => showToast('Browser data cleared'))
            .catch((error: unknown) => showToast(`Could not reset: ${ipcError(error)}`));
        },
      });
      return;
    case CommandId.agentShowAttention:
      showAttentionThread();
      return;
    case CommandId.agentNewGroup:
      requestNewGroup();
      return;
    case CommandId.gitStageAll:
      if (hasProject()) void stageAll();
      return;
    case CommandId.gitCommit:
      withProject((w) => {
        w.showSidebarView('git');
        void commitStaged();
      });
      return;
    case CommandId.gitPush:
      if (hasProject()) void push();
      return;
    case CommandId.gitSync:
      if (hasProject()) void syncNow();
      return;
    case CommandId.gitAiCommit:
      if (hasProject()) void aiCommit();
      return;
    case CommandId.gitAiPullRequest:
      if (hasProject()) void aiPullRequest();
      return;
    case CommandId.groveNewDefault:
      startDefaultSession();
      return;
    case CommandId.groveNewTerminal:
      withGrove(() => {
        void createGroveTerminal();
      });
      return;
    case CommandId.groveLaunch:
      openLauncher();
      return;
    case CommandId.groveFocusAgents:
      withGrove(() => focusSessionList());
      return;
    case CommandId.groveNextSession:
      withGrove(() => selectRelative(1));
      return;
    case CommandId.grovePreviousSession:
      withGrove(() => selectRelative(-1));
      return;
    case CommandId.groveSelectSession1:
    case CommandId.groveSelectSession2:
    case CommandId.groveSelectSession3:
    case CommandId.groveSelectSession4:
    case CommandId.groveSelectSession5:
    case CommandId.groveSelectSession6:
    case CommandId.groveSelectSession7:
    case CommandId.groveSelectSession8:
    case CommandId.groveSelectSession9:
      withGrove(() => selectIndex(groveSessionIndex(id) ?? 0));
      return;
    case CommandId.groveArchiveSession:
      withGrove(() => {
        const session = currentSession();
        // Nothing selected: no toast and no confirm. A running process still asks inside archiveSession.
        if (!session) return;
        if (!isListed(session)) {
          showToast(`${session.name} is archived. Restore it first.`);
          return;
        }
        archiveSession(session.id);
      });
      return;
    case CommandId.groveStopSession:
      withGroveSession((session) => void stopSession(session.id), true);
      return;
    case CommandId.groveRestartSession:
      withGroveSession((session) => void restartSession(session.id), true);
      return;
    case CommandId.groveRenameSession:
      withGroveSession((session) => renameSession(session.id), true);
      return;
    case CommandId.groveSetDefaultAgent:
      withGroveSession((session) => void setProjectDefaultAgent(session.agentId));
      return;
    case CommandId.groveSearch:
      openGroveSearch();
      return;
    case CommandId.groveNextProject:
      withGrove(() => cycleGroveProject(1));
      return;
    case CommandId.grovePreviousProject:
      withGrove(() => cycleGroveProject(-1));
      return;
    case CommandId.groveSwitchProject:
      withGrove(() => stepProjectSwitch(1));
      return;
    case CommandId.groveSwitchProjectBack:
      withGrove(() => stepProjectSwitch(-1));
      return;
    default: {
      const unreachable: never = id;
      throw new Error(`Unhandled command ${String(unreachable)}`);
    }
  }
}

/** Registers the built-in commands. Returns a disposer. */
export function registerBuiltinCommands(): () => void {
  const disposers = DEFAULT_COMMANDS.map((descriptor) => {
    const id = commandIdSchema.parse(descriptor.id);
    return commands.register({ ...descriptor, run: () => runCommand(id) });
  });
  return () => {
    for (const dispose of disposers) dispose();
  };
}

/** Set while a command that main caught on the browser page runs: focus is in the page, not the DOM. */
let invokedFromPage = false;

export function executeCommand(id: string, options: { fromPage?: boolean | undefined } = {}): void {
  invokedFromPage = options.fromPage === true;
  const run = commands.execute(id);
  invokedFromPage = false;
  void run.then((found) => {
    if (!found) console.warn(`[commands] unknown command ${id}`);
  });
}
