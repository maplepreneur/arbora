import { useState } from 'react';
import clsx from 'clsx';
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Settings2,
  Star,
  Trash2,
} from 'lucide-react';
import type { AgentDefinition, AgentVerification, CustomAgent } from '@arbora/shared';
import { loadAgentSnapshot, useAgents } from '../../agent-store';
import { toggleDefaultAgent, updateAgentSettings, useDefaultAgentId } from '../../agent-defaults';
import { useAutoVerify, usePickableAgents, verifyAgent } from '../../agent-pickers';
import { Picker } from '../../components/Picker';
import { updateSettings } from '../../settings-client';
import { openSettings, showToast, useApp } from '../../store';
import { inputClass, SectionTitle, SettingRow, Toggle } from './controls';
import { TaskDefaults } from './TaskAgentPicker';

function StatusBadge({ verification, checking }: { verification: AgentVerification | undefined; checking: boolean }) {
  if (checking) {
    return (
      <span className="flex items-center gap-1 text-xs text-fg-muted">
        <LoaderCircle size={12} className="animate-spin" /> Checking…
      </span>
    );
  }
  if (!verification) {
    return (
      <span className="flex items-center gap-1 text-xs text-fg-subtle">
        <CircleDashed size={12} /> Not checked
      </span>
    );
  }
  switch (verification.status) {
    case 'ready':
      return (
        <span className="flex items-center gap-1 text-xs text-accent">
          <CheckCircle2 size={12} /> Runs
        </span>
      );
    case 'auth_required':
      return (
        <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
          <KeyRound size={12} /> Needs login
        </span>
      );
    case 'missing':
      return (
        <span className="flex items-center gap-1 text-xs text-fg-subtle">
          <CircleDashed size={12} /> Not installed
        </span>
      );
    case 'error':
      return (
        <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
          <CircleAlert size={12} /> Failed to start
        </span>
      );
    default: {
      const unreachable: never = verification.status;
      return unreachable;
    }
  }
}

