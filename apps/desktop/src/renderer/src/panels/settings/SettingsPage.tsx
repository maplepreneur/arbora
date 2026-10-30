import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  Cpu,
  Eye,
  EyeOff,
  FileJson,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Star,
  X,
} from 'lucide-react';
import {
  CommandId,
  DEFAULT_COMMANDS,
  formatChord,
  type AgentDefinition,
  type AgentVerification,
  type AppSettingsPatch,
  type ThemeMode,
} from '@arbora/shared';
import { useAgents } from '../../agent-store';
import { toggleDefaultAgent, updateAgentSettings, useDefaultAgentId } from '../../agent-defaults';
import { useAutoVerify, usePickableAgents, verifyAgent } from '../../agent-pickers';
import { Picker } from '../../components/Picker';
import { executeCommand } from '../../commands';
import { useKeybindingTable } from '../../keybindings';
import { showToast, useApp, type SettingsSection } from '../../store';

type Section = SettingsSection;

const SECTIONS: readonly { id: Section; label: string }[] = [
  { id: 'agents', label: 'Agents' },
  { id: 'general', label: 'General' },
  { id: 'editor', label: 'Editor' },
  { id: 'browser', label: 'Browser' },
  { id: 'keyboard', label: 'Keyboard' },
];

async function updateSettings(patch: AppSettingsPatch): Promise<void> {
  try {
    const settings = await window.arbora.invoke('settings.update', patch);
    useApp.setState({ settings });
  } catch (error) {
    showToast(`Could not save the setting: ${(error as Error).message}`);
  }
}

function close(): void {
  useApp.setState({ settingsOpen: false });
}

// --- Shared controls -------------------------------------------------------------------------------

function Toggle({
  on,
  onChange,
  label,
  testId,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!on)}
      className={clsx('relative h-4 w-7 shrink-0 rounded-full transition-colors', on ? 'bg-accent' : 'bg-border')}
    >
      <span
        className={clsx(
          'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-[left]',
          on ? 'left-3.5' : 'left-0.5',
        )}
      />
    </button>
  );
}

function SettingRow({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-border py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm">{title}</div>
        {detail && <div className="text-xs text-fg-subtle">{detail}</div>}
      </div>
      {children}
    </div>
  );
}

// --- Agents ----------------------------------------------------------------------------------------

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
          <CheckCircle2 size={12} /> Signed in
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

