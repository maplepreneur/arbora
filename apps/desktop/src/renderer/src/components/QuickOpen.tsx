import { useEffect, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { File } from 'lucide-react';
import { baseName, parentPath, type FuzzyResult } from '@arbora/shared';
import { openFile, useFiles } from '../files-store';
import { showToast } from '../store';
import { matchFiles, parseQuickOpenQuery, type QuickOpenRequest, type QuickOpenResponse } from './quick-open-match';

const LIMIT = 60;

/**
 * Matching runs in a worker; when the worker cannot start (it is a module worker loaded from the
 * app's own origin) the same code runs on the UI thread instead.
 */
class Matcher {
  private worker: Worker | null = null;
  private files: readonly string[] = [];
  private nextId = 1;
  private readonly waiting = new Map<number, (results: FuzzyResult[]) => void>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./quick-open.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<QuickOpenResponse>) => {
        this.waiting.get(event.data.id)?.(event.data.results);
        this.waiting.delete(event.data.id);
      };
      this.worker.onerror = () => this.fallBack();
    } catch {
      this.worker = null;
    }
  }

  setFiles(files: readonly string[]): void {
    this.files = files;
    this.post({ type: 'files', files });
  }

  query(query: string, recent: readonly string[]): Promise<FuzzyResult[]> {
    if (!this.worker) return Promise.resolve(matchFiles(this.files, query, recent, LIMIT));
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.post({ type: 'query', id, query, recent: [...recent], limit: LIMIT });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private post(request: QuickOpenRequest): void {
    this.worker?.postMessage(request);
  }

  private fallBack(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const resolve of this.waiting.values()) resolve([]);
    this.waiting.clear();
  }
}

/** Runs of matched and unmatched text; positions are UTF-16 indices into the full path. */
function Highlighted({ text, positions, offset }: { text: string; positions: ReadonlySet<number>; offset: number }) {
  const runs: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = positions.has(i + offset);
    const last = runs[runs.length - 1];
    if (last?.hit === hit) last.text += text.charAt(i);
    else runs.push({ text: text.charAt(i), hit });
  }
  return (
    <>
      {runs.map((run, i) => (
        <span key={i} className={run.hit ? 'font-semibold text-accent' : undefined}>
          {run.text}
        </span>
      ))}
    </>
  );
}

function ResultRow({ result }: { result: FuzzyResult }) {
  const name = baseName(result.path);
  const dir = parentPath(result.path);
  const positions = new Set(result.positions);
  const nameOffset = result.path.length - name.length;
  return (
    <>
      <File size={13} className="shrink-0 text-fg-subtle" />
      <span className="shrink-0">
        <Highlighted text={name} positions={positions} offset={nameOffset} />
      </span>
      {dir && (
        <span className="min-w-0 truncate text-xs text-fg-subtle">
          <Highlighted text={dir} positions={positions} offset={0} />
        </span>
      )}
    </>
  );
}

/** `Mod+P`: fuzzy file finder over every non-ignored project file; `path:line` jumps to a line. */
export function QuickOpen() {
  const open = useFiles((s) => s.quickOpen);
  const filesVersion = useFiles((s) => s.filesVersion);
  const [text, setText] = useState('');
  const [results, setResults] = useState<{ text: string; list: FuzzyResult[] }>({ text: '', list: [] });
  /** cmdk's highlighted item; reset to the best match whenever results arrive. */
  const [selected, setSelected] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [loadedVersion, setLoadedVersion] = useState(-1);
  const matcher = useRef<Matcher | null>(null);
  /** The query in flight, so Enter can wait for it instead of picking a stale result. */
  const pending = useRef<{ text: string; promise: Promise<FuzzyResult[]> } | null>(null);

  useEffect(() => {
    matcher.current = new Matcher();
    return () => matcher.current?.dispose();
  }, []);

  // Fetch the list when opening, and again after files were added or removed.
  useEffect(() => {
    if (!open || loadedVersion === filesVersion) return;
    let active = true;
    void window.arbora.invoke('files.list').then(
      (list) => {
        if (!active) return;
        matcher.current?.setFiles(list.files);
        setTruncated(list.truncated);
        setLoadedVersion(filesVersion);
      },
      (error: unknown) => showToast(`Could not list files: ${(error as Error).message}`),
    );
    return () => {
      active = false;
    };
  }, [open, filesVersion, loadedVersion]);

  useEffect(() => {
    if (!open || loadedVersion === -1) return;
    let active = true;
    const { query } = parseQuickOpenQuery(text);
    const promise = matcher.current?.query(query, useFiles.getState().recent);
    if (!promise) return;
    pending.current = { text, promise };
    void promise.then((next) => {
      if (!active) return;
      setResults({ text, list: next });
      setSelected(next[0]?.path ?? '');
    });
    return () => {
      active = false;
    };
  }, [open, text, loadedVersion]);

  if (!open) return null;

  const close = (): void => {
    useFiles.setState({ quickOpen: false });
    setText('');
    setResults({ text: '', list: [] });
  };
  const choose = (path: string): void => {
    const { line, column } = parseQuickOpenQuery(text);
    close();
    openFile(path, {
      pinned: true,
      ...(line !== undefined ? { at: { line, ...(column !== undefined ? { column } : {}) } } : {}),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <Command
        label="Quick open"
        data-testid="quick-open"
        shouldFilter={false}
        value={selected}
        onValueChange={setSelected}
        className="w-[min(640px,90vw)] overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
          // Typed faster than the matcher answered: open the best match for what is typed now.
          const inFlight = pending.current;
          if (event.key === 'Enter' && results.text !== text && inFlight?.text === text) {
            event.preventDefault();
            void inFlight.promise.then((next) => {
              if (next[0]) choose(next[0].path);
            });
          }
        }}
      >
        <Command.Input
          autoFocus
          value={text}
          onValueChange={setText}
          data-testid="quick-open-input"
          placeholder="Search files by name (append :line to jump)"
          className="h-11 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-fg-subtle"
        />
        <Command.List className="max-h-[50vh] overflow-y-auto p-1">
          <Command.Empty className="px-3 py-6 text-center text-fg-subtle">
            {loadedVersion === -1 ? 'Indexing files…' : 'No matching files'}
          </Command.Empty>
          {results.list.map((result) => (
            <Command.Item
              key={result.path}
              value={result.path}
              onSelect={() => choose(result.path)}
              data-testid="quick-open-item"
              data-path={result.path}
              className="flex cursor-default items-center gap-2 rounded px-3 py-1.5 data-[selected=true]:bg-accent-soft"
            >
              <ResultRow result={result} />
            </Command.Item>
          ))}
        </Command.List>
        {truncated && (
          <div className="border-t border-border px-3 py-1 text-[11px] text-fg-subtle">
            Large project: only the first 200,000 files are indexed.
          </div>
        )}
      </Command>
    </div>
  );
}
