import type { PackageManager } from './terminal.js';

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

/** One agent's branch in a best-of-N set: `fix-the-nav` and `claude` become `fix-the-nav-claude`. */
export function worktreeBranchForAgent(title: string, agentId: string): string {
  const base = worktreeBranchName(title);
  const agent =
    agentId
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 16) || 'agent';
  const room = 60 - agent.length - 1;
  return `${base.slice(0, Math.max(room, 1))}-${agent}`;
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

/** The explicit port in an http(s) dev URL, or null when the URL has none or does not parse. */
export function portOfDevUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.port) return null;
    const port = Number(parsed.port);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

/** The first port at or after `start` that is not in `taken`, staying inside 1–65535. */
export function nextWorktreePort(start: number, taken: readonly number[]): number {
  const used = new Set(taken);
  const first = Math.min(Math.max(Math.trunc(start), 1), 65535);
  for (let port = first; port <= 65535 && port < first + 100; port += 1) {
    if (!used.has(port)) return port;
  }
  return first;
}

/** `parentUrl` with `port` swapped in. A missing or unusable URL becomes `http://127.0.0.1:<port>/`. */
export function worktreeDevUrl(parentUrl: string | null | undefined, port: number): string {
  if (parentUrl) {
    try {
      const parsed = new URL(parentUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        parsed.port = String(port);
        return parsed.toString();
      }
    } catch {
      // The fallback below is the URL the browser can open.
    }
  }
  return `http://127.0.0.1:${port}/`;
}

function isPackageScript(command: string): boolean {
  return /^(?:pnpm|npm|yarn|bun)(?:\.cmd)?(?:\s+run)?\s+\S+/.test(command);
}

/**
 * The parent's dev command pinned to `port`, so the worktree does not bind the same port.
 * Package scripts get ` -- --port` (the extra `--` forwards the flag). Rails gets `-p`.
 * A command that already names a port keeps its flag and only the number changes.
 */
export function worktreeDevCommand(command: string, port: number): string {
  const trimmed = command.trim();
  if (/--port(?:=|\s+)\d+/.test(trimmed)) {
    return trimmed.replace(/--port=\d+/, `--port=${port}`).replace(/--port\s+\d+/, `--port ${port}`);
  }
  if (/\brails\b/.test(trimmed)) {
    if (/(?:^|\s)-p\s+\d+/.test(trimmed)) return trimmed.replace(/((?:^|\s)-p\s+)\d+/, `$1${port}`);
    return `${trimmed} -p ${port}`;
  }
  if (isPackageScript(trimmed)) return `${trimmed} -- --port ${port}`;
  return `${trimmed} --port ${port}`;
}

export interface WorktreeDevPlan {
  readonly port: number;
  readonly devUrl: string;
  readonly devCommand: string | null;
}

/**
 * The port, URL and command for a new worktree. The parent's port is treated as taken, and the
 * search starts at the next one (or 5174 when the parent has no dev URL).
 */
export function worktreeDevPlan(input: {
  readonly parentDevUrl?: string | undefined;
  readonly parentCommand: string | null;
  readonly takenPorts: readonly number[];
}): WorktreeDevPlan {
  const parentPort = portOfDevUrl(input.parentDevUrl);
  const taken = parentPort === null ? input.takenPorts : [...input.takenPorts, parentPort];
  const port = nextWorktreePort((parentPort ?? 5173) + 1, taken);
  return {
    port,
    devUrl: worktreeDevUrl(input.parentDevUrl, port),
    devCommand: input.parentCommand ? worktreeDevCommand(input.parentCommand, port) : null,
  };
}

/** `pnpm install` and the equivalent for the other managers Grove already detects. */
export function packageInstallCommand(manager: PackageManager): string {
  switch (manager) {
    case 'pnpm':
      return 'pnpm install';
    case 'yarn':
      return 'yarn install';
    case 'bun':
      return 'bun install';
    case 'npm':
      return 'npm install';
    default: {
      const unreachable: never = manager;
      throw new Error(`Unknown package manager ${String(unreachable)}`);
    }
  }
}
