import {
  LSPClient,
  LSPPlugin,
  languageServerExtensions,
  Workspace,
  type Transport,
  type WorkspaceFile,
} from '@codemirror/lsp-client';
import type { ChangeSet, Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  absoluteProjectPath,
  fileUriFromPath,
  languageIdForPath,
  pathFromFileUri,
  relativeProjectPath,
  sanitizeLspHtml,
} from '@arbora/shared';
import { openFile } from '../../files-store';
import { useApp } from '../../store';
import { applyLsp, currentEditorPath, editorView, subscribeSessions } from './sessions';

/**
 * One language-server client for the open project. The server process lives in main; this
 * transport only moves the JSON messages.
 */
class EditorFile implements WorkspaceFile {
  constructor(
    readonly uri: string,
    readonly languageId: string,
    public version: number,
    public doc: Text,
    readonly view: EditorView,
  ) {}

  getView(_main?: EditorView): EditorView | null {
    return this.view;
  }
}

class EditorWorkspace extends Workspace {
  readonly files: EditorFile[] = [];
  private readonly versions = new Map<string, number>();

  private nextVersion(uri: string): number {
    const next = (this.versions.get(uri) ?? -1) + 1;
    this.versions.set(uri, next);
    return next;
  }

  override syncFiles(): { file: EditorFile; prevDoc: Text; changes: ChangeSet }[] {
    const updates: { file: EditorFile; prevDoc: Text; changes: ChangeSet }[] = [];
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view);
      if (!plugin || plugin.uri !== file.uri) continue;
      const changes = plugin.unsyncedChanges;
      if (changes.empty) continue;
      updates.push({ changes, file, prevDoc: file.doc });
      file.doc = file.view.state.doc;
      file.version = this.nextVersion(file.uri);
      plugin.clear();
    }
    return updates;
  }

  override openFile(uri: string, languageId: string, view: EditorView): void {
    if (this.getFile(uri)) throw new Error('The language server already has this file open.');
    const file = new EditorFile(uri, languageId, this.nextVersion(uri), view.state.doc, view);
    this.files.push(file);
    this.client.didOpen(file);
  }

  override closeFile(uri: string, _view: EditorView): void {
    const index = this.files.findIndex((file) => file.uri === uri);
    if (index < 0) return;
    this.files.splice(index, 1);
    this.client.didClose(uri);
  }

  override displayFile(uri: string): Promise<EditorView | null> {
    const open = this.getFile(uri);
    if (open) return Promise.resolve(open.getView());
    const absolute = pathFromFileUri(uri);
    const project = useApp.getState().project?.path;
    if (!absolute || !project) return Promise.resolve(null);
    const path = relativeProjectPath(project, absolute);
    if (!path) return Promise.resolve(null);
    openFile(path, { pinned: true });
    return waitForFile(uri, path);
  }
}

function waitForFile(uri: string, path: string): Promise<EditorView | null> {
  const ready = (): EditorView | null => {
    const view = editorView();
    return view && currentEditorPath() === path && LSPPlugin.get(view)?.uri === uri ? view : null;
  };
  const immediate = ready();
  if (immediate) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(ready());
    }, 4000);
    const unsubscribe = subscribeSessions(() => {
      const view = ready();
      if (!view) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(view);
    });
  });
}

let client: LSPClient | null = null;
let projectPath: string | null = null;
let connecting: Promise<LSPClient | null> | null = null;
let offMessage: (() => void) | null = null;
let offExit: (() => void) | null = null;
const handlers = new Set<(message: string) => void>();
let status: string | null = null;
let readyPath: string | null = null;
const statusListeners = new Set<() => void>();

export function lspError(): string | null {
  return status;
}

export function lspReadyPath(): string | null {
  return readyPath;
}

export function subscribeLsp(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')
    return error.message;
  return String(error);
}

function notifyStatus(): void {
  for (const listener of statusListeners) listener();
}

function setStatus(next: string | null): void {
  if (status === next) return;
  status = next;
  notifyStatus();
}

