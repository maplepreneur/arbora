import {
  CommandId,
  CommandRegistry,
  commandIdSchema,
  DEFAULT_COMMANDS,
  type BottomTab,
  type BrowserAction,
  type ScreenshotRequest,
  type SidebarView,
  type ThemeMode,
  type ViewportPresetId,
} from '@arbora/shared';
import { activeThread, cancelTurn, focusComposer, showPicker, showThreads, toggleLog, useAgents } from './agent-store';
import { resetLayout, setMode, showToast, useApp } from './store';
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

/** Terminal `path:line:col` links land here; the editor that opens them arrives in Stage 7. */
export function openFileAtLocation(location?: FileLocation): void {
  const where = location ? `${location.path}:${location.line}${location.column ? `:${location.column}` : ''}` : 'files';
  showToast(`Opening ${where} arrives with the editor (Stage 7)`);
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
  const next = useApp.getState().mode === mode ? 'idle' : mode;
  setMode(next);
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
      setMode('idle');
      return;
    case CommandId.quickOpen:
      showToast('Quick open arrives with the file explorer (Stage 7)');
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
      if (hasProject()) useApp.setState((s) => ({ urlFocusRequest: s.urlFocusRequest + 1 }));
      return;
    case CommandId.browserOpenDevUrl: {
      const project = useApp.getState().project;
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
    case CommandId.agentNewThread:
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
      if (thread?.state.status === 'prompting') await cancelTurn(thread.id);
      else if (hasProject()) showToast('The agent is not working on anything');
      return;
    }
    case CommandId.agentToggleLog:
      withAgentPanel(() => toggleLog());
      return;
    case CommandId.agentShowThreads:
      withAgentPanel(() => showThreads());
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
