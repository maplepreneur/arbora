import { create } from 'zustand';
import {
  baseName,
  decorationFor,
  parentPath,
  type Diagnostic,
  type DiagnosticSource,
  type FileChange,
  type FileEntry,
  type GitFile,
} from '@arbora/shared';
import { showRightView, useApp } from './store';

/** A file open in the centre area. A preview tab (single click) is replaced by the next preview. */
export interface FileTab {
  readonly kind: 'file';
  readonly id: string;
  readonly path: string;
  readonly preview: boolean;
}

/** A read-only comparison (Compare with Saved, an agent's edit; Stage 8's git changes). */
export interface DiffTab {
  readonly kind: 'diff';
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly left: string;
  readonly right: string;
  readonly leftLabel: string;
  readonly rightLabel: string;
}

export type EditorTab = FileTab | DiffTab;

/** What the editor knows about an open file, for tabs and banners. */
export interface FileStatus {
  readonly dirty: boolean;
  /** Changed on disk while there were unsaved edits. */
  readonly diskChanged: boolean;
  readonly deleted: boolean;
  readonly saving: boolean;
}

export interface FilesState {
  /** Listed folders by project-relative path (`''` is the root). */
  children: Record<string, FileEntry[]>;
  expanded: Record<string, true>;
  selected: string | null;
  renaming: string | null;
  creating: { readonly dir: string; readonly kind: 'file' | 'directory' } | null;
  tabs: EditorTab[];
  /** Active tab id; null shows the browser. */
  active: string | null;
  status: Record<string, FileStatus>;
  diagnostics: Record<string, Partial<Record<DiagnosticSource, Diagnostic[]>>>;
  /** Most recently opened files first, for quick open's empty query. */
  recent: string[];
  quickOpen: boolean;
  /** Git decorations by path (`M`, `A`, `U`, ...), including parent folders. */
  decorations: Record<string, { readonly letter: string; readonly tone: 'added' | 'modified' | 'deleted' | 'ignored' }>;
  /** Bumped to move focus to the explorer (after reveal, new file). */
  revealRequest: number;
  /** Bumped when files were added or removed, so quick open reloads its list. */
  filesVersion: number;
}

const INITIAL: FilesState = {
  children: {},
  expanded: {},
  selected: null,
  renaming: null,
  creating: null,
  tabs: [],
  active: null,
  status: {},
  diagnostics: {},
  recent: [],
  quickOpen: false,
  decorations: {},
  revealRequest: 0,
  filesVersion: 0,
};

export const useFiles = create<FilesState>()(() => INITIAL);

export function resetFiles(): void {
  controller?.reset();
  pendingReveal = null;
  useFiles.setState(INITIAL, true);
}

export const fileTabId = (path: string): string => `file:${path}`;

/** `record` without `key`. */
export function omitKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

const CLEAN: FileStatus = { dirty: false, diskChanged: false, deleted: false, saving: false };

export function fileStatus(path: string): FileStatus {
  return useFiles.getState().status[path] ?? CLEAN;
}

export function setFileStatus(path: string, patch: Partial<FileStatus>): void {
  useFiles.setState((s) => ({ status: { ...s.status, [path]: { ...(s.status[path] ?? CLEAN), ...patch } } }));
}

/**
 * Tabs after opening `path`: an existing tab is reused (and pinned when asked), a preview tab is
 * replaced by a new preview, otherwise the tab goes right after the active one.
 */
export function openTabIn(
  tabs: readonly EditorTab[],
  active: string | null,
  path: string,
  pinned: boolean,
): EditorTab[] {
  const id = fileTabId(path);
  const existing = tabs.find((t) => t.id === id);
  if (existing) {
    return pinned && existing.kind === 'file' && existing.preview
      ? tabs.map((t) => (t.id === id ? { ...existing, preview: false } : t))
      : [...tabs];
  }
  const tab: FileTab = { kind: 'file', id, path, preview: !pinned };
  const previewIndex = pinned ? -1 : tabs.findIndex((t) => t.kind === 'file' && t.preview);
  if (previewIndex !== -1) return tabs.map((t, i) => (i === previewIndex ? tab : t));
  const activeIndex = tabs.findIndex((t) => t.id === active);
  const at = activeIndex === -1 ? tabs.length : activeIndex + 1;
  return [...tabs.slice(0, at), tab, ...tabs.slice(at)];
}

