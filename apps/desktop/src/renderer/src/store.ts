import { create } from 'zustand';
import {
  defaultSettings,
  layoutStateSchema,
  type AppInfo,
  type AppSettings,
  type LayoutState,
  type PanelGroupLayout,
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
}));

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
