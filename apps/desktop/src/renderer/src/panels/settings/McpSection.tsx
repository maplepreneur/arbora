import { useState } from 'react';
import clsx from 'clsx';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  BROWSER_MCP_NAME,
  joinCommandLine,
  mcpServerConfigSchema,
  parseKeyValueLines,
  splitCommandLine,
  type McpServerConfig,
} from '@arbora/shared';
import { useAgents } from '../../agent-store';
import { updateSettings } from '../../settings-client';
import { showToast, useApp } from '../../store';
import { inputClass, Segmented, SectionTitle, Toggle } from './controls';

interface Importable {
  origin: string;
  path: string;
  servers: McpServerConfig[];
}

function save(servers: McpServerConfig[]): void {
  updateSettings({ mcpServers: servers }).catch((error: unknown) =>
    showToast(error instanceof Error ? error.message : String(error)),
  );
}

function summary(server: McpServerConfig): string {
  return server.transport === 'http' ? server.url : joinCommandLine([server.command, ...server.args]);
}

export function McpSection() {
  const servers = useApp((s) => s.settings.mcpServers);
  const agents = useAgents((s) => s.agents);
  const [editing, setEditing] = useState<McpServerConfig | 'new' | null>(null);
  const [importable, setImportable] = useState<Importable[] | null>(null);
  const names = new Set(servers.map((server) => server.name));
  const agentName = (id: string): string => agents.find((agent) => agent.id === id)?.name ?? id;

  const upsert = (server: McpServerConfig): void => {
    const exists = servers.some((entry) => entry.id === server.id);
    save(exists ? servers.map((entry) => (entry.id === server.id ? server : entry)) : [...servers, server]);
    setEditing(null);
  };

  const importServers = (list: readonly McpServerConfig[]): void => {
    const taken = new Set(names);
    const fresh = list.filter((server) => !taken.has(server.name) && taken.add(server.name));
    if (fresh.length === 0) return;
    save([...servers, ...fresh]);
    showToast(`Added ${fresh.map((server) => server.name).join(', ')}`);
  };

  return (
    <div data-testid="mcp-settings">
      <p className="mb-3 text-xs text-fg-subtle">
        Arbora passes these servers to every agent when it starts a session, next to its own browser tools, so you set
        them up once instead of per agent. Changes apply to new threads.
      </p>
      <SectionTitle>Servers</SectionTitle>
      {servers.length === 0 && editing === null && (
        <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-fg-subtle">
          No MCP servers yet. Add one, or import the ones Claude Code, Cursor or Gemini already use.
        </div>
      )}
      {servers.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border" data-testid="mcp-list">
          {servers.map((server) =>
            editing !== 'new' && editing?.id === server.id ? (
              <li key={server.id} className="p-3">
                <McpServerForm initial={server} takenNames={names} onSave={upsert} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <li
                key={server.id}
                className="flex items-center gap-3 px-3 py-2"
                data-testid={`mcp-server-${server.name}`}
              >
                <Toggle
                  on={server.enabled}
                  label={`Use ${server.name}`}
                  testId={`mcp-enabled-${server.name}`}
                  onChange={(enabled) =>
                    save(servers.map((entry) => (entry.id === server.id ? { ...entry, enabled } : entry)))
                  }
                />
                <div className={clsx('min-w-0 flex-1', !server.enabled && 'opacity-50')}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium">{server.name}</span>
                    <span className="rounded bg-bg-muted px-1 text-[10px] text-fg-subtle uppercase">
                      {server.transport}
                    </span>
                    <span className="truncate text-[11px] text-fg-subtle">
                      {server.agents.length === 0 ? 'All agents' : server.agents.map(agentName).join(', ')}
                    </span>
                  </div>
                  <div className="truncate font-mono text-[11px] text-fg-subtle">{summary(server)}</div>
                </div>
                <button
                  type="button"
                  aria-label={`Edit ${server.name}`}
                  onClick={() => setEditing(server)}
                  className="rounded p-1 text-fg-subtle hover:bg-bg-muted hover:text-fg"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${server.name}`}
                  data-testid={`mcp-remove-${server.name}`}
                  onClick={() => save(servers.filter((entry) => entry.id !== server.id))}
                  className="rounded p-1 text-fg-subtle hover:bg-bg-muted hover:text-danger"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      {editing === 'new' ? (
        <div className="mt-2 rounded-md border border-border p-3">
          <McpServerForm initial={null} takenNames={names} onSave={upsert} onCancel={() => setEditing(null)} />
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            data-testid="mcp-add"
            onClick={() => setEditing('new')}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-bg-muted"
          >
            <Plus size={12} /> Add server
          </button>
          <button
            type="button"
            data-testid="mcp-import-scan"
            onClick={() =>
              void window.arbora
                .invoke('mcp.importable', undefined)
                .then(setImportable, (error: unknown) =>
                  showToast(error instanceof Error ? error.message : String(error)),
                )
            }
            className="rounded border border-border px-2 py-1 text-xs hover:bg-bg-muted"
          >
            Import from Claude Code, Cursor, Gemini…
          </button>
        </div>
      )}

      {importable && (
        <>
          <SectionTitle>Import</SectionTitle>
          {importable.length === 0 ? (
            <div className="text-xs text-fg-subtle">No MCP servers found in other tools' config files.</div>
          ) : (
            <div className="flex flex-col gap-3" data-testid="mcp-importable">
              {importable.map((group) => {
                const fresh = group.servers.filter((server) => !names.has(server.name));
                return (
                  <div key={group.path} className="rounded-md border border-border">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
                      <span className="text-xs font-medium">{group.origin}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-subtle">{group.path}</span>
                      <button
                        type="button"
                        disabled={fresh.length === 0}
                        onClick={() => importServers(fresh)}
                        className="rounded px-2 py-0.5 text-xs text-accent hover:bg-accent-soft disabled:opacity-40"
                      >
                        Import all
                      </button>
                    </div>
                    <ul className="divide-y divide-border">
                      {group.servers.map((server) => (
                        <li key={server.id} className="flex items-center gap-3 px-3 py-1.5">
                          <span className="font-mono text-xs">{server.name}</span>
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-subtle">
                            {summary(server)}
                          </span>
                          <button
                            type="button"
                            disabled={names.has(server.name)}
                            data-testid={`mcp-import-${server.name}`}
                            onClick={() => importServers([server])}
                            className="rounded border border-border px-2 py-0.5 text-xs hover:bg-bg-muted disabled:opacity-40"
                          >
                            {names.has(server.name) ? 'Added' : 'Import'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function recordLines(record: Readonly<Record<string, string>>, separator: string): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}${separator}${value}`)
    .join('\n');
}

function McpServerForm({
  initial,
  takenNames,
  onSave,
  onCancel,
}: {
  initial: McpServerConfig | null;
  takenNames: ReadonlySet<string>;
  onSave: (server: McpServerConfig) => void;
  onCancel: () => void;
}) {
  const agents = useAgents((s) => s.agents);
  const [name, setName] = useState(initial?.name ?? '');
  const [transport, setTransport] = useState<McpServerConfig['transport']>(initial?.transport ?? 'stdio');
  const [commandLine, setCommandLine] = useState(initial ? joinCommandLine([initial.command, ...initial.args]) : '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [env, setEnv] = useState(initial ? recordLines(initial.env, '=') : '');
  const [headers, setHeaders] = useState(initial ? recordLines(initial.headers, ': ') : '');
  const [only, setOnly] = useState<string[]>(initial?.agents ?? []);
  const [error, setError] = useState<string | null>(null);

  const validate = (): McpServerConfig | string => {
    const trimmed = name.trim();
    if (trimmed === BROWSER_MCP_NAME) return `${BROWSER_MCP_NAME} is Arbora's own browser tools`;
    if (trimmed !== initial?.name && takenNames.has(trimmed)) return `There is already a server named ${trimmed}`;
    const [command = '', ...args] = splitCommandLine(commandLine);
    const parsed = mcpServerConfigSchema.safeParse({
      id: initial?.id ?? crypto.randomUUID(),
      name: trimmed,
      enabled: initial?.enabled ?? true,
      transport,
      command: transport === 'stdio' ? command : '',
      args: transport === 'stdio' ? args : [],
      env: transport === 'stdio' ? parseKeyValueLines(env, '=') : {},
      url: transport === 'http' ? url.trim() : '',
      headers: transport === 'http' ? parseKeyValueLines(headers, ':') : {},
      agents: only,
    });
    if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Invalid server';
    if (transport === 'stdio' && !command) return 'Enter the command that starts the server';
    if (transport === 'http' && !/^https?:\/\//.test(parsed.data.url)) return 'Enter an http(s) URL';
    return parsed.data;
  };

  const submit = (): void => {
    const result = validate();
    if (typeof result === 'string') setError(result);
    else onSave(result);
  };

  const label = 'mb-1 block text-[11px] font-medium text-fg-muted';
  return (
    <form
      data-testid="mcp-form"
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex items-end gap-3">
        <label className="flex-1">
          <span className={label}>Name</span>
          <input
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            placeholder="context7"
            data-testid="mcp-form-name"
            className={clsx(inputClass, 'w-full font-mono')}
          />
        </label>
        <Segmented
          label="Transport"
          testId="mcp-form-transport"
          value={transport}
          options={[
            { value: 'stdio', label: 'Command (stdio)' },
            { value: 'http', label: 'URL (HTTP)' },
          ]}
          onChange={setTransport}
        />
      </div>
      {transport === 'stdio' ? (
        <>
          <label>
            <span className={label}>Command</span>
            <input
              value={commandLine}
              onChange={(event) => setCommandLine(event.target.value)}
              placeholder="npx -y @upstash/context7-mcp"
              data-testid="mcp-form-command"
              className={clsx(inputClass, 'w-full font-mono')}
            />
          </label>
          <label>
            <span className={label}>Environment (KEY=value, one per line)</span>
            <textarea
              value={env}
              onChange={(event) => setEnv(event.target.value)}
              rows={2}
              spellCheck={false}
              data-testid="mcp-form-env"
              className={clsx(inputClass, 'h-auto w-full py-1 font-mono')}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            <span className={label}>URL</span>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://mcp.example.com/mcp"
              data-testid="mcp-form-url"
              className={clsx(inputClass, 'w-full font-mono')}
            />
          </label>
          <label>
            <span className={label}>Headers (Name: value, one per line)</span>
            <textarea
              value={headers}
              onChange={(event) => setHeaders(event.target.value)}
              rows={2}
              spellCheck={false}
              className={clsx(inputClass, 'h-auto w-full py-1 font-mono')}
            />
          </label>
          <p className="text-[11px] text-fg-subtle">Only agents that support HTTP MCP get URL servers.</p>
        </>
      )}
      <div>
        <span className={label}>Agents</span>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Agents that get this server">
          <button
            type="button"
            aria-pressed={only.length === 0}
            onClick={() => setOnly([])}
            className={clsx(
              'rounded-full border px-2 py-0.5 text-[11px]',
              only.length === 0
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-border text-fg-muted hover:bg-bg-muted',
            )}
          >
            All agents
          </button>
          {agents.map((agent) => {
            const on = only.includes(agent.id);
            return (
              <button
                key={agent.id}
                type="button"
                aria-pressed={on}
                onClick={() => setOnly(on ? only.filter((id) => id !== agent.id) : [...only, agent.id])}
                className={clsx(
                  'rounded-full border px-2 py-0.5 text-[11px]',
                  on ? 'border-accent bg-accent text-accent-fg' : 'border-border text-fg-muted hover:bg-bg-muted',
                )}
              >
                {agent.name}
              </button>
            );
          })}
        </div>
      </div>
      {error && <div className="text-xs text-danger">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded px-2 py-1 text-xs text-fg-muted hover:bg-bg-muted">
          Cancel
        </button>
        <button
          type="submit"
          data-testid="mcp-form-save"
          className="rounded bg-accent px-3 py-1 text-xs text-accent-fg hover:opacity-90"
        >
          {initial ? 'Save' : 'Add server'}
        </button>
      </div>
    </form>
  );
}
