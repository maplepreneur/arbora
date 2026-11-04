/** A git branch name from a Grove task title. Empty and punctuation-only titles become `grove-session`. */
export function worktreeBranchName(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'grove-session';
}

function folder(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

/** A sibling of the parent checkout: `/code/app` and `fix-nav` become `/code/app-fix-nav`. */
export function worktreeDirectory(parentPath: string, branch: string): string {
  const trimmed = parentPath.replace(/[\\/]+$/, '');
  const sep = trimmed.includes('\\') && !trimmed.includes('/') ? '\\' : '/';
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const parent = cut <= 0 ? trimmed.slice(0, cut + 1) || '.' : trimmed.slice(0, cut);
  const joiner = parent.endsWith('/') || parent.endsWith('\\') ? '' : sep;
  return `${parent}${joiner}${folder(trimmed)}-${branch}`;
}