function AgentRow({ agent }: { agent: AgentDefinition }) {
  const verification = useApp((s) => s.settings.agents.verified[agent.id]);
  const hidden = useApp((s) => s.settings.agents.hidden);
  const checking = useApp((s) => s.checkingAgents.includes(agent.id));
  const installed = useAgents((s) => s.availability.find((a) => a.id === agent.id)?.available !== false);
  const defaultAgent = useDefaultAgentId();
  const [configuring, setConfiguring] = useState(false);
  const ready = verification?.status === 'ready';
  const visible = !hidden.includes(agent.id);
  const isDefault = defaultAgent === agent.id;
  return (
    <li
      data-testid={`settings-agent-${agent.id}`}
      data-status={checking ? 'checking' : (verification?.status ?? (installed ? 'unchecked' : 'missing'))}
      className="rounded-lg border border-border bg-bg"
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{agent.name}</span>
            {isDefault && (
              <span className="rounded bg-accent-soft px-1.5 text-[10px] font-medium text-accent">Default</span>
            )}
          </div>
          <div className="truncate text-xs text-fg-subtle">
            {verification?.version ?? [agent.command, ...agent.args].join(' ')} · runs in its own terminal
          </div>
          {!checking && verification && verification.status !== 'ready' && verification.error && (
            <div className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{verification.error}</div>
          )}
          {!installed && !verification && agent.installHint && (
            <div className="mt-0.5 text-xs text-fg-muted">{agent.installHint}</div>
          )}
        </div>
        <StatusBadge verification={verification} checking={checking} />
        <button
          type="button"
          data-testid={`settings-verify-${agent.id}`}
          disabled={checking}
          onClick={() => void verifyAgent(agent.id)}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-bg-muted disabled:opacity-40"
        >
          <RefreshCw size={11} />
          {verification ? 'Check again' : 'Check'}
        </button>
        <button
          type="button"
          data-testid={`settings-default-${agent.id}`}
          aria-pressed={isDefault}
          disabled={!ready}
          title={isDefault ? 'Default agent' : 'Use as the default agent'}
          onClick={() => toggleDefaultAgent(agent.id)}
          className={clsx(
            'rounded p-1 disabled:opacity-30',
            isDefault ? 'text-accent' : 'text-fg-subtle enabled:hover:text-fg',
          )}
        >
          <Star size={14} className={clsx(isDefault && 'fill-current')} />
        </button>
        <button
          type="button"
          data-testid={`settings-visible-${agent.id}`}
          aria-pressed={visible}
          title={visible ? 'Shown in agent pickers' : 'Hidden from agent pickers'}
          onClick={() =>
            void updateAgentSettings({
              hidden: visible ? [...hidden, agent.id] : hidden.filter((id) => id !== agent.id),
            })
          }
          className="rounded p-1 text-fg-subtle hover:text-fg"
        >
          {visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button
          type="button"
          data-testid={`settings-configure-${agent.id}`}
          aria-expanded={configuring}
          aria-label={`Configure ${agent.name}`}
          title="Environment and launch command"
          onClick={() => setConfiguring((c) => !c)}
          className={clsx('rounded p-1 hover:text-fg', configuring ? 'text-accent' : 'text-fg-subtle')}
        >
          <Settings2 size={14} />
        </button>
      </div>
      {configuring && <AgentConfig agent={agent} />}
    </li>
  );
}

/** What new threads and design changes start with: the starred agent when it runs and is shown. */
function CurrentDefault() {
  const pickable = usePickableAgents();
  const agents = useAgents((s) => s.agents);
  const starred = useDefaultAgentId();
  const projectDefault = useApp((s) => s.project?.settings.defaultAgent);
  const effective = pickable[0];
  const starredName = agents.find((agent) => agent.id === starred)?.name;
  const fallback = Boolean(starred && effective && effective.agent.id !== starred);
  return (
    <section
      data-testid="settings-current-default"
      className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent-soft/40 px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <Star size={14} className="fill-current text-accent" />
        <h3 className="text-sm font-semibold">Current default</h3>
        <span className="text-xs text-fg-subtle">Picked first for new threads and design changes</span>
      </div>
      {effective ? (
        <div className="flex flex-wrap items-center gap-2">
          <Picker
            label="Default agent"
            showLabel
            icon={Bot}
            testId="settings-default-agent"
            menuWidth={260}
            className="min-w-48 flex-1"
            value={effective.agent.id}
            options={pickable.map((entry) => ({ value: entry.agent.id, name: entry.agent.name }))}
            onChange={(id) => void updateAgentSettings({ defaultAgent: id })}
          />
          <span className="text-xs text-fg-subtle">Its CLI manages its own models; pick them inside its terminal.</span>
        </div>
      ) : (
        <p className="text-xs text-fg-muted" data-testid="settings-no-default">
          No checked agent is shown yet. Check your agents below, then star one.
        </p>
      )}
      {fallback && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {starredName ?? starred} is starred but does not run or is hidden, so {effective?.agent.name} is used.
        </p>
      )}
      {projectDefault && (
        <p className="text-xs text-fg-subtle">
          This project sets its own default agent in <span className="font-mono">.arbora/project.json</span>, which wins
          over the star here.{' '}
          <button type="button" onClick={() => openSettings('general')} className="text-accent hover:underline">
            Change it in General
          </button>
        </p>
      )}
    </section>
  );
}

export function AgentsSection() {
  const agents = useAgents((s) => s.agents);
  const verified = useApp((s) => s.settings.agents.verified);
  const autoVerify = useApp((s) => s.settings.agents.autoVerify);
  const checking = useApp((s) => s.checkingAgents.length > 0);
  useAutoVerify();
  const rank = (agent: AgentDefinition): number => {
    switch (verified[agent.id]?.status) {
      case 'ready':
        return 0;
      case 'auth_required':
        return 1;
      case 'error':
        return 2;
      case undefined:
        return 3;
      case 'missing':
        return 4;
      default:
        return 5;
    }
  };
  const sorted = [...agents].sort((a, b) => rank(a) - rank(b));
  return (
    <div className="flex flex-col gap-4">
      <CurrentDefault />
      <div>
        <SectionTitle>Defaults per task</SectionTitle>
        <p className="mb-2 text-xs text-fg-muted">
          New threads started from these places use their own agent. An open thread keeps its own.
        </p>
        <TaskDefaults />
      </div>
      <HelperSettings />
      <div className="flex items-start gap-4">
        <p className="flex-1 text-sm text-fg-muted">
          Agents run as their own CLI in a terminal tab. The check runs the CLI once (`--version`) to see that it is
          installed; log-in and models happen inside the agent's own terminal. Only checked agents you show here appear
          when you send design changes. The starred agent is picked first.
        </p>
        <button
          type="button"
          data-testid="settings-verify-all"
          disabled={checking}
          onClick={() => {
            void (async () => {
              for (const agent of agents) await verifyAgent(agent.id);
            })();
          }}
          className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-40"
        >
          <RefreshCw size={12} className={clsx(checking && 'animate-spin')} />
          Check all
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {sorted.map((agent) => (
          <AgentRow key={agent.id} agent={agent} />
        ))}
      </ul>
      <CustomAgentEditor />
      <SettingRow
        title="Check new agents automatically"
        detail="When Settings or a picker opens, check installed agents that were never checked."
      >
        <Toggle
          on={autoVerify}
          label="Check new agents automatically"
          onChange={(on) => void updateAgentSettings({ autoVerify: on })}
        />
      </SettingRow>
    </div>
  );
}

