import { useMemo, useState } from 'react';
import { CircleX, Info, Trash2, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { type Diagnostic, type ProblemEntry, type ProblemLevel } from '@arbora/shared';
import { allDiagnostics, openFile, useFiles } from '../files-store';
import { fixDiagnostics, fixPageProblems } from '../fix-problems';
import { setTabProblems, useApp } from '../store';

type Scope = 'page' | 'code';

type Filter = 'errors' | 'warnings' | 'all';

const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: 'errors', label: 'Errors' },
  { id: 'warnings', label: 'Errors & warnings' },
  { id: 'all', label: 'All' },
];

function matches(filter: Filter, level: ProblemLevel): boolean {
  switch (filter) {
    case 'errors':
      return level === 'error';
    case 'warnings':
      return level === 'error' || level === 'warning';
    case 'all':
      return true;
    default: {
      const unreachable: never = filter;
      return unreachable;
    }
  }
}

function levelIcon(level: ProblemLevel): { icon: LucideIcon; className: string } {
  switch (level) {
    case 'error':
      return { icon: CircleX, className: 'text-danger' };
    case 'warning':
      return { icon: TriangleAlert, className: 'text-amber-500' };
    case 'info':
    case 'debug':
      return { icon: Info, className: 'text-fg-subtle' };
    default: {
      const unreachable: never = level;
      return unreachable;
    }
  }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** `src/App.tsx:22:31` for same-origin scripts, the full URL otherwise. */
function formatSource(entry: ProblemEntry, pageUrl: string): string {
  if (!entry.url) return '';
  let label = entry.url;
  try {
    const url = new URL(entry.url);
    const page = new URL(pageUrl);
    if (url.origin === page.origin) label = `${url.pathname.replace(/^\//, '')}${url.search}` || '/';
  } catch {
    // Not a URL (e.g. "<anonymous>"); show as is.
  }
  if (entry.line !== undefined) label += `:${entry.line}`;
  if (entry.column !== undefined) label += `:${entry.column}`;
  return label;
}

function FixButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-testid="problem-fix"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex h-5 shrink-0 items-center gap-1 rounded border border-border bg-bg px-1.5 font-sans text-[11px] text-fg-muted opacity-0 group-hover:opacity-100 hover:border-accent hover:text-accent focus-visible:opacity-100"
    >
      <Wrench size={11} />
      Fix
    </button>
  );
}

function ProblemRow({ entry, pageUrl }: { entry: ProblemEntry; pageUrl: string }) {
  const { icon: Icon, className } = levelIcon(entry.level);
  const source = formatSource(entry, pageUrl);
  const message = entry.source === 'network' && entry.method ? `${entry.method} ${entry.message}` : entry.message;
  return (
    <li
      data-testid="problem-row"
      data-level={entry.level}
      data-source={entry.source}
      className="group flex items-start gap-2 border-b border-border/60 px-3 py-1 font-mono text-[11px] leading-5 hover:bg-bg-muted/50"
    >
      <span className="shrink-0 text-fg-subtle tabular-nums" data-testid="problem-time">
        {formatTime(entry.timestamp)}
      </span>
      <Icon size={13} className={clsx('mt-1 shrink-0', className)} />
      <span className="min-w-0 flex-1 break-words whitespace-pre-wrap text-fg" data-testid="problem-message">
        {message}
      </span>
      {source && (
        <span className="max-w-[45%] shrink-0 truncate text-fg-subtle" title={entry.url} data-testid="problem-source">
          {source}
        </span>
      )}
      <FixButton label="Fix this problem with an agent" onClick={() => void fixPageProblems([entry])} />
    </li>
  );
}

function DiagnosticRow({ diagnostic }: { diagnostic: Diagnostic }) {
  const { icon: Icon, className } = levelIcon(diagnostic.severity);
  return (
    <li className="group flex items-start border-b border-border/60 pr-3 hover:bg-bg-muted">
      <button
        type="button"
        data-testid="diagnostic-row"
        data-source={diagnostic.source}
        data-level={diagnostic.severity}
        onClick={() =>
          openFile(diagnostic.path, { pinned: true, at: { line: diagnostic.line, column: diagnostic.column } })
        }
        className="flex min-w-0 flex-1 items-start gap-2 py-1 pr-2 pl-3 text-left font-mono text-[11px] leading-5"
      >
        <Icon size={13} className={clsx('mt-1 shrink-0', className)} />
        <span className="min-w-0 flex-1 break-words whitespace-pre-wrap text-fg">{diagnostic.message}</span>
        <span className="shrink-0 text-fg-subtle">
          {diagnostic.source}
          {diagnostic.code ? `(${diagnostic.code})` : ''}
        </span>
        <span className="max-w-[40%] shrink-0 truncate text-fg-subtle" data-testid="diagnostic-location">
          {diagnostic.path}:{diagnostic.line}:{diagnostic.column}
        </span>
      </button>
      <span className="pt-1">
        <FixButton label="Fix this problem with an agent" onClick={() => void fixDiagnostics([diagnostic])} />
      </span>
    </li>
  );
}

