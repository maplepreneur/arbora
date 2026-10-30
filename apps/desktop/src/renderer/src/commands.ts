import {
  baseName,
  CommandId,
  CommandRegistry,
  commandIdSchema,
  DEFAULT_COMMANDS,
  isPickableAgent,
  parentPath,
  toProjectPath,
  visibleModels,
  type AgentModeTarget,
  type BottomTab,
  type BrowserAction,
  type DesignCommand,
  type ScreenshotRequest,
  type SidebarView,
  type ThemeMode,
  type ViewportPresetId,
} from '@arbora/shared';
import {
  activeThread,
  isStoppable,
  focusComposer,
  openThread,
  showPicker,
  showThreads,
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
import { dispatchMode, resetLayout, showToast, useApp } from './store';
import { modeControl, nextValue, selectValues, thinkingControl } from './thread-controls';
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
  if (!hasProject()) return;
  workspace?.showBottomTab('terminal');
  if (terminalPanel) action(terminalPanel);
  else pendingTerminalAction = action;
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

async function newTerminal(split?: SplitDirection): Promise<void> {
  if (!hasProject()) return;
  workspace?.showBottomTab('terminal');
  try {
    await createTerminal(split);
    focusActiveTerminal();
  } catch (error) {
    showToast(`Could not start a terminal: ${(error as Error).message}`);
  }
}

export async function runDevServer(): Promise<void> {
  if (!hasProject()) return;
  useTerminals.setState({ devStarting: true });
  workspace?.showBottomTab('terminal');
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
  showSidebarView(view: SidebarView): void;
  showBottomTab(tab: BottomTab): void;
}

let workspace: WorkspaceController | null = null;

export function setWorkspaceController(controller: WorkspaceController | null): void {
  workspace = controller;
}

/** Runs `action` with the agent panel visible. */
function withAgentPanel(action: () => void): void {
  if (!hasProject()) return;
  workspace?.showAgentPanel();
  action();
}

const THEME_CYCLE: Readonly<Record<ThemeMode, ThemeMode>> = { system: 'light', light: 'dark', dark: 'system' };

function withProject(action: (controller: WorkspaceController) => void): void {
  if (workspace) action(workspace);
  else showToast('Open a project first');
}

function toggleMode(mode: 'agent' | 'design'): void {
  if (!useApp.getState().project) {
    showToast('Open a project first');
    return;
  }
  // Both modes act on the page, so it has to be on screen.
  showBrowserTab();
  dispatchMode({ type: mode === 'agent' ? 'toggleAgent' : 'toggleDesign' });
}

function ipcError(error: unknown): string {
  return (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function designPending(): 'idle' | 'agent' {
  const mode = useApp.getState().mode;
  return mode.kind === 'design' && mode.phase === 'confirm' ? mode.pending : 'idle';
}

/** A new thread with the default agent and its default model, if that agent is signed in and shown. */
export function defaultDesignTarget(): AgentModeTarget | null {
  const settings = useApp.getState().settings.agents;
  const pickable = useAgents.getState().agents.filter((agent) => isPickableAgent(settings, agent.id));
  const preferred = defaultAgentId();
  const agent = pickable.find((entry) => entry.id === preferred) ?? pickable[0];
  if (!agent) return null;
  const model = visibleModels(settings, agent.id)[0]?.value;
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
    if (pending === 'agent') dispatchMode({ type: 'toggleAgent' });
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
    if (pending === 'agent') dispatchMode({ type: 'toggleAgent' });
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

/** The thread on screen in the agent panel, or null with a toast saying why nothing happened. */
function shownThread(): ReturnType<typeof activeThread> | null {
  const thread = useAgents.getState().view === 'thread' ? activeThread() : undefined;
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
  try {
    if (!control) {
      showToast('This agent has no modes');
    } else if (control.kind === 'config') {
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
    } else {
      const modeId = nextValue(
        control.values.map((m) => m.id),
        control.current,
      );
      if (modeId) await window.arbora.invoke('agent.setMode', { threadId: thread.id, modeId });
    }
  } catch (error) {
    showToast(ipcError(error));
  }
}

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

/** Shows the agent panel on `threadId` (agent mode hands its prompt over to the thread). */
export async function showAgentThread(threadId: string): Promise<void> {
  workspace?.showAgentPanel();
  await openThread(threadId);
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
      withProject((w) => w.toggleSidebar());
      return;
    case CommandId.toggleAgentPanel:
      withProject((w) => w.toggleAgentPanel());
      return;
    case CommandId.toggleBottomPanel:
      withProject((w) => w.toggleBottomPanel());
      return;
    case CommandId.resetLayout:
      withProject(() => resetLayout());
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
      if (project) showBrowserTab();
      if (project) await navigateBrowser(project.settings.devUrl ?? DEFAULT_DEV_URL);
      else showToast('Open a project first');
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
      await browserAction('openExternal');
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
      await newTerminal();
      return;
    case CommandId.terminalSplitRight:
      await newTerminal('horizontal');
      return;
    case CommandId.terminalSplitDown:
      await newTerminal('vertical');
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
      workspace?.showBottomTab('terminal');
      useTerminals.setState({ renamingId: pane.id });
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
      compareWithSaved();
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
      withAgentPanel(() => showPicker());
      return;
    case CommandId.agentFocusComposer:
      withAgentPanel(() => {
        const thread = activeThread();
        if (thread) {
          useAgents.setState({ view: 'thread' });
          focusComposer();
        } else if (useAgents.getState().threads.length > 0) {
          showThreads();
        } else {
          showPicker();
        }
      });
      return;
    case CommandId.agentCancel: {
      const thread = activeThread();
      if (thread && isStoppable(thread.state.status)) await stopAgent(thread.id);
      else if (hasProject()) showToast('The agent is not working on anything');
      return;
    }
    case CommandId.agentToggleLog:
      withAgentPanel(() => toggleLog());
      return;
    case CommandId.agentShowThreads:
      withAgentPanel(() => showThreads());
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

export function executeCommand(id: string): void {
  void commands.execute(id).then((found) => {
    if (!found) console.warn(`[commands] unknown command ${id}`);
  });
}