const MAX_HELPERS = 10;

function HelperSettings() {
  const grove = useApp((s) => s.settings.grove);
  return (
    <div>
      <SectionTitle>Helper agents</SectionTitle>
      <SettingRow
        title="Let agents start helpers"
        detail="Gives each session the grove_* tools to start, prompt, wait for and read helper agents. A session asks you before its first helper. Applies to agents started after the change."
      >
        <Toggle
          on={grove.orchestration}
          label="Let agents start helpers"
          testId="setting-grove-orchestration"
          onChange={(orchestration) => void updateSettings({ grove: { orchestration } })}
        />
      </SettingRow>
      <SettingRow title="Helpers per agent" detail="How many helpers one agent can have running at once.">
        <select
          aria-label="Helpers per agent"
          data-testid="setting-grove-max-children"
          value={grove.maxChildren}
          disabled={!grove.orchestration}
          onChange={(e) => void updateSettings({ grove: { maxChildren: Number(e.target.value) } })}
          className="h-7 rounded border border-border bg-bg px-1.5 text-xs disabled:opacity-50"
        >
          {Array.from({ length: MAX_HELPERS }, (_, i) => i + 1).map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
      </SettingRow>
    </div>
  );
}

// --- Agent configuration ---------------------------------------------------------------------------

function EnvEditor({ agentId }: { agentId: string }) {
  const all = useApp((s) => s.settings.agents.env);
  const [rows, setRows] = useState<{ key: string; value: string }[]>(() =>
    Object.entries(all[agentId] ?? {}).map(([key, value]) => ({ key, value })),
  );
  const save = (next: typeof rows): void => {
    const clean = next.filter((r) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(r.key));
    const { [agentId]: _old, ...others } = all;
    void updateAgentSettings({
      env: clean.length > 0 ? { ...others, [agentId]: Object.fromEntries(clean.map((r) => [r.key, r.value])) } : others,
    });
  };
  return (
    <div className="flex flex-col gap-1.5" data-testid={`settings-env-${agentId}`}>
      <div className="text-xs font-medium">Environment overrides</div>
      <p className="text-[11px] text-fg-subtle">
        Added to the agent terminal on its next start. Values are never shown in diagnostics.
      </p>
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1.5">
          <input
            aria-label="Variable name"
            placeholder="NAME"
            value={row.key}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
            onBlur={() => save(rows)}
            className={clsx(inputClass, 'w-44 font-mono')}
          />
          <input
            aria-label="Value"
            type="password"
            placeholder="value"
            value={row.value}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
            onBlur={() => save(rows)}
            className={clsx(inputClass, 'min-w-0 flex-1 font-mono')}
          />
          <button
            type="button"
            aria-label={`Remove ${row.key || 'variable'}`}
            onClick={() => {
              const next = rows.filter((_, j) => j !== i);
              setRows(next);
              save(next);
            }}
            className="rounded p-1 text-fg-subtle hover:text-danger"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        data-testid={`settings-env-add-${agentId}`}
        onClick={() => setRows([...rows, { key: '', value: '' }])}
        className="flex items-center gap-1 self-start text-[11px] text-accent hover:underline"
      >
        <Plus size={11} /> Add variable
      </button>
    </div>
  );
}

function AgentConfig({ agent }: { agent: AgentDefinition }) {
  return (
    <div className="flex flex-col gap-4 border-t border-border px-3 py-3">
      <div className="text-[11px] text-fg-subtle">
        Runs <span className="font-mono text-fg-muted">{[agent.command, ...agent.args].join(' ')}</span>
        {agent.docsUrl && (
          <>
            {' · '}
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => void window.arbora.invoke('app.openExternal', { url: agent.docsUrl ?? '' })}
            >
              Setup guide
            </button>
          </>
        )}
      </div>
      <EnvEditor agentId={agent.id} />
    </div>
  );
}

function splitArgs(text: string): string[] {
  const out: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of text.matchAll(pattern)) out.push(match[1] ?? match[2] ?? match[3] ?? '');
  return out;
}

