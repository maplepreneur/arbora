const LANGUAGE_IDS: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
};

/** LSP language id for a file the TypeScript server understands, or null. */
export function languageIdForPath(path: string): string | null {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const base = path.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  return LANGUAGE_IDS[base.slice(dot).toLowerCase()] ?? null;
}

/** A project-relative editor path as an absolute path. Already-absolute paths are unchanged. */
export function absoluteProjectPath(projectPath: string, filePath: string): string {
  if (filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)) return filePath;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  return `${projectPath.replace(/[\\/]$/, '')}${sep}${filePath.replaceAll('/', sep)}`;
}

/** The editor's project-relative path, or null when `absolute` is outside the project. */
export function relativeProjectPath(projectPath: string, absolute: string): string | null {
  const sep = projectPath.includes('\\') ? '\\' : '/';
  const root = `${projectPath.replace(/[\\/]$/, '')}${sep}`;
  const file = sep === '\\' ? absolute.replaceAll('/', '\\') : absolute;
  if (!file.startsWith(root)) return null;
  const relative = file.slice(root.length);
  return sep === '\\' ? relative.replaceAll('\\', '/') : relative;
}

/** `file://` URI for an absolute path. Drive letters stay unescaped. */
export function fileUriFromPath(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/');
  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const encoded = prefixed
    .split('/')
    .map((part) => (/^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)))
    .join('/');
  return `file://${encoded}`;
}

/** Absolute path from a `file://` URI, or null when it is not one. Windows paths use backslashes. */
export function pathFromFileUri(uri: string): string | null {
  if (!uri.startsWith('file://')) return null;
  let rest = uri.slice('file://'.length);
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (/^\/[A-Za-z]:\//.test(rest)) return rest.slice(1).replace(/\//g, '\\');
  return rest;
}

/** Drops script tags and inline handlers from language-server Markdown HTML. */
export function sanitizeLspHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}
