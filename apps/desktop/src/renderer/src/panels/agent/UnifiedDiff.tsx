import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { unifiedDiff, type DiffLineKind } from './diff-view';

const MAX_VISIBLE_LINES = 400;

const LINE_CLASS: Readonly<Record<DiffLineKind, string>> = {
  context: 'text-fg-muted',
  add: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  remove: 'bg-red-500/15 text-red-700 dark:text-red-300',
  hunk: 'bg-bg-muted text-fg-subtle',
};

const MARKER: Readonly<Record<DiffLineKind, string>> = { context: ' ', add: '+', remove: '-', hunk: '' };

/** A compact inline diff for transcript cards; `onOpen` shows it in the full diff viewer. */
export function UnifiedDiff({
  oldText,
  newText,
  path,
  onOpen,
}: {
  oldText: string | null | undefined;
  newText: string;
  path: string;
  onOpen?: () => void;
}) {
  const diff = useMemo(() => unifiedDiff(oldText, newText), [oldText, newText]);
  const [expanded, setExpanded] = useState(false);
  const lines = expanded ? diff.lines : diff.lines.slice(0, MAX_VISIBLE_LINES);
  const hidden = diff.lines.length - lines.length;
  return (
    <div className="overflow-hidden rounded border border-border text-[11px]" data-testid="diff" data-path={path}>
      <div className="flex items-center gap-2 border-b border-border bg-bg-muted px-2 py-1 font-mono">
        <span className="truncate" title={path}>
          {path}
        </span>
        <span className="ml-auto shrink-0 text-emerald-600 dark:text-emerald-400">+{diff.additions}</span>
        <span className="shrink-0 text-red-600 dark:text-red-400">−{diff.deletions}</span>
        {onOpen && (
          <button
            type="button"
            data-testid="diff-open"
            onClick={onOpen}
            className="shrink-0 rounded px-1 font-sans text-fg-subtle hover:bg-bg hover:text-fg"
          >
            Open diff
          </button>
        )}
      </div>
      {diff.lines.length === 0 ? (
        <div className="px-2 py-1 text-fg-subtle">No changes</div>
      ) : (
        <pre className="m-0 max-h-[60vh] overflow-auto font-mono leading-[1.45] select-text">
          {lines.map((line, index) => (
            <div key={index} className={clsx('flex', LINE_CLASS[line.kind])}>
              <span className="w-9 shrink-0 select-none pr-1 text-right text-fg-subtle/70 tabular-nums">
                {line.oldLine ?? ''}
              </span>
              <span className="w-9 shrink-0 select-none pr-1 text-right text-fg-subtle/70 tabular-nums">
                {line.newLine ?? ''}
              </span>
              <span className="w-3 shrink-0 select-none">{MARKER[line.kind]}</span>
              <span className="whitespace-pre">{line.text}</span>
            </div>
          ))}
        </pre>
      )}
      {hidden > 0 && (
        <button
          type="button"
          className="w-full border-t border-border py-1 text-fg-subtle hover:bg-bg-muted hover:text-fg"
          onClick={() => setExpanded(true)}
        >
          Show {hidden} more lines
        </button>
      )}
    </div>
  );
}
