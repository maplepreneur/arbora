import { structuredPatch } from 'diff';

export type DiffLineKind = 'context' | 'add' | 'remove' | 'hunk';

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
}

export interface DiffSummary {
  readonly lines: DiffLine[];
  readonly additions: number;
  readonly deletions: number;
}

/**
 * Unified diff lines between two texts with `context` lines around each hunk. A missing `oldText`
 * (a new file) shows every line as an addition.
 */
export function unifiedDiff(oldText: string | null | undefined, newText: string, context = 3): DiffSummary {
  const patch = structuredPatch('a', 'b', oldText ?? '', newText, '', '', { context });
  const lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  for (const hunk of patch.hunks) {
    lines.push({
      kind: 'hunk',
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      oldLine: null,
      newLine: null,
    });
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const raw of hunk.lines) {
      const marker = raw[0];
      const text = raw.slice(1);
      if (marker === '+') {
        additions++;
        lines.push({ kind: 'add', text, oldLine: null, newLine: newLine++ });
      } else if (marker === '-') {
        deletions++;
        lines.push({ kind: 'remove', text, oldLine: oldLine++, newLine: null });
      } else if (marker === '\\') {
        // "\ No newline at end of file" markers carry no content.
        continue;
      } else {
        lines.push({ kind: 'context', text, oldLine: oldLine++, newLine: newLine++ });
      }
    }
  }
  return { lines, additions, deletions };
}
