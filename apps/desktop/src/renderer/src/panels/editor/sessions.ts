import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { lintGutter, lintKeymap, setDiagnostics } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import {
  Compartment,
  EditorSelection,
  EditorState,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
  type Text,
} from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  GutterMarker,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import type { Eol, FileChange, FileContent, GitLine } from '@arbora/shared';
import {
  fileStatus,
  renamedPath,
  setEditorController,
  setFileStatus,
  takePendingReveal,
  useFiles,
  type RevealTarget,
} from '../../files-store';
import { showToast, useApp } from '../../store';
import { languageFor } from './languages';
import { minimalChange, textOf, toCmDiagnostics } from './text-utils';
import { editorHighlighting, editorTheme, fontSizeTheme } from './theme';

/** One open text file. `state` is the live state while the file is not the one on screen. */
interface TextSession {
  readonly kind: 'text';
  path: string;
  state: EditorState;
  /** What is on disk, as far as the editor knows. */
  saved: Text;
  eol: Eol;
  readonly large: boolean;
}

type Session = TextSession | { readonly kind: 'other'; path: string; readonly content: FileContent };

const sessions = new Map<string, Session>();
const loading = new Map<string, Promise<Session>>();
const fontSize = new Compartment();
const lspSupport = new Compartment();
let view: EditorView | null = null;
let viewPath: string | null = null;
const listeners = new Set<() => void>();

function ipcError(error: unknown): string {
  return (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function extensions(session: TextSession): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    history(),
    lintGutter(),
    gitMarkField,
    gitGutterExt,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
    editorTheme,
    editorHighlighting,
    fontSize.of(fontSizeTheme(useApp.getState().settings.editor.fontSize)),
    lspSupport.of([]),
    session.large ? [] : languageFor(session.path),
    EditorState.readOnly.of(session.large),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const dirty = !update.state.doc.eq(session.saved);
      if (dirty !== fileStatus(session.path).dirty) setFileStatus(session.path, { dirty });
      if (dirty) pinTab(session.path);
    }),
  ];
}

/** Editing a preview tab keeps it open, as in VS Code. */
function pinTab(path: string): void {
  const id = `file:${path}`;
  const tab = useFiles.getState().tabs.find((t) => t.id === id);
  if (tab?.kind === 'file' && tab.preview) {
    useFiles.setState((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...tab, preview: false } : t)) }));
  }
}

function newTextSession(path: string, content: Extract<FileContent, { type: 'text' }>): TextSession {
  const saved = textOf(content.content);
  const session: TextSession = {
    kind: 'text',
    path,
    saved,
    eol: content.eol,
    large: content.large,
    state: null as never,
  };
  session.state = EditorState.create({ doc: saved, extensions: extensions(session) });
  return session;
}

/** Loads (once) and returns the session for `path`. */
export function loadSession(path: string): Promise<Session> {
  const existing = sessions.get(path);
  if (existing) return Promise.resolve(existing);
  const pending = loading.get(path);
  if (pending) return pending;
  const promise = window.arbora
    .invoke('files.read', { path })
    .then((content): Session => {
      const session: Session =
        content.type === 'text' ? newTextSession(path, content) : { kind: 'other', path, content };
      sessions.set(path, session);
      return session;
    })
    .finally(() => loading.delete(path));
  loading.set(path, promise);
  return promise;
}

export function getSession(path: string): Session | undefined {
  return sessions.get(path);
}

/** Current state of a text session, from the view when it is on screen. */
function currentState(session: TextSession): EditorState {
  return view && viewPath === session.path ? view.state : session.state;
}

function replaceDoc(session: TextSession, next: string): void {
  const state = currentState(session);
  const change = minimalChange(state.doc.toString(), next);
  if (!change) return;
  if (view && viewPath === session.path) view.dispatch({ changes: change });
  else session.state = session.state.update({ changes: change }).state;
}

