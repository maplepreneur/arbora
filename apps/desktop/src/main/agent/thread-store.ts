import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  agentGroupsFileSchema,
  idleThreadState,
  type AgentGroup,
  PERSISTED_TOOL_TEXT_LIMIT,
  THREAD_FILE_BYTE_LIMIT,
  THREAD_FILE_VERSION,
  threadFileSchema,
  type Thread,
  type ThreadEvent,
  type ThreadFile,
  type ThreadSummary,
  type ToolCallContent,
} from '@arbora/shared';
import { ARBORA_DIR } from '../project-settings.js';
import { writeJsonAtomic } from '../settings-store.js';

const TRUNCATION_MARK = '…[truncated]';

export function threadsDir(projectPath: string): string {
  return join(projectPath, ARBORA_DIR, 'threads');
}

function clip(text: string): string {
  return text.length > PERSISTED_TOOL_TEXT_LIMIT ? text.slice(0, PERSISTED_TOOL_TEXT_LIMIT) + TRUNCATION_MARK : text;
}

/** `JSON.stringify` is typed as `string` but returns undefined for functions and symbols. */
function stringify(value: unknown): string | undefined {
  return JSON.stringify(value);
}

/** Raw tool IO is kept only when small; otherwise a clipped JSON string stands in for it. */
function clipRaw(value: unknown): unknown {
  if (value === undefined) return undefined;
  const json = stringify(value);
  if (json === undefined || json.length <= PERSISTED_TOOL_TEXT_LIMIT) return value;
  return json.slice(0, PERSISTED_TOOL_TEXT_LIMIT) + TRUNCATION_MARK;
}

function clipContent(item: ToolCallContent): ToolCallContent {
  switch (item.type) {
    case 'diff':
      return {
        ...item,
        newText: clip(item.newText),
        ...(item.oldText != null ? { oldText: clip(item.oldText) } : {}),
      };
    case 'content':
      return item.content.type === 'text'
        ? { ...item, content: { ...item.content, text: clip(item.content.text) } }
        : item;
    case 'terminal':
      return item;
    default: {
      const unreachable: never = item;
      return unreachable;
    }
  }
}

/** Tool content and raw IO beyond `PERSISTED_TOOL_TEXT_LIMIT` is clipped; the session keeps the full copy in memory. */
export function truncateEventForPersistence(event: ThreadEvent): ThreadEvent {
  switch (event.kind) {
    case 'tool_call': {
      const rawInput = clipRaw(event.rawInput);
      const rawOutput = clipRaw(event.rawOutput);
      return {
        ...event,
        content: event.content.map(clipContent),
        ...(rawInput !== undefined ? { rawInput } : {}),
        ...(rawOutput !== undefined ? { rawOutput } : {}),
      };
    }
    case 'permission': {
      const rawInput = clipRaw(event.rawInput);
      return { ...event, ...(rawInput !== undefined ? { rawInput } : {}) };
    }
    case 'user_message':
    case 'agent_message':
    case 'agent_thought':
    case 'plan':
    case 'turn_end':
    case 'notice':
    case 'error':
    case 'browser_preview':
      return event;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/** The on-disk form of a thread: clipped tool content, oldest events dropped under the byte cap. */
export function capThreadFile(thread: Thread): ThreadFile {
  const { state: _state, ...rest } = thread;
  let events = thread.events.map(truncateEventForPersistence);
  let file: ThreadFile = { ...rest, version: THREAD_FILE_VERSION, events };
  while (events.length > 0 && Buffer.byteLength(JSON.stringify(file), 'utf8') > THREAD_FILE_BYTE_LIMIT) {
    events = events.slice(Math.max(1, Math.floor(events.length / 8)));
    file = { ...file, events };
  }
  return file;
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
      if (loaded) {
        const { events: _events, ...summary } = loaded;
        threads.push(summary);
      }
    }
    return threads.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  load(id: string): Thread | null {
    return this.read(this.pathFor(id));
  }

  save(thread: Thread): void {
    writeJsonAtomic(this.pathFor(thread.id), capThreadFile(thread));
  }

  delete(id: string): void {
    rmSync(this.pathFor(id), { force: true });
  }

  ensureDir(): void {
    mkdirSync(threadsDir(this.projectPath), { recursive: true });
  }

  private pathFor(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error(`Invalid thread id ${id}`);
    return join(threadsDir(this.projectPath), `${id}.json`);
  }

  private read(file: string): Thread | null {
    if (!existsSync(file)) return null;
    try {
      const parsed = threadFileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      if (!parsed.success) return null;
      const { version: _version, ...thread } = parsed.data;
      return { ...thread, state: idleThreadState() };
    } catch {
      return null;
    }
  }
}