export default function ProblemsPanel() {
  const tabs = useApp((s) => s.browserTabs);
  const problemsByTab = useApp((s) => s.problemsByTab);
  const appTabId = tabs.find((tab) => tab.role === 'app')?.id ?? '';
  const [chosenTab, setChosenTab] = useState<string | null>(null);
  const selectedTab = chosenTab && tabs.some((tab) => tab.id === chosenTab) ? chosenTab : appTabId;
  const problems = useMemo(() => problemsByTab[selectedTab] ?? [], [problemsByTab, selectedTab]);
  const pageUrl = tabs.find((tab) => tab.id === selectedTab)?.url ?? '';
  const diagnosticsByPath = useFiles((s) => s.diagnostics);
  const diagnostics = useMemo(() => allDiagnostics({ diagnostics: diagnosticsByPath }), [diagnosticsByPath]);
  const [scope, setScope] = useState<Scope>('page');
  const [filter, setFilter] = useState<Filter>('warnings');
  const visible = useMemo(() => problems.filter((p) => matches(filter, p.level)), [problems, filter]);
  const visibleDiagnostics = useMemo(
    () => diagnostics.filter((d) => matches(filter, d.severity)),
    [diagnostics, filter],
  );
  const source = scope === 'page' ? problems.map((p) => p.level) : diagnostics.map((d) => d.severity);
  const errors = source.filter((level) => level === 'error').length;
  const warnings = source.filter((level) => level === 'warning').length;
  const codeErrors = diagnostics.filter((d) => d.severity === 'error').length;
  const fixCount = scope === 'page' ? visible.length : visibleDiagnostics.length;

  return (
    <div className="flex h-full flex-col" data-testid="problems-panel" data-scope={scope}>
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2 text-xs">
        {(['page', 'code'] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={scope === id}
            data-testid={`problems-scope-${id}`}
            onClick={() => setScope(id)}
            className={clsx(
              'h-6 shrink-0 rounded px-2 whitespace-nowrap',
              scope === id ? 'bg-bg-muted font-medium text-fg' : 'text-fg-subtle hover:text-fg',
            )}
          >
            {id === 'page' ? 'Page' : 'Code'}
            {id === 'code' && codeErrors > 0 && <span className="ml-1 text-danger tabular-nums">{codeErrors}</span>}
          </button>
        ))}
        {scope === 'page' && tabs.length > 1 && (
          <select
            data-testid="problems-tab"
            aria-label="Browser tab"
            value={selectedTab}
            onChange={(event) => {
              const id = event.target.value;
              setChosenTab(id);
              void window.arbora.invoke('browser.tabs.problems', { id }).then((entries) => setTabProblems(id, entries));
            }}
            className="h-6 max-w-40 shrink-0 truncate rounded border border-border bg-bg px-1 text-fg"
          >
            {tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.role === 'app' ? 'App' : tab.title || 'Reference'}
              </option>
            ))}
          </select>
        )}
        <span className="mx-1 h-4 w-px bg-border" />
        {FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            data-testid={`problems-filter-${id}`}
            onClick={() => setFilter(id)}
            className={clsx(
              'h-6 shrink-0 rounded px-2 whitespace-nowrap',
              filter === id ? 'bg-bg-muted text-fg' : 'text-fg-subtle hover:text-fg',
            )}
          >
            {label}
          </button>
        ))}
        <span className="ml-2 truncate whitespace-nowrap text-fg-subtle" data-testid="problems-counts">
          {errors} errors · {warnings} warnings
        </span>
        <button
          type="button"
          data-testid="problems-fix-all"
          title={`Send the ${fixCount} problem${fixCount === 1 ? '' : 's'} shown here to an agent to fix`}
          disabled={fixCount === 0}
          onClick={() => void (scope === 'page' ? fixPageProblems(visible) : fixDiagnostics(visibleDiagnostics))}
          className="ml-auto flex h-6 shrink-0 items-center gap-1 rounded border border-border px-2 whitespace-nowrap text-fg-muted hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-border disabled:hover:text-fg-muted"
        >
          <Wrench size={12} />
          {fixCount > 1 ? `Fix all ${fixCount}` : 'Fix'}
        </button>
        {scope === 'page' && (
          <button
            type="button"
            title="Clear"
            aria-label="Clear problems"
            data-testid="problems-clear"
            onClick={() => {
              if (selectedTab) void window.arbora.invoke('browser.tabs.clearProblems', { id: selectedTab });
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {scope === 'code' ? (
        visibleDiagnostics.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-xs text-fg-subtle" data-testid="problems-empty">
            {diagnostics.length === 0 ? 'No ESLint or tsc problems in saved files' : 'Nothing matches this filter'}
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-auto">
            {visibleDiagnostics.map((diagnostic, index) => (
              <DiagnosticRow
                key={`${diagnostic.path}:${diagnostic.line}:${diagnostic.column}:${index}`}
                diagnostic={diagnostic}
              />
            ))}
          </ul>
        )
      ) : visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-fg-subtle" data-testid="problems-empty">
          {problems.length === 0 ? 'No problems from the page yet' : 'Nothing matches this filter'}
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto">
          {visible.map((entry) => (
            <ProblemRow key={entry.id} entry={entry} pageUrl={pageUrl} />
          ))}
        </ul>
      )}
    </div>
  );
}