/** Mounts `path` in the editor view (creating the view on first use). */
export function attach(parent: HTMLElement, path: string): EditorView | null {
  const session = sessions.get(path);
  if (session?.kind !== 'text') return null;
  if (view && viewPath && viewPath !== path) {
    const previous = sessions.get(viewPath);
    if (previous?.kind === 'text') previous.state = view.state;
  }
  if (!view) {
    view = new EditorView({ state: session.state, parent });
  } else {
    if (view.dom.parentElement !== parent) parent.appendChild(view.dom);
    if (viewPath !== path) view.setState(session.state);
  }
  viewPath = path;
  notify();
  applyDiagnostics(path);
  applyGitLines(path, gitLines.get(path) ?? []);
  const reveal = takePendingReveal(path);
  if (reveal) revealIn(view, reveal);
  return view;
}

/** Unmounts the view, keeping its state in the session. */
export function detach(): void {
  if (view && viewPath) {
    const session = sessions.get(viewPath);
    if (session?.kind === 'text') session.state = view.state;
  }
  view?.destroy();
  view = null;
  viewPath = null;
}

function revealIn(target: EditorView, reveal: RevealTarget): void {
  const doc = target.state.doc;
  const line = doc.line(Math.min(Math.max(1, reveal.line), doc.lines));
  const from = Math.min(line.from + Math.max(0, (reveal.column ?? 1) - 1), line.to);
  const to = Math.min(from + (reveal.length ?? 0), doc.length);
  target.dispatch({
    selection: EditorSelection.range(from, to),
    effects: EditorView.scrollIntoView(from, { y: 'center' }),
  });
  target.focus();
}

const setGitMarks = StateEffect.define<readonly GitLine[]>();

class GitMark extends GutterMarker {
  constructor(private readonly kind: GitLine['kind']) {
    super();
  }

  override toDOM(): HTMLElement {
    const mark = document.createElement('span');
    mark.dataset.git = this.kind;
    mark.style.cssText = `display:block;width:3px;height:100%;margin-left:2px;background:${
      this.kind === 'added' ? 'var(--accent)' : 'var(--syn-number)'
    }`;
    return mark;
  }
}

const gitMarkField = StateField.define<RangeSet<GitMark>>({
  create: () => RangeSet.empty,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setGitMarks)) continue;
      const builder = new RangeSetBuilder<GitMark>();
      const sorted = [...effect.value].sort((a, b) => a.line - b.line);
      for (const mark of sorted) {
        if (mark.line < 1 || mark.line > transaction.state.doc.lines) continue;
        const pos = transaction.state.doc.line(mark.line).from;
        builder.add(pos, pos, new GitMark(mark.kind));
      }
      return builder.finish();
    }
    return value;
  },
});

const gitGutterExt = gutter({ class: 'cm-git-gutter', markers: (view) => view.state.field(gitMarkField) });

const gitLines = new Map<string, readonly GitLine[]>();

/** Shows added and changed lines for `path` in the editor gutter. */
export function applyGitLines(path: string, lines: readonly GitLine[]): void {
  gitLines.set(path, lines);
  if (!view || viewPath !== path) return;
  view.dispatch({ effects: setGitMarks.of(lines) });
}

/** Pushes the store's diagnostics for `path` into the view, if it is on screen. */
export function applyDiagnostics(path: string): void {
  if (!view || viewPath !== path) return;
  const all = Object.values(useFiles.getState().diagnostics[path] ?? {}).flat();
  view.dispatch(setDiagnostics(view.state, toCmDiagnostics(view.state.doc, all)));
}

export async function saveFile(path: string): Promise<void> {
  const session = sessions.get(path);
  if (session?.kind !== 'text' || session.large) return;
  const sent = currentState(session).doc.toString();
  setFileStatus(path, { saving: true });
  try {
    const result = await window.arbora.invoke('files.write', { path, content: sent, eol: session.eol, format: true });
    if (result.formatError) showToast(`Prettier: ${result.formatError}`);
    session.saved = textOf(result.content);
    // Apply the formatter's output unless the user typed while saving.
    if (currentState(session).doc.toString() === sent) replaceDoc(session, result.content);
    setFileStatus(path, {
      saving: false,
      diskChanged: false,
      deleted: false,
      dirty: !currentState(session).doc.eq(session.saved),
    });
  } catch (error) {
    setFileStatus(path, { saving: false });
    showToast(`Could not save ${path}: ${ipcError(error)}`);
  }
}

