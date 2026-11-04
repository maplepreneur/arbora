import { z } from 'zod';

/** The name Arbora's own browser tools use; a user server may not take it. */
export const BROWSER_MCP_NAME = 'arbora-browser';

export const mcpServerConfigSchema = z.object({
  id: z.string().min(1).max(64),
  /** The name agents see (tool prefixes); unique in the list. */
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'letters, digits, dot, dash and underscore only'),
  enabled: z.boolean().default(true),
  transport: z.enum(['stdio', 'http']).default('stdio'),
  command: z.string().max(4096).default(''),
  args: z.array(z.string().max(4096)).max(100).default([]),
  env: z.record(z.string(), z.string()).default({}),
  url: z.string().max(4096).default(''),
  headers: z.record(z.string(), z.string()).default({}),
  /** Agent ids that get this server; empty means every agent. */
  agents: z.array(z.string()).max(50).default([]),
});
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

/** ACP `McpServer` (stdio or streamable HTTP), structurally. */
export type AcpMcpServer =
  | {
      name: string;
      command: string;
      args: string[];
      env: { name: string; value: string }[];
    }
  | { type: 'http'; name: string; url: string; headers: { name: string; value: string }[] };

const pairs = (record: Readonly<Record<string, string>>): { name: string; value: string }[] =>
  Object.entries(record).map(([name, value]) => ({ name, value }));

/**
 * The user's servers for one agent session. HTTP servers are skipped for agents without
 * `mcpCapabilities.http`; every ACP agent takes stdio.
 */
export function mcpServersFor(servers: readonly McpServerConfig[], agentId: string, http: boolean): AcpMcpServer[] {
  const out: AcpMcpServer[] = [];
  const names = new Set<string>([BROWSER_MCP_NAME]);
  for (const server of servers) {
    if (!server.enabled || names.has(server.name)) continue;
    if (server.agents.length > 0 && !server.agents.includes(agentId)) continue;
    if (server.transport === 'http') {
      if (!http || !server.url) continue;
      out.push({ type: 'http', name: server.name, url: server.url, headers: pairs(server.headers) });
    } else {
      if (!server.command) continue;
      out.push({ name: server.name, command: server.command, args: [...server.args], env: pairs(server.env) });
    }
    names.add(server.name);
  }
  return out;
}

const stringRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
};

/**
 * Servers from an `mcpServers` JSON file (Claude Code `~/.claude.json`, Cursor `~/.cursor/mcp.json`,
 * Gemini `settings.json`, a project `.mcp.json`). Servers marked `type: "sse"` are left out: ACP
 * agents are not required to support SSE.
 */
export function parseMcpConfigJson(text: string, makeId: () => string): McpServerConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const servers = (parsed as { mcpServers?: unknown } | null)?.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
  const out: McpServerConfig[] = [];
  for (const [rawName, raw] of Object.entries(servers as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const name = rawName
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[^A-Za-z0-9]+/, '')
      .slice(0, 64);
    if (!name) continue;
    const type = typeof entry['type'] === 'string' ? entry['type'] : undefined;
    const url =
      typeof entry['httpUrl'] === 'string' ? entry['httpUrl'] : typeof entry['url'] === 'string' ? entry['url'] : '';
    const base = { id: makeId(), name, enabled: entry['disabled'] !== true };
    if (typeof entry['command'] === 'string' && entry['command']) {
      const args = Array.isArray(entry['args']) ? entry['args'].filter((a): a is string => typeof a === 'string') : [];
      out.push(
        mcpServerConfigSchema.parse({
          ...base,
          transport: 'stdio',
          command: entry['command'],
          args,
          env: stringRecord(entry['env']),
        }),
      );
    } else if (url && type !== 'sse') {
      out.push(
        mcpServerConfigSchema.parse({ ...base, transport: 'http', url, headers: stringRecord(entry['headers']) }),
      );
    }
  }
  return out;
}

/** Splits a command line into words: whitespace separates, single and double quotes group. */
export function splitCommandLine(line: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) words.push(current);
  return words;
}

/** The inverse of `splitCommandLine` for display in a single input. */
export function joinCommandLine(words: readonly string[]): string {
  return words.map((word) => (word === '' || /[\s"']/.test(word) ? `"${word.replace(/"/g, "'")}"` : word)).join(' ');
}

/** `KEY=value` lines to a record; blank lines and lines without `=` are ignored. */
export function parseKeyValueLines(text: string, separator: '=' | ':' = '='): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(separator);
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (key) out[key] = line.slice(at + 1).trim();
  }
  return out;
}