function ModelList({ agent, verification }: { agent: AgentDefinition; verification: AgentVerification }) {
  const hiddenModels = useApp((s) => s.settings.agents.hiddenModels);
  const defaults = useApp((s) => s.settings.agents.defaultModels);
  const [filter, setFilter] = useState('');
  const hidden = new Set(hiddenModels[agent.id] ?? []);
  const models = verification.models.filter((model) =>
    `${model.name} ${model.value}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const setHidden = (values: string[]): void => {
    void updateAgentSettings({ hiddenModels: { ...hiddenModels, [agent.id]: values } });
  };
  const setDefault = (value: string): void => {
    const { [agent.id]: current, ...others } = defaults;
    void updateAgentSettings({ defaultModels: current === value ? others : { ...others, [agent.id]: value } });
  };
  if (verification.models.length === 0) {
    return <p className="px-3 pb-3 text-xs text-fg-subtle">This agent does not offer a model choice.</p>;
  }
  const shown = verification.models.length - verification.models.filter((m) => hidden.has(m.value)).length;
  return (
    <div className="flex flex-col gap-2 px-3 pb-3" data-testid={`settings-models-${agent.id}`}>
      <div className="flex items-center gap-2">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={`Filter ${verification.models.length} models`}
          className="h-7 min-w-0 flex-1 rounded border border-border bg-bg px-2 text-xs focus:border-accent focus:outline-none"
        />
        <span className="text-[11px] text-fg-subtle">{shown} shown</span>
        <button type="button" onClick={() => setHidden([])} className="text-[11px] text-accent hover:underline">
          Show all
        </button>
        <button
          type="button"
          onClick={() =>
            setHidden(verification.models.filter((m) => m.value !== defaults[agent.id]).map((m) => m.value))
          }
          className="text-[11px] text-fg-subtle hover:text-fg hover:underline"
        >
          Hide all
        </button>
      </div>
      <ul className="max-h-64 overflow-auto rounded border border-border">
        {models.map((model) => {
          const isHidden = hidden.has(model.value);
          const isDefault = defaults[agent.id] === model.value;
          return (
            <li
              key={model.value}
              data-testid="settings-model"
              data-value={model.value}
              data-hidden={isHidden || undefined}
              className="flex items-center gap-2 border-b border-border px-2 py-1 text-xs last:border-b-0"
            >
              <Toggle
                on={!isHidden}
                label={`Show ${model.name}`}
                testId={`settings-model-visible-${model.value}`}
                onChange={(on) =>
                  setHidden(on ? [...hidden].filter((v) => v !== model.value) : [...hidden, model.value])
                }
              />
              <span className={clsx('min-w-0 flex-1 truncate', isHidden && 'text-fg-subtle')}>
                {model.name}
                {model.name !== model.value && (
                  <span className="ml-1 font-mono text-[10px] text-fg-subtle">{model.value}</span>
                )}
              </span>
              <button
                type="button"
                data-testid={`settings-model-default-${model.value}`}
                aria-pressed={isDefault}
                title={isDefault ? 'Default model' : 'Use as the default model'}
                onClick={() => setDefault(model.value)}
                className={clsx(
                  'flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]',
                  isDefault ? 'bg-accent-soft text-accent' : 'text-fg-subtle hover:text-fg',
                )}
              >
                <Star size={11} className={clsx(isDefault && 'fill-current')} />
                {isDefault ? 'Default' : 'Make default'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentDefinition }) {
  const verification = useApp((s) => s.settings.agents.verified[agent.id]);
  const hidden = useApp((s) => s.settings.agents.hidden);
  const checking = useApp((s) => s.checkingAgents.includes(agent.id));
  const installed = useAgents((s) => s.availability.find((a) => a.id === agent.id)?.available !== false);
  const defaultAgent = useDefaultAgentId();
  const [open, setOpen] = useState(false);
  const ready = verification?.status === 'ready';
  const visible = !hidden.includes(agent.id);
  const isDefault = defaultAgent === agent.id;
  const defaultModel = useApp((s) => s.settings.agents.defaultModels[agent.id]);
  const defaultModelName = verification?.models.find((m) => m.value === defaultModel)?.name;
  return (
    <li
      data-testid={`settings-agent-${agent.id}`}
      data-status={checking ? 'checking' : (verification?.status ?? (installed ? 'unchecked' : 'missing'))}
      className="rounded-lg border border-border bg-bg"
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          aria-label={open ? `Collapse ${agent.name}` : `Expand ${agent.name}`}
          aria-expanded={open}
          disabled={!ready}
          onClick={() => setOpen((o) => !o)}
          className="text-fg-subtle enabled:hover:text-fg disabled:opacity-30"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{agent.name}</span>
            {isDefault && (
              <span className="rounded bg-accent-soft px-1.5 text-[10px] font-medium text-accent">Default</span>
            )}
          </div>
          <div className="truncate text-xs text-fg-subtle">
            {verification?.version ?? agent.command}
            {ready && verification.models.length > 0 && (
              <>
                {' · '}
                {verification.models.length} model{verification.models.length === 1 ? '' : 's'}
                {defaultModelName ? ` · default ${defaultModelName}` : ''}
              </>
            )}
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
      </div>
      {open && ready && <ModelList agent={agent} verification={verification} />}
    </li>
  );
}

/**
 * What new threads and design changes start with. That is the starred agent when it is signed in
 * and shown, otherwise the first signed-in agent, with its default model or its first visible one.
 */
function CurrentDefault() {
  const pickable = usePickableAgents();
  const agents = useAgents((s) => s.agents);
  const starred = useDefaultAgentId();
  const projectDefault = useApp((s) => s.project?.settings.defaultAgent);
  const defaultModels = useApp((s) => s.settings.agents.defaultModels);
  const effective = pickable[0];
  const model = effective?.models[0];
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
          {model ? (
            <Picker
              label="Default model"
              showLabel
              icon={Cpu}
              testId="settings-default-model"
              menuWidth={280}
              className="min-w-48 flex-1"
              value={model.value}
              options={effective.models.map((entry) => ({ value: entry.value, name: entry.name }))}
              onChange={(value) =>
                void updateAgentSettings({ defaultModels: { ...defaultModels, [effective.agent.id]: value } })
              }
            />
          ) : (
            <span className="text-xs text-fg-subtle">{effective.agent.name} does not offer a model choice.</span>
          )}
        </div>
      ) : (
        <p className="text-xs text-fg-muted" data-testid="settings-no-default">
          No signed-in agent is shown yet. Check your agents below, then star one.
        </p>
      )}
      {fallback && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {starredName ?? starred} is starred but is not signed in or is hidden, so {effective?.agent.name} is used.
        </p>
      )}
      {effective && model && !defaultModels[effective.agent.id] && (
        <p className="text-xs text-fg-subtle">No default model is set, so the first visible one is used.</p>
      )}
      {projectDefault && (
        <p className="text-xs text-fg-subtle">
          This project sets its own default agent in <span className="font-mono">.arbora/project.json</span>, which wins
          over the star here.
        </p>
      )}
    </section>
  );
}

function AgentsSection() {
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
      <div className="flex items-start gap-4">
        <p className="flex-1 text-sm text-fg-muted">
          Arbora starts each agent once to check that you are signed in and to read its models. Only signed-in agents
          you show here appear when you send design changes. The starred agent and model are picked first.
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

// --- Other sections --------------------------------------------------------------------------------

const THEMES: readonly { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function GeneralSection() {
  const theme = useApp((s) => s.theme.mode);
  const passthrough = useApp((s) => s.settings.terminalPassthrough);
  const fontSize = useApp((s) => s.settings.terminal.fontSize);
  return (
    <div>
      <SettingRow title="Theme">
        <div role="radiogroup" className="flex rounded-md border border-border bg-bg-muted p-0.5">
          {THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={theme === option.value}
              onClick={() => {
                void window.arbora.invoke('theme.set', { mode: option.value }).then((next) => {
                  useApp.setState({ theme: next });
                });
              }}
              className={clsx(
                'rounded px-2 py-0.5 text-xs',
                theme === option.value ? 'bg-bg text-fg shadow-sm' : 'text-fg-subtle hover:text-fg',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow
        title="Send Ctrl chords to the focused terminal"
        detail="Ctrl+K, Ctrl+D and friends go to the shell while a terminal has focus."
      >
        <Toggle
          on={passthrough}
          label="Terminal passthrough"
          onChange={(on) => void updateSettings({ terminalPassthrough: on })}
        />
      </SettingRow>
      <SettingRow title="Terminal font size">
        <input
          type="number"
          min={8}
          max={32}
          value={fontSize}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isInteger(value) && value >= 8 && value <= 32)
              void updateSettings({ terminal: { fontSize: value } });
          }}
          className="h-7 w-16 rounded border border-border bg-bg px-2 text-xs"
        />
      </SettingRow>
    </div>
  );
}

function EditorSection() {
  const editor = useApp((s) => s.settings.editor);
  return (
    <div>
      <SettingRow
        title="Format on save"
        detail="Run the project's own Prettier (from its node_modules) when saving. Skipped without Prettier."
      >
        <Toggle
          on={editor.formatOnSave}
          label="Format on save"
          testId="setting-format-on-save"
          onChange={(on) => void updateSettings({ editor: { formatOnSave: on } })}
        />
      </SettingRow>
      <SettingRow title="ESLint on save" detail="Lint the saved file with the project's ESLint and config.">
        <Toggle
          on={editor.eslintOnSave}
          label="ESLint on save"
          testId="setting-eslint-on-save"
          onChange={(on) => void updateSettings({ editor: { eslintOnSave: on } })}
        />
      </SettingRow>
      <SettingRow
        title="Type-check on save"
        detail="Run tsc --noEmit after saving a TypeScript file. Slow on large projects, so off by default."
      >
        <Toggle
          on={editor.tscOnSave}
          label="Type-check on save"
          testId="setting-tsc-on-save"
          onChange={(on) => void updateSettings({ editor: { tscOnSave: on } })}
        />
      </SettingRow>
      <SettingRow title="Editor font size">
        <input
          type="number"
          min={8}
          max={32}
          value={editor.fontSize}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isInteger(value) && value >= 8 && value <= 32)
              void updateSettings({ editor: { fontSize: value } });
          }}
          className="h-7 w-16 rounded border border-border bg-bg px-2 text-xs"
        />
      </SettingRow>
    </div>
  );
}

function BrowserSection() {
  const browser = useApp((s) => s.settings.browser);
  return (
    <div>
      <SettingRow
        title="React and Vue DevTools"
        detail="Load the bundled extensions into the browser panel. Applies after a restart."
      >
        <Toggle
          on={browser.devToolsExtensions}
          label="DevTools extensions"
          onChange={(on) => void updateSettings({ browser: { devToolsExtensions: on } })}
        />
      </SettingRow>
      <SettingRow
        title="Trust localhost certificates"
        detail="Accept self-signed certificates from local dev servers (Vite https, mkcert)."
      >
        <Toggle
          on={browser.trustLocalhostCertificates}
          label="Trust localhost certificates"
          onChange={(on) => void updateSettings({ browser: { trustLocalhostCertificates: on } })}
        />
      </SettingRow>
    </div>
  );
}

function KeyboardSection() {
  const table = useKeybindingTable();
  const platform = useApp((s) => s.info.platform);
  const rows = DEFAULT_COMMANDS.filter((command) => !command.hidden).flatMap((command) => {
    const binding = table.forCommand(command.id);
    return binding ? [{ title: command.title, chord: formatChord(binding.chord, platform) }] : [];
  });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">
        Shortcuts are edited in the settings file for now. A shortcut editor comes with Stage 9.
      </p>
      <ul className="rounded-lg border border-border">
        {rows.map((row) => (
          <li key={row.title} className="flex items-center border-b border-border px-3 py-1.5 text-xs last:border-b-0">
            <span className="flex-1">{row.title}</span>
            <kbd className="rounded border border-border bg-bg-muted px-1.5 font-mono text-[11px]">{row.chord}</kbd>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Page ------------------------------------------------------------------------------------------

/** Settings, shown in place of the browser pane. `Mod+,` opens and closes it. */
export default function SettingsPage() {
  const section = useApp((s) => s.settingsSection);
  const setSection = (next: Section): void => useApp.setState({ settingsSection: next });
  return (
    <div data-testid="settings-page" className="flex h-full min-h-0 bg-bg-subtle text-fg">
      <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border p-2">
        <h1 className="px-2 pt-1 pb-2 text-sm font-semibold">Settings</h1>
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            data-testid={`settings-nav-${entry.id}`}
            aria-current={section === entry.id ? 'page' : undefined}
            onClick={() => setSection(entry.id)}
            className={clsx(
              'rounded-md px-2 py-1.5 text-left text-sm',
              section === entry.id ? 'bg-accent-soft font-medium text-accent' : 'text-fg-muted hover:bg-bg-muted',
            )}
          >
            {entry.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => executeCommand(CommandId.openSettingsFile)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-fg-subtle hover:bg-bg-muted hover:text-fg"
        >
          <FileJson size={12} /> Edit settings.json
        </button>
      </nav>
      <main className="min-w-0 flex-1 overflow-auto">
        <header className="sticky top-0 z-10 flex items-center border-b border-border bg-bg-subtle px-6 py-3">
          <h2 className="flex-1 text-base font-semibold">{SECTIONS.find((entry) => entry.id === section)?.label}</h2>
          <button
            type="button"
            data-testid="settings-close"
            aria-label="Close settings"
            onClick={close}
            className="rounded p-1 text-fg-subtle hover:bg-bg-muted hover:text-fg"
          >
            <X size={16} />
          </button>
        </header>
        <div className="mx-auto max-w-3xl px-6 py-5">
          {section === 'agents' && <AgentsSection />}
          {section === 'general' && <GeneralSection />}
          {section === 'editor' && <EditorSection />}
          {section === 'browser' && <BrowserSection />}
          {section === 'keyboard' && <KeyboardSection />}
        </div>
      </main>
    </div>
  );
}
