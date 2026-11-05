import { create } from 'zustand';
import {
  defaultSettings,
  layoutForAppLaunch,
  layoutStateSchema,
  type AppInfo,
  type AppSettings,
  type DesignSelection,
  type DesignSessionSummary,
  type DesignState,
  type FrameworkInfo,
  type LayoutState,
  type NavigationState,
  type PanelGroupLayout,
  type ProblemEntry,
  type ProjectInfo,
  type RightView,
  type ThemeState,
  type WindowState,
} from '@arbora/shared';
import { designEffect, IDLE, inspectorEffect, transition, type ModeEvent, type ModeState } from './mode';

export interface ToastAction {
  readonly label: string;
  run(): void;
}

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly action?: ToastAction;
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
  mode: ModeState;
  /** Live design-mode op list. Sessions are the saved ones, loaded with the panel. */
  design: DesignUiState;
  paletteOpen: boolean;
  /** A dialog over the whole window; the browser view is hidden while one is open. */
  overlay: Overlay | null;
  /** The Settings page is showing in place of the browser pane. */
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  /** Agent ids whose sign-in check is running. */
  checkingAgents: string[];
  /** The shortcut editor is waiting for a chord. */
  recordingShortcut: boolean;
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

export type SettingsSection =
  | 'agents'
  | 'grove'
  | 'general'
  | 'appearance'
  | 'notifications'
  | 'editor'
  | 'git'
  | 'skills'
  | 'mcp'
  | 'browser'
  | 'project'
  | 'keyboard'
  | 'updates';

export type Overlay = 'onboarding' | 'switcher' | 'update' | 'keybindings';

export function openOverlay(overlay: Overlay): void {
  useApp.setState({ overlay, paletteOpen: false });
}

export function closeOverlay(overlay?: Overlay): void {
  useApp.setState((s) => (overlay === undefined || s.overlay === overlay ? { overlay: null } : {}));
}

/**
 * Shows Settings on `section`. Unlike `Mod+,`, this never closes it: buttons that say "settings"
 * must not hide the page when it is already open beside them.
 */
export function openSettings(section: SettingsSection = 'agents'): void {
  useApp.setState({ settingsOpen: true, settingsSection: section, paletteOpen: false, overlay: null });
}

export interface DesignUiState {
  readonly ops: DesignState['ops'];
  readonly cursor: number;
  readonly textEditing: boolean;
  readonly selectionCount: number;
  readonly selection: DesignSelection | null;
  readonly structureWarning: boolean;
  readonly framework: FrameworkInfo;
  readonly showingOriginal: boolean;
  readonly sessions: readonly DesignSessionSummary[];
  /** `thread:<id>` or `new:<agentId>` the user picked last; null follows the default agent. */
  readonly target: string | null;
  /** Model picked for a new thread; null follows the agent's default model. */
  readonly model: string | null;
}

const HTML_FRAMEWORK: FrameworkInfo = { id: 'html', react: false, vue: false, reactVersion: null };

export const EMPTY_DESIGN: DesignUiState = {
  ops: [],
  cursor: 0,
  textEditing: false,
  selectionCount: 0,
  selection: null,
  structureWarning: false,
  framework: HTML_FRAMEWORK,
  showingOriginal: false,
  sessions: [],
  target: null,
  model: null,
};

export const DEFAULT_LAYOUT: LayoutState = layoutStateSchema.parse({});

let nextToastId = 1;

export const useApp = create<AppState>()(() => ({
  // Placeholders; `initStore` replaces them with values from main before the first render.
  info: {
    name: 'arbora',
    version: '',
    // Unit tests import the stores without a preload.
    platform: (globalThis as { window?: Partial<Window> }).window?.arbora?.platform ?? 'linux',
    isPackaged: false,
    tilingCompositor: null,
    skipOnboarding: false,
    installKind: 'dev',
  },
  settings: defaultSettings(),
  theme: { mode: 'system', resolved: 'light' },
  project: null,
  windowState: { maximized: false, fullScreen: false, focused: true },
  layout: DEFAULT_LAYOUT,
  layoutEpoch: 0,
  mode: IDLE,
  design: EMPTY_DESIGN,
  paletteOpen: false,
  overlay: null,
  settingsOpen: false,
  settingsSection: 'agents',
  checkingAgents: [],
  recordingShortcut: false,
  terminalFocused: false,
  toasts: [],
  browser: null,
  problems: [],
  suggestedUrl: null,
  urlFocusRequest: 0,
}));

/** The Problems tab keeps at most this many entries (main keeps 500 console + 500 network). */
export const MAX_PROBLEMS = 1000;

/** The shell is Grove's workspace: its tree, chat and right column are always on screen. */
function shellLayout(layout: LayoutState | undefined): LayoutState {
  return layoutForAppLaunch(layout, 'grove');
}

