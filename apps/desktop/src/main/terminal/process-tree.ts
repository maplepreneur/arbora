import { execFileSync, spawnSync } from 'node:child_process';
import { terminalAgentName, type Platform } from '@arbora/shared';

/** Parses `ps -A -o pid= -o ppid=` output into child lists keyed by parent pid. */
export function parseProcessTable(output: string): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const line of output.split('\n')) {
    const [pidText, ppidText] = line.trim().split(/\s+/);
    const pid = Number(pidText);
    const ppid = Number(ppidText);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || pid <= 0) continue;
    const list = children.get(ppid);
    if (list) list.push(pid);
    else children.set(ppid, [pid]);
  }
  return children;
}

/** Every descendant of `root`, deepest first, so children die before their parents can respawn them. */
export function descendantsOf(root: number, children: ReadonlyMap<number, readonly number[]>): number[] {
  const result: number[] = [];
  const visit = (pid: number, seen: Set<number>): void => {
    for (const child of children.get(pid) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      visit(child, seen);
      result.push(child);
    }
  };
  visit(root, new Set([root]));
  return result;
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // Already gone.
  }
}

function processTable(): Map<number, number[]> {
  try {
    return parseProcessTable(
      execFileSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], { encoding: 'utf8', timeout: 2000 }),
    );
  } catch {
    return new Map();
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const KILL_GRACE_MS = 2000;

/**
 * Kills `pid` and everything it started. A dev server is usually `shell -> pnpm -> node -> esbuild`;
 * killing only the shell (what `pty.kill()` does) leaves node holding the port. Windows uses
 * `taskkill /T /F`; POSIX sends SIGTERM to the tree and its process groups, then SIGKILL to
 * survivors after a grace period.
 */
export function killProcessTree(pid: number, platform: Platform): void {
  if (platform === 'win32') {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true, timeout: 5000 });
    return;
  }
  const tree = [...descendantsOf(pid, processTable()), pid];
  for (const target of tree) signal(target, 'SIGTERM');
  // node-pty makes the shell a session leader, so its pid is also the process group id.
  signal(-pid, 'SIGTERM');
  setTimeout(() => {
    for (const target of tree) if (isAlive(target)) signal(target, 'SIGKILL');
    signal(-pid, 'SIGKILL');
  }, KILL_GRACE_MS).unref();
}

export interface ProcessSample {
  readonly rssKb: number;
  readonly cpuPercent: number;
  /** An agent CLI running somewhere in this process tree, when one is. */
  readonly agentCli: string | null;
}

interface SampleRow {
  readonly pid: number;
  readonly ppid: number;
  readonly rssKb: number;
  readonly cpu: number;
  readonly command: string;
}

/** Parses `ps -A -o pid= -o ppid= -o rss= -o pcpu= -o command=`. */
export function parseProcessSamples(output: string): SampleRow[] {
  const rows: SampleRow[] = [];
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/.exec(line);
    if (!match?.[1] || !match[2] || !match[3] || !match[4]) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssKb: Number(match[3]),
      cpu: Number(match[4]),
      command: match[5] ?? '',
    });
  }
  return rows;
}

/** Resident memory and CPU of `root` plus everything it started, and any agent CLI in that tree. */
export function treeSample(root: number, rows: readonly SampleRow[]): ProcessSample {
  const children = new Map<number, number[]>();
  const byPid = new Map<number, SampleRow>();
  for (const row of rows) {
    byPid.set(row.pid, row);
    const list = children.get(row.ppid);
    if (list) list.push(row.pid);
    else children.set(row.ppid, [row.pid]);
  }
  const pids = [root, ...descendantsOf(root, children)];
  let rssKb = 0;
  let cpuPercent = 0;
  let agentCli: string | null = null;
  for (const pid of pids) {
    const row = byPid.get(pid);
    if (!row) continue;
    rssKb += row.rssKb;
    cpuPercent += row.cpu;
    agentCli ??= terminalAgentName(row.command);
  }
  return { rssKb, cpuPercent, agentCli };
}

/** One `ps` of the machine. An empty list when `ps` is missing or slow. */
export function readProcessSamples(platform: Platform): SampleRow[] {
  if (platform === 'win32') return [];
  try {
    return parseProcessSamples(
      execFileSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'rss=', '-o', 'pcpu=', '-o', 'command='], {
        encoding: 'utf8',
        timeout: 2000,
      }),
    );
  } catch {
    return [];
  }
}
