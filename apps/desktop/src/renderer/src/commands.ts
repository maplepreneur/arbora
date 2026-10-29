import {
  CommandId,
  CommandRegistry,
  commandIdSchema,
  DEFAULT_COMMANDS,
  type BottomTab,
  type SidebarView,
  type ThemeMode,
} from '@arbora/shared';
import { resetLayout, setMode, showToast, useApp } from './store';

export const commands = new CommandRegistry();

/** Imperative panel controls, provided by the mounted workspace layout. */
export interface WorkspaceController {
  toggleSidebar(): void;
  toggleAgentPanel(): void;
  toggleBottomPanel(): void;
  showSidebarView(view: SidebarView): void;
  showBottomTab(tab: BottomTab): void;
}

let workspace: WorkspaceController | null = null;

export function setWorkspaceController(controller: WorkspaceController | null): void {
  workspace = controller;
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
      withProject((w) => w.showBottomTab('terminal'));
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
