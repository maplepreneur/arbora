import type {
  AppInfo,
  AppSettings,
  KeybindingsState,
  ProjectInfo,
  ThemeState,
  WindowState,
} from '@arbora/shared';
import { create } from 'zustand';

/** Interaction modes acting on the live page. Stage 4 and 6 give them real behaviour. */
export type Mode = 'idle' | 'agent' | 'design';

export type PanelId = 'sidebar' | 'agent' | 'bottom';

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: 'info' | 'error';
}

export interface AppStore {
  readonly appInfo: AppInfo;
  readonly settings: AppSettings;
  readonly theme: ThemeState;
  readonly keybindings: KeybindingsState;
  readonly project: ProjectInfo | null;
  readonly windowState: WindowState;
  readonly mode: Mode;
  readonly paletteOpen: boolean;
  readonly terminalFocused: boolean;
  /** Bumped to ask the layout to toggle a panel; the layout owns the imperative panel handles. */
  readonly panelToggle: { readonly panel: PanelId; readonly seq: number } | null;
  readonly toasts: readonly Toast[];
}

export interface InitialState {
  readonly appInfo: AppInfo;
  readonly settings: AppSettings;
  readonly theme: ThemeState;
  readonly keybindings: KeybindingsState;
  readonly project: ProjectInfo | null;
  readonly windowState: WindowState;
}

export function createAppStore(initial: InitialState) {
  return create<AppStore>()(() => ({
    ...initial,
    mode: 'idle',
    paletteOpen: false,
    terminalFocused: false,
    panelToggle: null,
    toasts: [],
  }));
}

export type AppStoreApi = ReturnType<typeof createAppStore>;