/** Tabs after closing `id`, and which tab becomes active (the right neighbour, else the left). */
export function closeTabIn(
  tabs: readonly EditorTab[],
  active: string | null,
  id: string,
): { tabs: EditorTab[]; active: string | null } {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return { tabs: [...tabs], active };
  const next = tabs.filter((t) => t.id !== id);
  if (active !== id) return { tabs: next, active };
  const neighbour = next[index] ?? next[index - 1];
  return { tabs: next, active: neighbour?.id ?? null };
}

export function activeTab(): EditorTab | undefined {
  const { tabs, active } = useFiles.getState();
  return tabs.find((t) => t.id === active);
}

/** Rewrites paths under `from` after a rename or move (the path itself and everything inside it). */
export function renamedPath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
  return null;
}

export function applyRename(from: string, to: string): void {
  const move = (path: string): string => renamedPath(path, from, to) ?? path;
  useFiles.setState((s) => ({
    tabs: s.tabs.map((t) => {
      const path = move(t.path);
      if (path === t.path) return t;
      return t.kind === 'file' ? { ...t, path, id: fileTabId(path) } : { ...t, path };
    }),
    active: s.active?.startsWith('file:') ? fileTabId(move(s.active.slice(5))) : s.active,
    status: Object.fromEntries(Object.entries(s.status).map(([path, status]) => [move(path), status])),
    selected: s.selected === null ? null : move(s.selected),
    recent: s.recent.map(move),
  }));
}

/** Folders whose listing is stale after these changes (the parents of added or removed entries). */
export function staleFolders(changes: readonly FileChange[], listed: Readonly<Record<string, unknown>>): string[] {
  const dirs = new Set<string>();
  for (const change of changes) {
    if (change.type === 'change') continue;
    const parent = parentPath(change.path);
    if (parent in listed) dirs.add(parent);
  }
  return [...dirs];
}

export function setDiagnostics(path: string, source: DiagnosticSource, diagnostics: Diagnostic[]): void {
  useFiles.setState((s) => {
    const current = { ...s.diagnostics[path], [source]: diagnostics };
    const empty = Object.values(current).every((list) => list.length === 0);
    return { diagnostics: empty ? omitKey(s.diagnostics, path) : { ...s.diagnostics, [path]: current } };
  });
}

/** Every code diagnostic, files in name order, then by position. */
export function allDiagnostics(state: Pick<FilesState, 'diagnostics'>): Diagnostic[] {
  return Object.keys(state.diagnostics)
    .sort()
    .flatMap((path) => Object.values(state.diagnostics[path] ?? {}).flat())
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);
}

export function noteRecent(path: string): void {
  useFiles.setState((s) => ({ recent: [path, ...s.recent.filter((p) => p !== path)].slice(0, 50) }));
}

export function tabTitle(tab: EditorTab): string {
  return tab.kind === 'file' ? baseName(tab.path) : tab.title;
}

export interface RevealTarget {
  readonly path: string;
  /** 1-based. */
  readonly line: number;
  readonly column?: number;
  /** Characters to select from the column (a search match). */
  readonly length?: number;
}

/**
 * The CodeMirror side, registered by the lazily loaded editor chunk. Nothing is open before it
 * loads, so callers can treat a missing controller as "no editor state".
 */
export interface EditorController {
  save(path: string): Promise<void>;
  format(path: string): Promise<void>;
  /** Saved text and current text of an open file. */
  texts(path: string): { saved: string; current: string } | null;
  onDiskChanges(changes: readonly FileChange[]): void;
  rename(from: string, to: string): void;
  close(path: string): void;
  reveal(target: RevealTarget): void;
  focus(): void;
  /** Drops every session (project switched). */
  reset(): void;
}

let controller: EditorController | null = null;
let pendingReveal: RevealTarget | null = null;

export function setEditorController(next: EditorController | null): void {
  controller = next;
}

export function editorController(): EditorController | null {
  return controller;
}

/** Taken by the editor once the file's view is showing. */
export function takePendingReveal(path: string): RevealTarget | null {
  if (pendingReveal?.path !== path) return null;
  const target = pendingReveal;
  pendingReveal = null;
  return target;
}

/** Opens a file tab (a preview unless `pinned`) and optionally moves the cursor to a line. */
export function openFile(path: string, options: { pinned?: boolean; at?: Omit<RevealTarget, 'path'> } = {}): void {
  const pinned = options.pinned ?? false;
  useFiles.setState((s) => ({
    tabs: openTabIn(s.tabs, s.active, path, pinned),
    active: fileTabId(path),
    selected: path,
  }));
  noteRecent(path);
  showRightView('editor');
  if (options.at) {
    const target = { path, ...options.at };
    pendingReveal = target;
    // Already showing: the editor will not remount, so reveal now.
    controller?.reveal(target);
  }
}

