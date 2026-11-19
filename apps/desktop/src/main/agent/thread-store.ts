import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  agentGroupsFileSchema,
  idleThreadState,
  THREAD_FILE_VERSION,
  threadFileSchema,
  threadSchema,
  type AgentGroup,
  type Thread,
  type ThreadFile,
  type ThreadSummary,
} from '@arbora/shared';
import { ARBORA_DIR, ensureArboraGitignore } from '../project-settings.js';
import { writeJsonAtomic } from '../settings-store.js';

export function threadsDir(projectPath: string): string {
  return join(projectPath, ARBORA_DIR, 'threads');
}

export function agentGroupsPath(projectPath: string): string {
  return join(projectPath, ARBORA_DIR, 'agent-groups.json');
}

/** `.arbora/agent-groups.json`: the project's agent groups, in display order. */
export class AgentGroupStore {
  private cache: AgentGroup[] | null = null;

  constructor(private readonly projectPath: string) {}

  list(): AgentGroup[] {
    if (this.cache) return this.cache;
    const file = agentGroupsPath(this.projectPath);
    let groups: AgentGroup[] = [];
    if (existsSync(file)) {
      try {
        const parsed = agentGroupsFileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
        if (parsed.success) groups = parsed.data.groups;
      } catch {
        // An unreadable file means no groups; the next save replaces it.
      }
    }
    this.cache = groups;
    return groups;
  }

  save(groups: AgentGroup[]): AgentGroup[] {
    writeJsonAtomic(agentGroupsPath(this.projectPath), { version: 1, groups });
    this.cache = groups;
    return groups;
  }
}

/** The persisted form of a thread: metadata plus the terminal tail (no protocol transcript). */
export function threadFileOf(thread: Thread): ThreadFile {
  return {
    version: THREAD_FILE_VERSION,
    id: thread.id,
    agentId: thread.agentId,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    groupId: thread.groupId,
    pinned: thread.pinned,
    archivedAt: thread.archivedAt,
    parentThreadId: thread.parentThreadId,
    lastLines: thread.lastLines.slice(-200),
  };
}

/**
 * A v1 file (the ACP era) keeps its metadata but drops its protocol transcript; the thread is
 * restored Stopped, like any thread whose process is gone.
 */
function migrateV1(input: Record<string, unknown>): ThreadFile | null {
  const carried = threadFileSchema.safeParse({
    version: THREAD_FILE_VERSION,
    id: input['id'],
    agentId: input['agentId'],
    title: input['title'],
    createdAt: input['createdAt'],
    updatedAt: input['updatedAt'],
    groupId: input['groupId'] ?? null,
    pinned: input['pinned'] ?? false,
    archivedAt: input['archivedAt'] ?? null,
    parentThreadId: input['parentThreadId'] ?? null,
    lastLines: [],
  });
  return carried.success ? carried.data : null;
}

/** `.arbora/threads/<id>.json`, one file per thread. */
export class ThreadStore {
  constructor(private readonly projectPath: string) {}

  list(): ThreadSummary[] {
    const dir = threadsDir(this.projectPath);
    if (!existsSync(dir)) return [];
    const threads: ThreadSummary[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const loaded = this.read(join(dir, name));
      if (loaded) threads.push(loaded.summary);
    }
    return threads.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  load(id: string): Thread | null {
    return this.read(this.pathFor(id))?.thread ?? null;
  }

  save(thread: Thread): void {
    writeJsonAtomic(this.pathFor(thread.id), threadFileOf(thread));
    ensureArboraGitignore(this.projectPath);
  }

  delete(id: string): void {
    rmSync(this.pathFor(id), { force: true });
  }

  ensureDir(): void {
    mkdirSync(threadsDir(this.projectPath), { recursive: true });
    ensureArboraGitignore(this.projectPath);
  }

  private pathFor(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error(`Invalid thread id ${id}`);
    return join(threadsDir(this.projectPath), `${id}.json`);
  }

  private read(file: string): { thread: Thread; summary: ThreadSummary } | null {
    if (!existsSync(file)) return null;
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
      let parsed = threadFileSchema.safeParse(raw);
      if (!parsed.success && raw !== null && typeof raw === 'object') {
        const migrated = migrateV1(raw as Record<string, unknown>);
        parsed = migrated ? ({ success: true as const, data: migrated } as const) : parsed;
      }
      if (!parsed.success) return null;
      const { version: _version, ...rest } = parsed.data;
      const thread: Thread = threadSchema.parse({ ...rest, state: idleThreadState() });
      const { lastLines: _lastLines, ...summary } = thread;
      return { thread, summary };
    } catch {
      return null;
    }
  }
}
