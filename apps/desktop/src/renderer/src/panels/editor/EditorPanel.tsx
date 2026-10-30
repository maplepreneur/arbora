import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { FileWarning, ImageIcon } from 'lucide-react';
import type { FileContent } from '@arbora/shared';
import { useFiles, type FileStatus } from '../../files-store';
import { DiffViewer } from './DiffViewer';
import { attach, detach, getSession, keepMine, loadSession, reloadFromDisk, subscribeSessions } from './sessions';

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function Banner({ path, status, large }: { path: string; status: FileStatus | undefined; large: boolean }) {
  if (status?.diskChanged) {
    return (
      <div
        className="flex shrink-0 items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs"
        data-testid="editor-disk-changed"
      >
        <FileWarning size={14} className="text-amber-500" />
        <span className="flex-1">This file changed on disk and you have unsaved edits.</span>
        <button
          type="button"
          className="rounded px-2 py-0.5 hover:bg-bg-muted"
          data-testid="editor-reload"
          onClick={() => void reloadFromDisk(path)}
        >
          Reload from disk
        </button>
        <button
          type="button"
          className="rounded px-2 py-0.5 hover:bg-bg-muted"
          data-testid="editor-keep-mine"
          onClick={() => keepMine(path)}
        >
          Keep mine
        </button>
      </div>
    );
  }
  if (status?.deleted) {
    return (
      <div
        className="shrink-0 border-b border-border bg-bg-subtle px-3 py-1.5 text-xs text-fg-muted"
        data-testid="editor-deleted"
      >
        This file was deleted on disk. Saving writes it again.
      </div>
    );
  }
  if (large) {
    return (
      <div
        className="shrink-0 border-b border-border bg-bg-subtle px-3 py-1.5 text-xs text-fg-muted"
        data-testid="editor-large"
      >
        Large file: opened read-only without syntax highlighting.
      </div>
    );
  }
  return null;
}

function OtherContent({ path, content }: { path: string; content: Exclude<FileContent, { type: 'text' }> }) {
  switch (content.type) {
    case 'image':
      return (
        <div
          className="flex h-full flex-col items-center justify-center gap-2 overflow-auto bg-bg-subtle p-4"
          data-testid="image-preview"
        >
          <img
            src={content.dataUrl}
            alt={path}
            className="max-h-[90%] max-w-full object-contain [background:repeating-conic-gradient(var(--bg-muted)_0%_25%,transparent_0%_50%)_50%/16px_16px]"
          />
          <span className="text-xs text-fg-subtle">
            <ImageIcon size={12} className="mr-1 inline" />
            {formatBytes(content.size)}
          </span>
        </div>
      );
    case 'binary':
      return <Message text={`Binary file (${formatBytes(content.size)}); not shown.`} />;
    case 'tooLarge':
      return <Message text={`This file is too large to open (${formatBytes(content.size)}).`} />;
    default: {
      const unreachable: never = content;
      return unreachable;
    }
  }
}

function Message({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-fg-subtle" data-testid="editor-message">
      {text}
    </div>
  );
}

function FileView({ path }: { path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [error, setError] = useState<string | null>(null);
  const status = useFiles((s) => s.status[path]);
  const session = getSession(path);

  useEffect(() => subscribeSessions(rerender), []);
  useEffect(() => {
    if (session) return;
    let active = true;
    loadSession(path).then(
      () => active && rerender(),
      (cause: unknown) =>
        active && setError((cause as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')),
    );
    return () => {
      active = false;
    };
  }, [path, session]);

  useLayoutEffect(() => {
    if (session?.kind === 'text' && host.current) attach(host.current, path)?.requestMeasure();
  }, [path, session]);

  if (error) return <Message text={`Could not open ${path}: ${error}`} />;
  if (!session) return <div className="h-full bg-bg" data-testid="editor-loading" />;
  if (session.kind === 'other') {
    return session.content.type === 'text' ? null : <OtherContent path={path} content={session.content} />;
  }
  return (
    <div className="flex h-full flex-col bg-bg">
      <Banner path={path} status={status} large={session.large} />
      <div ref={host} className="min-h-0 flex-1" data-testid="editor" data-path={path} />
    </div>
  );
}

/** The centre area while a file or diff tab is active (the browser shows otherwise). */
export default function EditorPanel() {
  const tab = useFiles((s) => s.tabs.find((t) => t.id === s.active));
  useEffect(() => () => detach(), []);
  if (!tab) return null;
  return tab.kind === 'diff' ? <DiffViewer key={tab.id} tab={tab} /> : <FileView key={tab.path} path={tab.path} />;
}