/** Opens a read-only diff in its own tab. */
export function openDiff(diff: Omit<DiffTab, 'kind' | 'id'>): void {
  const id = `diff:${diff.path}:${Date.now()}`;
  useFiles.setState((s) => {
    const at = s.tabs.findIndex((t) => t.id === s.active);
    const tab: DiffTab = { kind: 'diff', id, ...diff };
    return { tabs: [...s.tabs.slice(0, at + 1), tab, ...s.tabs.slice(at + 1)], active: id };
  });
  showRightView('editor');
}

/** Shows an open file or diff tab in the right column. */
export function showEditorTab(id: string): void {
  useFiles.setState({ active: id });
  showRightView('editor');
}

/** Closes a tab, asking first when the file has unsaved edits. Returns false when cancelled. */
export function closeTab(id: string): boolean {
  const tab = useFiles.getState().tabs.find((t) => t.id === id);
  if (!tab) return true;
  if (tab.kind === 'file') {
    if (fileStatus(tab.path).dirty && !window.confirm(`Discard unsaved changes to ${baseName(tab.path)}?`))
      return false;
    controller?.close(tab.path);
    useFiles.setState((s) => ({ status: omitKey(s.status, tab.path) }));
  }
  useFiles.setState((s) => closeTabIn(s.tabs, s.active, id));
  if (useFiles.getState().active === null && useApp.getState().layout.rightView === 'editor') showRightView('browser');
  return true;
}

export function showBrowserTab(): void {
  useFiles.setState({ active: null });
  showRightView('browser');
}

/** Paths with unsaved edits. */
export function dirtyPaths(): string[] {
  return Object.entries(useFiles.getState().status)
    .filter(([, status]) => status.dirty)
    .map(([path]) => path);
}

/** Lists a folder into the tree. Errors (deleted folder) drop it from the listing. */
export async function loadDir(path: string): Promise<void> {
  try {
    const entries = await window.arbora.invoke('files.readDir', { path });
    useFiles.setState((s) => ({ children: { ...s.children, [path]: entries } }));
  } catch {
    useFiles.setState((s) => ({ children: omitKey(s.children, path), expanded: omitKey(s.expanded, path) }));
  }
}

export function toggleDir(path: string, open?: boolean): void {
  const isOpen = path in useFiles.getState().expanded;
  const next = open ?? !isOpen;
  if (next === isOpen) return;
  useFiles.setState((s) => ({ expanded: next ? { ...s.expanded, [path]: true } : omitKey(s.expanded, path) }));
  if (next) void loadDir(path);
}

/**
 * Expands every folder above `path` and selects it. `refresh` re-lists folders that are already
 * listed (after creating `path`); `focus` moves keyboard focus to the explorer.
 */
export async function revealInTree(path: string, options: { refresh?: boolean; focus?: boolean } = {}): Promise<void> {
  const dirs = [''];
  for (const part of path.split('/').slice(0, -1))
    dirs.push(dirs.length === 1 ? part : `${dirs[dirs.length - 1] ?? ''}/${part}`);
  for (const dir of dirs) {
    if (dir !== '') useFiles.setState((s) => ({ expanded: { ...s.expanded, [dir]: true } }));
    if (options.refresh || !(dir in useFiles.getState().children)) await loadDir(dir);
  }
  useFiles.setState((s) => ({ selected: path, revealRequest: s.revealRequest + (options.focus === false ? 0 : 1) }));
}

export async function refreshTree(): Promise<void> {
  await Promise.all(Object.keys(useFiles.getState().children).map((dir) => loadDir(dir)));
}

/** Watcher batch: refresh affected folders, tell the editor, and invalidate quick open. */
/** Replaces explorer git letters from a status snapshot. */
export function setGitDecorations(files: readonly GitFile[]): void {
  const decorations: FilesState['decorations'] = {};
  for (const file of files) {
    const decoration = decorationFor(file);
    decorations[file.path] = decoration;
    let parent = parentPath(file.path);
    while (parent !== '') {
      decorations[parent] ??= decoration;
      parent = parentPath(parent);
    }
  }
  useFiles.setState({ decorations });
}

export function onFilesChanged(changes: readonly FileChange[]): void {
  for (const dir of staleFolders(changes, useFiles.getState().children)) void loadDir(dir);
  controller?.onDiskChanges(changes);
  if (changes.some((c) => c.type !== 'change')) useFiles.setState((s) => ({ filesVersion: s.filesVersion + 1 }));
}
