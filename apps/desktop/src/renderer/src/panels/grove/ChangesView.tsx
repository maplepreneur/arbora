import { useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, FileText, TriangleAlert } from 'lucide-react';
import type { GroveSession } from '../../grove-model';
import { openAgentDiff, relativePath } from '../agent/Transcript';
import { UnifiedDiff } from '../agent/UnifiedDiff';
import { editStats } from './changes';
import { DiffStat } from './SessionList';

/** The files this session edited, each with its counts; a row opens to the session's whole diff of it. */
export function ChangesView({
  session,
  projectPath,
  nameOf,
}: {
  session: GroveSession;
  projectPath: string;
  nameOf: (threadId: string) => string;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const files = Object.entries(session.activity.files);
  if (files.length === 0) {
    return (
      <div
        data-testid="grove-changes-empty"
        className="flex flex-1 items-center justify-center p-6 text-center text-xs text-fg-subtle"
      >
        No file edits from this agent yet. They show here as it makes them.
      </div>
    );
  }
  const toggle = (path: string): void =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  return (
    <div data-testid="grove-changes" className="min-h-0 flex-1 overflow-y-auto p-2">
      <ul className="flex flex-col gap-1.5">
        {files.map(([path, edit]) => {
          const shown = relativePath(path, projectPath);
          const expanded = open.has(path);
          const others = session.overlaps
            .filter((overlap) => overlap.path === path)
            .map((o) => nameOf(o.otherThreadId));
          return (
            <li key={path} data-testid="grove-change" data-path={shown} className="rounded border border-border bg-bg">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => toggle(path)}
                className={clsx(
                  'flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-bg-muted',
                  expanded && 'border-b border-border',
                )}
              >
                {expanded ? (
                  <ChevronDown size={12} className="shrink-0" />
                ) : (
                  <ChevronRight size={12} className="shrink-0" />
                )}
                <FileText size={13} className="shrink-0 text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" title={path}>
                  {shown}
                </span>
                {edit.oldText === null && (
                  <span className="shrink-0 rounded bg-bg-muted px-1 text-[10px] text-fg-subtle uppercase">new</span>
                )}
                {others.length > 0 && (
                  <span
                    data-testid="grove-change-overlap"
                    title={`Also edited by ${others.join(', ')}`}
                    className="shrink-0 text-amber-500"
                  >
                    <TriangleAlert size={12} />
                  </span>
                )}
                <DiffStat stats={editStats(edit)} />
              </button>
              {expanded && (
                <div className="p-1.5">
                  <UnifiedDiff
                    oldText={edit.oldText}
                    newText={edit.newText}
                    path={shown}
                    onOpen={() => openAgentDiff(shown, edit.oldText, edit.newText)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
