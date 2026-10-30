import type { FileEntry, FileKind } from '@arbora/shared';

export type TreeRow =
  | { readonly kind: 'entry'; readonly entry: FileEntry; readonly depth: number }
  | { readonly kind: 'create'; readonly dir: string; readonly entryKind: FileKind; readonly depth: number };

/**
 * The rows the explorer shows, depth first: listed children of expanded folders, plus the inline
 * "new file/folder" input at the top of the folder it goes into.
 */
export function visibleRows(
  children: Readonly<Record<string, readonly FileEntry[]>>,
  expanded: Readonly<Record<string, unknown>>,
  creating: { readonly dir: string; readonly kind: FileKind } | null,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (dir: string, depth: number): void => {
    if (creating?.dir === dir) rows.push({ kind: 'create', dir, entryKind: creating.kind, depth });
    for (const entry of children[dir] ?? []) {
      rows.push({ kind: 'entry', entry, depth });
      if (entry.kind === 'directory' && entry.path in expanded) walk(entry.path, depth + 1);
    }
  };
  walk('', 0);
  return rows;
}

/** The target folder for a drop on `entry`: the folder itself, or a file's folder. */
export function dropFolder(entry: FileEntry | null): string {
  if (!entry) return '';
  if (entry.kind === 'directory') return entry.path;
  const slash = entry.path.lastIndexOf('/');
  return slash === -1 ? '' : entry.path.slice(0, slash);
}

/** Valid new names (`a/b.ts` creates the folder too). Returns an error message or null. */
export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'A name is required';
  if (trimmed === '.' || trimmed === '..') return 'That name is reserved';
  if (trimmed.includes('\\')) return 'Use / to create nested folders';
  if (trimmed.startsWith('/') || trimmed.endsWith('/') || trimmed.includes('//'))
    return 'Names cannot start or end with a slash';
  if (trimmed.split('/').some((part) => part === '.' || part === '..')) return 'That name is reserved';
  if (/[<>:"|?*]/.test(trimmed) || trimmed.includes('\u0000')) return 'Names cannot contain < > : " | ? *';
  return null;
}
