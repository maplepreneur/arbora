import { CommandId, type OpenProjectResult } from '@arbora/shared';
import { showToast, type AppServices } from './context';
import type { Mode, PanelId } from './store';

export function reportOpenResult(services: AppServices, result: OpenProjectResult): void {
  switch (result.status) {
    case 'opened':
    case 'cancelled':
      break;
    case 'focused':
      showToast(services.store, 'That project is already open in another window.');
      break;
    case 'error':
      showToast(services.store, result.message, 'error');
      break;
    default: {
      const exhaustive: never = result;
      throw new Error(`Unhandled open result ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Registers the commands every window has. Later stages register theirs the same way. */
export function registerBuiltinCommands(services: AppServices): () => void {
  const { store, commands, bridge } = services;
  const hasProject = (): boolean => store.getState().project !== null;

  const toggleMode = (mode: Exclude<Mode, 'idle'>): void => {
    if (!hasProject()) return;
    store.setState((state) => ({ mode: state.mode === mode ? 'idle' : mode, paletteOpen: false }));
  };

  const togglePanel = (panel: PanelId): void => {
    if (!hasProject()) return;
    store.setState((state) => ({
      panelToggle: { panel, seq: (state.panelToggle?.seq ?? 0) + 1 },
    }));
  };

  const disposers = [
    commands.register({
      id: CommandId.agentMode,
      title: 'Toggle Agent Mode',
      category: 'Modes',
      run: () => {
        toggleMode('agent');
      },
      isVisible: hasProject,
    }),
    commands.register({
      id: CommandId.designMode,
      title: 'Toggle Design Mode',
      category: 'Modes',
      run: () => {
        toggleMode('design');
      },
      isVisible: hasProject,
    }),
    commands.register({
      id: CommandId.exitMode,
      title: 'Exit Mode',
      category: 'Modes',
      run: () => {
        store.setState({ mode: 'idle' });
      },
      isVisible: () => store.getState().mode !== 'idle',
    }),
    commands.register({
      id: CommandId.commandPalette,
      title: 'Show Command Palette',
      category: 'View',
      run: () => {
        store.setState((state) => ({ paletteOpen: !state.paletteOpen }));
      },
      isVisible: () => false,
    }),
    commands.register({
      id: CommandId.quickOpen,
      title: 'Go to File…',
      category: 'Files',
      run: () => {
        showToast(store, 'Quick open arrives with the file explorer.');
      },
      isVisible: hasProject,
    }),
    commands.register({
      id: CommandId.openProject,
      title: 'Open Project…',
      category: 'File',
      run: async () => {
        reportOpenResult(services, await bridge.invoke.openProjectDialog());
      },
    }),
    commands.register({
      id: CommandId.toggleTheme,
      title: 'Toggle Light/Dark Theme',
      category: 'Preferences',
      run: async () => {
        const resolved = store.getState().theme.resolved;
        await bridge.invoke.updateSettings({ theme: resolved === 'dark' ? 'light' : 'dark' });
      },
    }),
    commands.register({
      id: CommandId.useSystemTheme,
      title: 'Use System Theme',
      category: 'Preferences',
      run: async () => {
        await bridge.invoke.updateSettings({ theme: 'system' });
      },
      isVisible: () => store.getState().theme.source !== 'system',
    }),
    commands.register({
      id: CommandId.openSettingsJson,
      title: 'Open Settings (JSON)',
      category: 'Preferences',
      run: async () => {
        try {
          await bridge.invoke.openSettingsFile();
        } catch (error) {
          showToast(store, error instanceof Error ? error.message : String(error), 'error');
        }
      },
    }),
    commands.register({
      id: CommandId.toggleSidebar,
      title: 'Toggle Sidebar',
      category: 'View',
      run: () => {
        togglePanel('sidebar');
      },
      isVisible: hasProject,
    }),
    commands.register({
      id: CommandId.toggleAgentPanel,
      title: 'Toggle Agent Panel',
      category: 'View',
      run: () => {
        togglePanel('agent');
      },
      isVisible: hasProject,
    }),
    commands.register({
      id: CommandId.toggleBottomPanel,
      title: 'Toggle Bottom Panel',
      category: 'View',
      run: () => {
        togglePanel('bottom');
      },
      isVisible: hasProject,
    }),
  ];

  return () => {
    for (const dispose of disposers) dispose();
  };
}
