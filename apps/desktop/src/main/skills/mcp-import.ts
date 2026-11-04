import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseMcpConfigJson, type McpServerConfig } from '@arbora/shared';

export interface ImportableMcp {
  readonly origin: string;
  readonly path: string;
  readonly servers: McpServerConfig[];
}

/** Config files other tools keep MCP servers in, all in the `{ "mcpServers": { … } }` shape. */
export function mcpConfigFiles(home: string, projectPath: string | null): { origin: string; path: string }[] {
  return [
    { origin: 'Claude Code', path: join(home, '.claude.json') },
    { origin: 'Cursor', path: join(home, '.cursor', 'mcp.json') },
    { origin: 'Gemini CLI', path: join(home, '.gemini', 'settings.json') },
    ...(projectPath ? [{ origin: 'This project (.mcp.json)', path: join(projectPath, '.mcp.json') }] : []),
  ];
}

export async function importableMcpServers(home: string, projectPath: string | null): Promise<ImportableMcp[]> {
  const out: ImportableMcp[] = [];
  for (const file of mcpConfigFiles(home, projectPath)) {
    let text: string;
    try {
      text = await readFile(file.path, 'utf8');
    } catch {
      continue;
    }
    const servers = parseMcpConfigJson(text, randomUUID);
    if (servers.length > 0) out.push({ ...file, servers });
  }
  return out;
}
