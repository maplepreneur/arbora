import { create } from 'zustand';
import {
  defaultSettings,
  layoutStateSchema,
  type AppInfo,
  type AppSettings,
  type LayoutState,
  type NavigationState,
  type PanelGroupLayout,
  type ProblemEntry,
  type ProjectInfo,
  type ThemeState,
  type WindowState,
} from '@arbora/shared';

/** Placeholder mode machine; Stage 4 expands agent mode to idle -> inspecting -> selected -> prompting. */
export type Mode = 'idle' | 'agent' | 'design';

export interface Toast {
  readonly id: number;
  readonly message: string;
}

export interface AppState {
  info: AppInfo;
  settings: AppSettings;
  theme: ThemeState;
  project: ProjectInfo | null;
  windowState: WindowState;
  layout: LayoutState;
  /** Bumped to remount panel groups with their default sizes. */
  layoutEpoch: number;
  mode: Mode;
  paletteOpen: boolean;
  terminalFocused: boolean;
  toasts: Toast[];
  /** Browser panel state from main; null until the project's browser view exists. */
  browser: NavigationState | null;
  /** Console, exception and network entries for the Problems tab, oldest first. */
  problems: ProblemEntry[];
  /** Dev-server URL offered by `browser.suggestUrl` while another page is open. */
  suggestedUrl: string | null;
  /** Bumped to move focus to the URL bar. */
  urlFocusRequest: number;
}

export interface InitialState {
  info: AppInfo;
  settings: AppSettings;
  theme: ThemeState;
  project: ProjectInfo | null;
  windowState: WindowState;
}

export const DEFAULT_LAYOUT: LayoutState = layoutStateSchema.parse({});

let nextToastId = 1;

export const useApp = create<AppState>()(() => ({
  // Placeholders; `initStore` replaces them with values from main before the first render.
  info: { name: 'arbora', version: '', platform: window.arbora.platform, isPackaged: false, tilingCompositor: null },
  settings: defaultSettings(),
  theme: { mode: 'system', resolved: 'light' },
  project: null,
  windowState: { maximized: false, fullScreen: false, focused: true },
  layout: DEFAULT_LAYOUT,
  layoutEpoch: 0,
  mode: 'idle',
  paletteOpen: false,
  terminalFocused: false,
  toasts: [],
  browser: null,
  problems: [],
  suggestedUrl: null,
  urlFocusRequest: 0,
}));

/** The Problems tab keeps at most this many entries (main keeps 500 console + 500 network). */
export const MAX_PROBLEMS = 1000;

export function initStore(initial: InitialState): void {
  useApp.setState({ ...initial, layout: initial.project?.layout ?? DEFAULT_LAYOUT });
}

export function setProject(project: ProjectInfo | null): void {
  const previous = useApp.getState().project;
  const switched = previous?.path !== project?.path;
  useApp.setState((s) => ({
    project,
    ...(switched
      ? {
          layout: project?.layout ?? DEFAULT_LAYOUT,
          layoutEpoch: s.layoutEpoch + 1,
          mode: 'idle' as const,
          paletteOpen: false,
          browser: null,
          problems: [],
          suggestedUrl: null,
        }
      : {}),
  }));
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persistLayout(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!useApp.getState().project) return;
    void window.arbora.invoke('project.saveLayout', { layout: useApp.getState().layout });
  }, 250);
}

export function updateLayout(patch: Partial<LayoutState>): void {
  useApp.setState((s) => ({ layout: { ...s.layout, ...patch } }));
  persistLayout();
}

export function setGroupLayout(groupId: string, layout: PanelGroupLayout): void {
  updateLayout({ groups: { ...useApp.getState().layout.groups, [groupId]: layout } });
}

export function resetLayout(): void {
  useApp.setState((s) => ({ layout: DEFAULT_LAYOUT, layoutEpoch: s.layoutEpoch + 1 }));
  persistLayout();
}

export function setMode(mode: Mode): void {
  useApp.setState({ mode });
}

export function showToast(message: string): void {
  const toast = { id: nextToastId++, message };
  useApp.setState((s) => ({ toasts: [...s.toasts, toast] }));
  setTimeout(() => useApp.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== toast.id) })), 3500);
}

export function addProblems(entries: readonly ProblemEntry[]): void {
  useApp.setState((s) => ({ problems: [...s.problems, ...entries].slice(-MAX_PROBLEMS) }));
}

/** Replaces the Problems list with main's buffers (console and network merged in arrival order). */
export function setProblems(consoleEntries: readonly ProblemEntry[], network: readonly ProblemEntry[]): void {
  useApp.setState({ problems: [...consoleEntries, ...network].sort((a, b) => a.id - b.id).slice(-MAX_PROBLEMS) });
}
