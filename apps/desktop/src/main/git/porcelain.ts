import type { GitFile, GitStatus } from '@arbora/shared';

const EMPTY: GitStatus = {
  repo: true,
  branch: null,
  detached: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  files: [],
};

/**
 * Parses `git status --porcelain=v2 --branch` (newline form, not `-z`).
 * Rename entries put the old path after a tab.
 */
export function parsePorcelain(text: string): GitStatus {
  const status: GitStatus = { ...EMPTY, files: [] };
  for (const line of text.split('\n')) {
    if (line === '') continue;
    if (line.startsWith('#')) {
      applyHeader(status, line);
      continue;
    }
    const file = parseEntry(line);
    if (file) status.files.push(file);
  }
  return status;
}

function applyHeader(status: GitStatus, line: string): void {
  const rest = line.slice(2);
  if (rest.startsWith('branch.head ')) {
    const name = rest.slice('branch.head '.length);
    if (name === '(detached)') {
      status.detached = true;
      status.branch = null;
    } else status.branch = name;
    return;
  }
  if (rest.startsWith('branch.upstream ')) {
    status.upstream = rest.slice('branch.upstream '.length);
    return;
  }
  if (rest.startsWith('branch.ab ')) {
    const match = /^\+(-?\d+) -(-?\d+)$/.exec(rest.slice('branch.ab '.length));
    if (match) {
      status.ahead = Number(match[1]);
      status.behind = Number(match[2]);
    }
  }
}

function parseEntry(line: string): GitFile | null {
  const kind = line[0];
  if (kind === '?') return file(line.slice(2), { untracked: true, index: '?', worktree: '?' });
  if (kind === '!') return file(line.slice(2), { index: '!', worktree: '!' });
  const parts = line.split(' ');
  if (kind === '1' && parts.length >= 9) {
    const [index, worktree] = letters(parts[1] ?? '..');
    return file(parts.slice(8).join(' '), { index, worktree });
  }
  if (kind === '2' && parts.length >= 10) {
    const [index, worktree] = letters(parts[1] ?? '..');
    const [path, orig] = parts.slice(9).join(' ').split('\t');
    return file(path ?? '', { index, worktree, ...(orig ? { origPath: orig } : {}) });
  }
  if (kind === 'u' && parts.length >= 11) {
    const [index, worktree] = letters(parts[1] ?? 'UU');
    return file(parts.slice(10).join(' '), { index, worktree, conflict: true });
  }
  return null;
}

function letters(xy: string): [string, string] {
  return [xy[0] ?? '.', xy[1] ?? '.'];
}

function file(
  path: string,
  extra: { index: string; worktree: string; untracked?: boolean; conflict?: boolean; origPath?: string },
): GitFile {
  return {
    path,
    index: extra.index,
    worktree: extra.worktree,
    untracked: extra.untracked ?? false,
    conflict: extra.conflict ?? false,
    ...(extra.origPath ? { origPath: extra.origPath } : {}),
  };
}
