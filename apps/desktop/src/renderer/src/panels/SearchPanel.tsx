import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CaseSensitive, ChevronDown, ChevronRight, File, Regex, WholeWord } from 'lucide-react';
import clsx from 'clsx';
import { baseName, parentPath, type SearchMatch } from '@arbora/shared';
import { openFile } from '../files-store';

const DEBOUNCE_MS = 300;

interface Options {
  matchCase: boolean;
  wholeWord: boolean;
  isRegex: boolean;
}

interface Results {
  readonly key: string;
  readonly matches: SearchMatch[];
  readonly running: boolean;
  readonly total: number;
  readonly truncated: boolean;
  readonly error?: string;
  readonly collapsed: Readonly<Record<string, true>>;
}

function emptyResults(key: string, running = false): Results {
  return { key, matches: [], running, total: 0, truncated: false, collapsed: {} };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Groups matches by file, keeping the order files arrived in. */
export function groupMatches(matches: readonly SearchMatch[]): { path: string; matches: SearchMatch[] }[] {
  const groups = new Map<string, SearchMatch[]>();
  for (const match of matches) {
    const list = groups.get(match.path);
    if (list) list.push(match);
    else groups.set(match.path, [match]);
  }
  return [...groups.entries()].map(([path, list]) => ({ path, matches: list }));
}

function Toggle({
  active,
  label,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      onClick={onClick}
      className={clsx(
        'flex h-5 w-5 items-center justify-center rounded',
        active ? 'bg-accent-soft text-accent' : 'text-fg-subtle hover:bg-bg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function MatchRow({ match }: { match: SearchMatch }) {
  const before = match.preview.slice(0, match.previewStart);
  const hit = match.preview.slice(match.previewStart, match.previewStart + match.length);
  const after = match.preview.slice(match.previewStart + match.length);
  return (
    <button
      type="button"
      data-testid="search-match"
      data-path={match.path}
      data-line={match.line}
      onClick={() =>
        openFile(match.path, { pinned: true, at: { line: match.line, column: match.column, length: match.length } })
      }
      className="flex w-full items-baseline gap-2 truncate py-0.5 pr-2 pl-8 text-left font-mono text-[11px] hover:bg-bg-muted"
    >
      <span className="w-7 shrink-0 text-right text-fg-subtle tabular-nums">{match.line}</span>
      <span className="truncate whitespace-pre">
        {before.trimStart()}
        <mark className="rounded-sm bg-[var(--syn-search)] text-fg">{hit}</mark>
        {after}
      </span>
    </button>
  );
}

/** PLAN F-FILES-03: project text search on ripgrep, streamed. */
export default function SearchPanel() {
  const [query, setQuery] = useState('');
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [options, setOptions] = useState<Options>({ matchCase: false, wholeWord: false, isRegex: false });
  const [showGlobs, setShowGlobs] = useState(false);
  const key = JSON.stringify([query, include, exclude, options]);
  /** The latest search's results; ignored while they belong to an older query (`key`). */
  const [results, setResults] = useState<Results>(() => emptyResults(''));
  const current = results.key === key ? results : emptyResults(key, query.trim() !== '');
  const { matches, collapsed } = current;
  const searchId = useRef<string | null>(null);
  /** Events that arrived before `search.start` returned their id. */
  const early = useRef(new Map<string, (() => void)[]>());
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const deliver = (id: string, apply: () => void): void => {
      if (id === searchId.current) apply();
      else if (searchId.current === null) early.current.set(id, [...(early.current.get(id) ?? []), apply]);
    };
    const offResults = window.arbora.on('search.results', (event) => {
      deliver(event.searchId, () => setResults((r) => ({ ...r, matches: [...r.matches, ...event.matches] })));
    });
    const offDone = window.arbora.on('search.done', (event) => {
      deliver(event.searchId, () =>
        setResults((r) => ({
          ...r,
          running: false,
          total: event.total,
          truncated: event.truncated,
          ...(event.error ? { error: event.error } : {}),
        })),
      );
    });
    return () => {
      offResults();
      offDone();
      if (searchId.current) void window.arbora.invoke('search.cancel', { searchId: searchId.current });
    };
  }, []);

  useEffect(() => {
    const previous = searchId.current;
    if (previous) void window.arbora.invoke('search.cancel', { searchId: previous });
    searchId.current = null;
    early.current.clear();
    if (query.trim() === '') return;
    let active = true;
    const timer = setTimeout(() => {
      setResults(emptyResults(key, true));
      void window.arbora.invoke('search.start', { query, include, exclude, ...options }).then(
        (result) => {
          if (!active) {
            void window.arbora.invoke('search.cancel', { searchId: result.searchId });
            return;
          }
          searchId.current = result.searchId;
          for (const apply of early.current.get(result.searchId) ?? []) apply();
          early.current.clear();
        },
        (error: unknown) => {
          if (active) setResults({ ...emptyResults(key), error: (error as Error).message });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // `key` covers query, include, exclude and options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const state = current;

  const groups = useMemo(() => groupMatches(matches), [matches]);

  return (
    <div className="flex h-full flex-col" data-testid="search-panel">
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border p-2">
        <div className="flex items-center rounded border border-border bg-bg pr-1 focus-within:border-accent">
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            spellCheck={false}
            data-testid="search-input"
            className="h-7 min-w-0 flex-1 bg-transparent px-2 text-xs outline-none placeholder:text-fg-subtle"
          />
          <Toggle
            active={options.matchCase}
            label="Match Case"
            testId="search-match-case"
            onClick={() => setOptions((o) => ({ ...o, matchCase: !o.matchCase }))}
          >
            <CaseSensitive size={14} />
          </Toggle>
          <Toggle
            active={options.wholeWord}
            label="Match Whole Word"
            testId="search-whole-word"
            onClick={() => setOptions((o) => ({ ...o, wholeWord: !o.wholeWord }))}
          >
            <WholeWord size={14} />
          </Toggle>
          <Toggle
            active={options.isRegex}
            label="Use Regular Expression"
            testId="search-regex"
            onClick={() => setOptions((o) => ({ ...o, isRegex: !o.isRegex }))}
          >
            <Regex size={13} />
          </Toggle>
        </div>
        <button
          type="button"
          onClick={() => setShowGlobs((s) => !s)}
          data-testid="search-toggle-globs"
          className="flex items-center gap-1 self-start text-[11px] text-fg-subtle hover:text-fg"
        >
          {showGlobs ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Files to include / exclude
        </button>
        {showGlobs && (
          <>
            <input
              value={include}
              onChange={(event) => setInclude(event.target.value)}
              placeholder="Include, e.g. src/**, *.tsx"
              spellCheck={false}
              data-testid="search-include"
              className="h-7 rounded border border-border bg-bg px-2 text-xs outline-none placeholder:text-fg-subtle focus:border-accent"
            />
            <input
              value={exclude}
              onChange={(event) => setExclude(event.target.value)}
              placeholder="Exclude, e.g. *.test.ts, docs/**"
              spellCheck={false}
              data-testid="search-exclude"
              className="h-7 rounded border border-border bg-bg px-2 text-xs outline-none placeholder:text-fg-subtle focus:border-accent"
            />
          </>
        )}
      </div>
      <div className="shrink-0 px-3 py-1 text-[11px] text-fg-subtle" data-testid="search-summary">
        {state.error
          ? state.error
          : query.trim() === ''
            ? 'Type to search the project'
            : state.running && matches.length === 0
              ? 'Searching…'
              : `${plural(state.running ? matches.length : state.total, 'result')} in ${plural(groups.length, 'file')}${state.truncated ? ' (stopped at the limit)' : ''}`}
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2" data-testid="search-results">
        {groups.map((group) => {
          const open = !(group.path in collapsed);
          return (
            <div key={group.path} data-testid="search-file" data-path={group.path}>
              <button
                type="button"
                onClick={() =>
                  setResults((r) => ({
                    ...r,
                    collapsed: open
                      ? { ...r.collapsed, [group.path]: true }
                      : Object.fromEntries(Object.entries(r.collapsed).filter(([path]) => path !== group.path)),
                  }))
                }
                className="flex w-full items-center gap-1 truncate px-2 py-0.5 text-left text-xs hover:bg-bg-muted"
                title={group.path}
              >
                {open ? (
                  <ChevronDown size={12} className="shrink-0" />
                ) : (
                  <ChevronRight size={12} className="shrink-0" />
                )}
                <File size={12} className="shrink-0 text-fg-subtle" />
                <span className="shrink-0">{baseName(group.path)}</span>
                <span className="min-w-0 truncate text-[11px] text-fg-subtle">{parentPath(group.path)}</span>
                <span className="ml-auto shrink-0 rounded-full bg-bg-muted px-1.5 text-[10px] text-fg-muted tabular-nums">
                  {group.matches.length}
                </span>
              </button>
              {open &&
                group.matches.map((match, index) => (
                  <MatchRow key={`${match.line}:${match.column}:${index}`} match={match} />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