export function initStore(initial: InitialState): void {
  useApp.setState({ ...initial, layout: shellLayout(initial.project?.layout) });
}

export function setProject(project: ProjectInfo | null): void {
  const previous = useApp.getState().project;
  const switched = previous?.path !== project?.path;
  useApp.setState((s) => ({
    project,
    ...(switched
      ? {
          // Panel sizes belong to the window, so switching project does not move the columns.
          layout: { ...shellLayout(project?.layout), groups: s.layout.groups },
          mode: IDLE,
          design: EMPTY_DESIGN,
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

/** The shell's tree, chat, right column and side panel sizes (`panels/grove/GroveWorkspace.tsx`). */
export const SHELL_GROUP = 'arbora.shell';

/** Puts the shell's columns back to their default sizes. Tabs and the selection stay. */
export function resetLayout(): void {
  useApp.setState((s) => ({ layout: { ...s.layout, groups: {} }, layoutEpoch: s.layoutEpoch + 1 }));
  persistLayout();
}

/** Shows `view` in the right column. Changes and Problems join the strip the first time. */
export function showRightView(view: RightView): void {
  const { rightView, rightPanels } = useApp.getState().layout;
  const panels =
    (view === 'changes' || view === 'problems') && !rightPanels.includes(view) ? [...rightPanels, view] : rightPanels;
  if (rightView === view && panels === rightPanels) return;
  updateLayout({ rightView: view, rightPanels: panels });
}

/** Closes the Changes or Problems tab; the browser shows when it was the one on screen. */
export function closeRightPanel(panel: 'changes' | 'problems'): void {
  const { rightView, rightPanels } = useApp.getState().layout;
  updateLayout({
    rightPanels: rightPanels.filter((entry) => entry !== panel),
    ...(rightView === panel ? { rightView: 'browser' as const } : {}),
  });
}

/** Applies a mode event and starts or stops the page inspector and the design overlay. */
export function dispatchMode(event: ModeEvent): void {
  const previous = useApp.getState().mode;
  const design = useApp.getState().design;
  let actual = event;
  const dirty = design.cursor > 0;
  if (previous.kind === 'design' && previous.phase === 'editing') {
    if (event.type === 'toggleAgent' && dirty) {
      actual = { type: 'designConfirm', pending: 'agent' };
    } else if (event.type === 'toggleDesign' && dirty) {
      actual = { type: 'designConfirm', pending: 'idle' };
    } else if (event.type === 'exit' && design.textEditing) {
      void window.arbora.invoke('design.command', { type: 'endText' });
      return;
    } else if (event.type === 'exit' && design.selectionCount > 0) {
      void window.arbora.invoke('design.command', { type: 'deselect' });
      return;
    } else if (event.type === 'exit' && dirty) {
      actual = { type: 'designConfirm', pending: 'idle' };
    }
  }
  const next = transition(previous, actual);
  if (next === previous) return;
  useApp.setState({ mode: next });
  const effect = inspectorEffect(previous, next);
  if (effect) void window.arbora.invoke('agentMode.setInspecting', { active: effect === 'start' });
  const designing = designEffect(previous, next);
  if (designing === 'stop') {
    useApp.setState((s) => ({
      design: { ...EMPTY_DESIGN, sessions: s.design.sessions, target: s.design.target, model: s.design.model },
    }));
  }
  if (designing) void window.arbora.invoke('design.setActive', { active: designing === 'start' });
}

export function applyDesignState(state: DesignState): void {
  useApp.setState((current) => ({ design: { ...current.design, ...state } }));
}

export function setDesignTarget(target: string, model: string | null): void {
  useApp.setState((current) => ({ design: { ...current.design, target, model } }));
}

export function dismissToast(id: number): void {
  useApp.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

/** Toasts with an action stay longer so there is time to click it. */
export function showToast(message: string, action?: ToastAction): void {
  const toast: Toast = { id: nextToastId++, message, ...(action ? { action } : {}) };
  useApp.setState((s) => ({ toasts: [...s.toasts, toast] }));
  setTimeout(() => dismissToast(toast.id), action ? 10_000 : 3500);
}

export function addProblems(entries: readonly ProblemEntry[]): void {
  useApp.setState((s) => ({ problems: [...s.problems, ...entries].slice(-MAX_PROBLEMS) }));
}

/** Replaces the Problems list with main's buffers (console and network merged in arrival order). */
export function setProblems(consoleEntries: readonly ProblemEntry[], network: readonly ProblemEntry[]): void {
  useApp.setState({ problems: [...consoleEntries, ...network].sort((a, b) => a.id - b.id).slice(-MAX_PROBLEMS) });
}
