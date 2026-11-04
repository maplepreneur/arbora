import type { FileEdit, SessionActivity } from '@arbora/shared';
import { unifiedDiff } from '../agent/diff-view';

export interface EditStats {
  readonly additions: number;
  readonly deletions: number;
}

export interface SessionStats extends EditStats {
  readonly files: number;
}

// `reduceActivity` keeps the `FileEdit` of every file a new event did not touch, so each one is
// diffed once.
const known = new WeakMap<FileEdit, EditStats>();

/** Changed lines between the file before the session's first edit and after its last one. */
export function editStats(edit: FileEdit): EditStats {
  const cached = known.get(edit);
  if (cached) return cached;
  const { additions, deletions } = unifiedDiff(edit.oldText, edit.newText, 0);
  const stats = { additions, deletions };
  known.set(edit, stats);
  return stats;
}

/** A row's `+12 −3`: every file the session edited, added up. */
export function sessionStats(activity: SessionActivity): SessionStats {
  const edits = Object.values(activity.files);
  let additions = 0;
  let deletions = 0;
  for (const edit of edits) {
    const stats = editStats(edit);
    additions += stats.additions;
    deletions += stats.deletions;
  }
  return { additions, deletions, files: edits.length };
}