export async function formatFile(path: string): Promise<void> {
  const session = sessions.get(path);
  if (session?.kind !== 'text' || session.large) return;
  const before = currentState(session).doc.toString();
  try {
    const result = await window.arbora.invoke('editor.format', { path, content: before });
    if (result.error) showToast(`Prettier: ${result.error}`);
    else if (result.content === null) showToast('No Prettier in this project (or it skips this file)');
    else if (currentState(session).doc.toString() === before) replaceDoc(session, result.content);
  } catch (error) {
    showToast(`Could not format ${path}: ${ipcError(error)}`);
  }
}

/** Replaces the editor text with what is on disk now. */
export async function reloadFromDisk(path: string): Promise<void> {
  const session = sessions.get(path);
  if (!session) return;
  const content = await window.arbora.invoke('files.read', { path });
  if (session.kind === 'text' && content.type === 'text') {
    session.saved = textOf(content.content);
    session.eol = content.eol;
    replaceDoc(session, content.content);
    setFileStatus(path, { dirty: false, diskChanged: false, deleted: false });
  } else {
    sessions.delete(path);
    notify();
  }
}

/** Keep the editor's text but stop warning about the disk version. */
export function keepMine(path: string): void {
  setFileStatus(path, { diskChanged: false });
}

async function onDiskChange(change: FileChange): Promise<void> {
  const session = sessions.get(change.path);
  if (!session) return;
  if (change.type === 'unlink') {
    setFileStatus(change.path, { deleted: true });
    return;
  }
  if (change.type !== 'change' && change.type !== 'add') return;
  if (session.kind === 'other') {
    sessions.delete(change.path);
    notify();
    return;
  }
  let content: FileContent;
  try {
    content = await window.arbora.invoke('files.read', { path: change.path });
  } catch {
    return;
  }
  if (content.type !== 'text') return;
  const disk = textOf(content.content);
  if (fileStatus(change.path).deleted) setFileStatus(change.path, { deleted: false });
  // Our own save, or a write of what the editor already had.
  if (disk.eq(session.saved)) return;
  if (!fileStatus(change.path).dirty) {
    session.saved = disk;
    session.eol = content.eol;
    replaceDoc(session, content.content.replace(/\r\n?/g, '\n'));
    setFileStatus(change.path, { dirty: false });
  } else {
    setFileStatus(change.path, { diskChanged: true });
  }
}

/** The file currently mounted in the editor, if any. */
export function currentEditorPath(): string | null {
  return viewPath;
}

export function editorView(): EditorView | null {
  return view;
}

/** Swaps the language-server extension on a text session, on screen or not. */
export function applyLsp(path: string, extension: Extension): void {
  const session = sessions.get(path);
  if (session?.kind !== 'text') return;
  const effects = lspSupport.reconfigure(extension);
  if (view && viewPath === path) view.dispatch({ effects });
  else session.state = session.state.update({ effects }).state;
  notify();
}

/** Re-renders components that show non-text sessions when one is dropped. */
export function subscribeSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Font size follows the setting live. */
useApp.subscribe((state, previous) => {
  if (state.settings.editor.fontSize === previous.settings.editor.fontSize) return;
  view?.dispatch({ effects: fontSize.reconfigure(fontSizeTheme(state.settings.editor.fontSize)) });
});

/** Diagnostics follow the store. */
useFiles.subscribe((state, previous) => {
  if (state.diagnostics !== previous.diagnostics && viewPath) applyDiagnostics(viewPath);
});

setEditorController({
  save: saveFile,
  format: formatFile,
  texts: (path) => {
    const session = sessions.get(path);
    if (session?.kind !== 'text') return null;
    return { saved: session.saved.toString(), current: currentState(session).doc.toString() };
  },
  onDiskChanges: (changes) => {
    for (const change of changes) void onDiskChange(change);
  },
  rename: (from, to) => {
    for (const [path, session] of [...sessions]) {
      const next = renamedPath(path, from, to);
      if (next === null) continue;
      sessions.delete(path);
      session.path = next;
      sessions.set(next, session);
      if (viewPath === path) viewPath = next;
    }
  },
  close: (path) => {
    if (viewPath === path) viewPath = null;
    sessions.delete(path);
  },
  reveal: (target) => {
    if (view && viewPath === target.path) {
      takePendingReveal(target.path);
      revealIn(view, target);
    }
  },
  focus: () => view?.focus(),
  reset: () => {
    detach();
    sessions.clear();
    loading.clear();
    notify();
  },
});