function setReady(path: string | null): void {
  if (readyPath === path) return;
  readyPath = path;
  notifyStatus();
}

function transport(): Transport {
  return {
    send(message) {
      void window.arbora.invoke('lsp.send', { message }).catch((error: unknown) => {
        setStatus((error as Error).message);
      });
    },
    subscribe(handler) {
      handlers.add(handler);
    },
    unsubscribe(handler) {
      handlers.delete(handler);
    },
  };
}

function stopClient(): void {
  offMessage?.();
  offExit?.();
  offMessage = null;
  offExit = null;
  handlers.clear();
  client?.disconnect();
  client = null;
  projectPath = null;
  void window.arbora.invoke('lsp.stop').catch(() => undefined);
}

async function connect(): Promise<LSPClient | null> {
  const project = useApp.getState().project?.path ?? null;
  if (!project || !useApp.getState().settings.editor.lsp) return null;
  if (client && projectPath === project) return client;
  if (connecting) return connecting;
  const pending = (async (): Promise<LSPClient | null> => {
    if (client) {
      client.disconnect();
      client = null;
      offMessage?.();
      offMessage = null;
      offExit?.();
      offExit = null;
      handlers.clear();
    }
    const started = await window.arbora.invoke('lsp.start');
    if (!useApp.getState().settings.editor.lsp || useApp.getState().project?.path !== project) {
      void window.arbora.invoke('lsp.stop').catch(() => undefined);
      return null;
    }
    if (!started.ok) {
      setStatus(started.error);
      return null;
    }
    const next = new LSPClient({
      rootUri: fileUriFromPath(project),
      timeout: 20_000,
      initializationOptions: { tsserver: { path: started.tsserverPath } },
      extensions: languageServerExtensions(),
      sanitizeHTML: sanitizeLspHtml,
      workspace: (lsp) => new EditorWorkspace(lsp),
      unhandledNotification() {
        return undefined;
      },
    });
    offMessage = window.arbora.on('lsp.message', ({ message }) => {
      for (const handler of handlers) handler(message);
    });
    offExit = window.arbora.on('lsp.exited', ({ reason }) => {
      setStatus(reason);
      next.disconnect();
      if (client === next) client = null;
    });
    next.connect(transport());
    try {
      await next.initializing;
    } catch (error) {
      setStatus(messageOf(error));
      next.disconnect();
      void window.arbora.invoke('lsp.stop').catch(() => undefined);
      return null;
    }
    setStatus(null);
    client = next;
    projectPath = project;
    return next;
  })().finally(() => {
    if (connecting === pending) connecting = null;
  });
  connecting = pending;
  return pending;
}

/** Attaches hover, completion and go-to-definition when the setting is on and the file is JS or TS. */
export function syncEditorLsp(path: string): void {
  const languageId = languageIdForPath(path);
  const enabled = useApp.getState().settings.editor.lsp;
  if (!enabled || !languageId) {
    applyLsp(path, []);
    if (readyPath === path) setReady(null);
    return;
  }
  void connect().then((connected) => {
    if (!connected || !useApp.getState().settings.editor.lsp) return;
    const project = useApp.getState().project?.path;
    if (!project) return;
    applyLsp(path, connected.plugin(fileUriFromPath(absoluteProjectPath(project, path)), languageId));
    setReady(path);
  });
}

useApp.subscribe((state, previous) => {
  const toggled = state.settings.editor.lsp !== previous.settings.editor.lsp;
  const switched = state.project?.path !== previous.project?.path;
  if (!toggled && !switched) return;
  const path = currentEditorPath();
  if (!state.settings.editor.lsp) {
    stopClient();
    setReady(null);
    if (path) applyLsp(path, []);
    return;
  }
  if (switched) {
    client?.disconnect();
    client = null;
    projectPath = null;
    offMessage?.();
    offMessage = null;
    offExit?.();
    offExit = null;
    handlers.clear();
    if (path) applyLsp(path, []);
  }
  if (path) syncEditorLsp(path);
});
