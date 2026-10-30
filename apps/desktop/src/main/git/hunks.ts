import type { GitHunk, GitLine } from '@arbora/shared';

/** Splits a unified diff into hunks, keeping git's own file headers for `git apply`. */
export function hunksOf(diff: string): GitHunk[] {
  const start = diff.search(/^@@/m);
  if (start < 0) return [];
  const body = diff.slice(start);
  const parts = body.split(/^(?=@@)/m).filter((part) => part.startsWith('@@'));
  return parts.map((part, index) => {
    const newline = part.indexOf('\n');
    const header = newline === -1 ? part : part.slice(0, newline);
    return { index, header, text: part.endsWith('\n') ? part : `${part}\n` };
  });
}

/** A patch containing only the selected hunks. Headers before the first hunk stay. */
export function patchWithHunks(diff: string, indexes: readonly number[]): string {
  const start = diff.search(/^@@/m);
  if (start < 0) throw new Error('The diff has no hunks');
  const wanted = new Set(indexes);
  const hunks = hunksOf(diff).filter((hunk) => wanted.has(hunk.index));
  if (hunks.length === 0) throw new Error('No hunks selected');
  return diff.slice(0, start) + hunks.map((hunk) => hunk.text).join('');
}

/** New-file lines a unified diff adds or replaces, for the editor gutter. */
export function changedLines(diff: string): GitLine[] {
  const lines: GitLine[] = [];
  for (const hunk of hunksOf(diff)) {
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(hunk.header);
    if (!match) continue;
    let line = Number(match[1]);
    const kind = hunk.text.includes('\n-') ? 'modified' : 'added';
    for (const row of hunk.text.split('\n').slice(1)) {
      if (row.startsWith('+')) {
        lines.push({ line, kind });
        line += 1;
      } else if (row.startsWith('-')) {
        continue;
      } else if (row.startsWith('\\')) {
        continue;
      } else {
        line += 1;
      }
    }
  }
  return lines;
}