function CustomAgentForm({ initial, onDone }: { initial: CustomAgent | null; onDone: () => void }) {
  const custom = useApp((s) => s.settings.agents.custom);
  const agents = useAgents((s) => s.agents);
  const [name, setName] = useState(initial?.name ?? '');
  const [id, setId] = useState(initial?.id ?? '');
  const [command, setCommand] = useState(initial?.command ?? '');
  const [args, setArgs] = useState(initial?.args.join(' ') ?? '');
  const [hint, setHint] = useState(initial?.installHint ?? '');
  const derivedId =
    id ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const clash = !initial && agents.some((a) => a.id === derivedId && !a.builtIn);
  const valid = name.trim() && derivedId && command.trim() && !clash;
  const save = (): void => {
    const entry: CustomAgent = {
      id: derivedId,
      name: name.trim(),
      command: command.trim(),
      args: splitArgs(args),
      env: initial?.env ?? {},
      ...(hint.trim() ? { installHint: hint.trim() } : {}),
    };
    const next = initial ? custom.map((a) => (a.id === initial.id ? entry : a)) : [...custom, entry];
    void updateAgentSettings({ custom: next }).then(() => {
      void loadAgentSnapshot().catch(() => undefined);
      showToast(initial ? `Saved ${entry.name}` : `Added ${entry.name}. Check it to confirm it runs.`);
      onDone();
    });
  };
  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
    testId: string,
    mono = false,
  ) => (
    <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
      {label}
      <input
        value={value}
        data-testid={testId}
        placeholder={placeholder}
        onChange={(e) => set(e.target.value)}
        className={clsx(inputClass, mono && 'font-mono')}
      />
    </label>
  );
  return (
    <div
      className="grid grid-cols-2 gap-3 rounded-lg border border-accent/40 bg-bg p-3"
      data-testid="custom-agent-form"
    >
      {field('Name', name, setName, 'My agent', 'custom-agent-name')}
      {field('Id', id, setId, derivedId || 'my-agent', 'custom-agent-id', true)}
      {field('Command', command, setCommand, 'my-agent or /path/to/agent', 'custom-agent-command', true)}
      {field('Arguments', args, setArgs, 'extra arguments (usually empty)', 'custom-agent-args', true)}
      <div className="col-span-2">
        {field('Install or login hint (optional)', hint, setHint, 'Run `my-agent login` once.', 'custom-agent-hint')}
      </div>
      {clash && <p className="col-span-2 text-xs text-danger">A custom agent with id {derivedId} already exists.</p>}
      <p className="col-span-2 text-[11px] text-fg-subtle">
        An interactive CLI that runs in its own terminal, like the built-ins. Using a built-in id (for example{' '}
        <span className="font-mono">codex</span>) replaces that built-in.
      </p>
      <div className="col-span-2 flex justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded border border-border px-3 py-1 text-xs">
          Cancel
        </button>
        <button
          type="button"
          data-testid="custom-agent-save"
          disabled={!valid}
          onClick={save}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-accent-fg disabled:opacity-40"
        >
          {initial ? 'Save' : 'Add agent'}
        </button>
      </div>
    </div>
  );
}

function CustomAgentEditor() {
  const custom = useApp((s) => s.settings.agents.custom);
  const [editing, setEditing] = useState<CustomAgent | 'new' | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle>Custom agents</SectionTitle>
      {custom.length === 0 && editing === null && (
        <p className="text-xs text-fg-subtle">Any interactive CLI can be added here; it runs in its own terminal.</p>
      )}
      <ul className="flex flex-col gap-1.5">
        {custom.map((agent) => (
          <li key={agent.id} className="flex items-center gap-2 rounded border border-border bg-bg px-3 py-1.5 text-xs">
            <span className="font-medium">{agent.name}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-fg-subtle">
              {[agent.command, ...agent.args].join(' ')}
            </span>
            <button type="button" onClick={() => setEditing(agent)} className="text-accent hover:underline">
              Edit
            </button>
            <button
              type="button"
              aria-label={`Remove ${agent.name}`}
              onClick={() =>
                void updateAgentSettings({ custom: custom.filter((a) => a.id !== agent.id) }).then(() =>
                  loadAgentSnapshot().catch(() => undefined),
                )
              }
              className="rounded p-0.5 text-fg-subtle hover:text-danger"
            >
              <Trash2 size={12} />
            </button>
          </li>
        ))}
      </ul>
      {editing !== null ? (
        <CustomAgentForm initial={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      ) : (
        <button
          type="button"
          data-testid="add-custom-agent"
          onClick={() => setEditing('new')}
          className="flex items-center gap-1 self-start rounded border border-border px-2.5 py-1 text-xs hover:bg-bg-muted"
        >
          <Plus size={12} /> Add custom agent
        </button>
      )}
    </div>
  );
}
