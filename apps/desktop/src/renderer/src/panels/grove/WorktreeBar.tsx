import { useState } from 'react';
import { useApp } from '../../store';
import {
  discardWorktree,
  focusGroveProject,
  installWorktree,
  keepWorktree,
  mergeWorktree,
  pullRequestWorktree,
} from '../../grove-store';

function nameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

const action =
  'h-6 rounded border border-border px-1.5 text-[11px] text-fg-muted hover:bg-bg-muted hover:text-fg disabled:opacity-50';

/**
 * Actions for a Grove worktree: its port, a pull request or merge into the parent, installing
 * dependencies, and (for a best-of-N set) keep or discard.
 */
export function WorktreeBar({ path }: { path: string }) {
  const projects = useApp((s) => s.settings.grove.projects);
  const sets = useApp((s) => s.settings.grove.bestOf);
  const entry = projects.find((project) => project.path === path);
  const asCandidate = sets.find((set) => set.candidates.some((candidate) => candidate.path === path));
  const asParent = sets.find((set) => set.parentPath === path);
  const [pending, setPending] = useState<string | null>(null);
  if (!entry?.parentPath && !asParent) return null;

  const run = (id: string, actionFn: () => Promise<void>): void => {
    if (pending) return;
    setPending(id);
    void actionFn().finally(() => setPending(null));
  };

  const title = asCandidate?.task || nameOf(path);
  return (
    <div className="mb-1 flex flex-col gap-1 px-1.5" data-testid="worktree-bar">
      {entry?.parentPath && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-fg-subtle">
            {entry.port ? `Port ${entry.port}` : 'Worktree'}
            {entry.modules === 'linked' ? ' · dependencies linked' : ''}
          </span>
          <button
            type="button"
            data-testid="worktree-pr"
            disabled={pending !== null}
            onClick={() => run('pr', () => pullRequestWorktree(path, title))}
            className={action}
          >
            Pull request
          </button>
          <button
            type="button"
            data-testid="worktree-merge"
            disabled={pending !== null}
            onClick={() => run('merge', () => mergeWorktree(path))}
            className={action}
          >
            Merge into parent
          </button>
          {entry.modules === 'linked' ? (
            <button
              type="button"
              data-testid="worktree-install"
              disabled={pending !== null}
              onClick={() => run('install', () => installWorktree(path))}
              className={action}
            >
              Install a separate copy
            </button>
          ) : (
            <button
              type="button"
              data-testid="worktree-install"
              disabled={pending !== null}
              onClick={() => run('install', () => installWorktree(path))}
              className={action}
            >
              Install dependencies
            </button>
          )}
        </div>
      )}
      {asCandidate && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-fg-subtle">
            {asCandidate.candidates.findIndex((candidate) => candidate.path === path) + 1} of{' '}
            {asCandidate.candidates.length} for this task
          </span>
          <button
            type="button"
            data-testid="worktree-keep"
            disabled={pending !== null}
            onClick={() => run('keep', () => keepWorktree(path))}
            className={action}
          >
            Keep this one
          </button>
          <button
            type="button"
            data-testid="worktree-discard"
            disabled={pending !== null}
            onClick={() => run('discard', () => discardWorktree(path))}
            className={action}
          >
            Discard
          </button>
        </div>
      )}
      {asParent && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-fg-subtle">Best of {asParent.candidates.length}</span>
          {asParent.candidates.map((candidate) => (
            <button
              key={candidate.path}
              type="button"
              data-testid="worktree-open"
              onClick={() => void focusGroveProject(candidate.path)}
              className="truncate text-left text-[11px] text-fg-muted hover:text-fg"
            >
              {nameOf(candidate.path)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
