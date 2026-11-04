import { Fragment } from 'react';
import clsx from 'clsx';
import { Keyboard } from 'lucide-react';
import { CommandId, formatChord } from '@arbora/shared';
import { useAgents } from '../../agent-store';
import { setStartDefaultOnOpen } from '../../grove-store';
import { useKeybindingTable } from '../../keybindings';
import { updateProjectSettings, updateSettings } from '../../settings-client';
import { useApp } from '../../store';
import { SectionTitle, SettingRow, Toggle } from './controls';

const MAX_HELPERS = 10;

interface ChordRow {
  readonly ids: readonly string[];
  /** The chords are the two ends of a run (`Ctrl+1`–`Ctrl+9`), not alternatives. */
  readonly range?: boolean;
  readonly text: string;
}

const CHORDS: readonly ChordRow[] = [
  { ids: [CommandId.toggleWorkspace], text: 'Switch between the browser and Grove' },
  { ids: [CommandId.groveNewDefault], text: 'Start the default agent' },
  { ids: [CommandId.groveNewTerminal], text: 'New terminal in the open project' },
  { ids: [CommandId.agentNewThread], text: 'New agent with a task' },
  { ids: [CommandId.groveSelectSession1, CommandId.groveSelectSession9], range: true, text: 'Agent 1 to 9, top down' },
  { ids: [CommandId.groveFocusAgents], text: 'Focus the agent list' },
  { ids: [CommandId.grovePreviousSession, CommandId.groveNextSession], text: 'Previous or next agent' },
  { ids: [CommandId.agentShowAttention], text: 'The agent that needs you' },
  { ids: [CommandId.groveStopSession], text: 'Stop the selected agent' },
  { ids: [CommandId.groveArchiveSession], text: 'Archive the selected agent' },
  { ids: [CommandId.toggleSidebar], text: 'Hide or show the list' },
  { ids: [CommandId.focusPanelLeft, CommandId.focusPanelRight], text: 'Move between the list and the composer' },
];

function ProjectDefaults() {
  const project = useApp((s) => s.project);
  const agents = useAgents((s) => s.agents);
  const appDefault = useApp((s) => s.settings.agents.defaultAgent);
  if (!project) {
    return <p className="py-3 text-sm text-fg-muted">Open a project to choose the agent Grove starts.</p>;
  }
  const own = agents.find((agent) => agent.id === appDefault)?.name;
  const projectDefault = project.settings.defaultAgent;
  const startOnOpen = project.settings.startDefaultOnOpen !== false;
  return (
    <>
      <SettingRow
        title="Default agent"
        detail="New Agent starts it, and so does opening an empty Grove. Saved in .arbora/project.json for everyone on the project."
      >
        <select
          aria-label="Default agent for this project"
          data-testid="setting-grove-default-agent"
          value={projectDefault ?? ''}
          onChange={(e) => void updateProjectSettings({ defaultAgent: e.target.value || null })}
          className="h-7 max-w-56 rounded border border-border bg-bg px-1.5 text-xs"
        >
          <option value="">{own ? `My default (${own})` : 'My default (none)'}</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        title="Start it when Grove opens empty"
        detail="Opening Grove with no agents starts one session of the default agent, once per visit."
      >
        <Toggle
          on={startOnOpen}
          label="Start the default agent when Grove opens empty"
          testId="setting-grove-start-on-open"
          onChange={(on) => void setStartDefaultOnOpen(on)}
        />
      </SettingRow>
    </>
  );
}

function HelperSettings() {
  const grove = useApp((s) => s.settings.grove);
  return (
    <>
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
    </>
  );
}

function Chords() {
  const table = useKeybindingTable();
  const platform = useApp((s) => s.info.platform);
  const label = (id: string): string => {
    const binding = table.forCommand(id);
    return binding ? formatChord(binding.chord, platform) : 'unbound';
  };
  return (
    <div className="py-3">
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-1.5 text-sm" data-testid="grove-chords">
        {CHORDS.map((row) => (
          <Fragment key={row.ids[0]}>
            <dt className="flex items-center gap-1">
              {row.ids.map((id, i) => (
                <Fragment key={id}>
                  {i > 0 && <span className="text-fg-subtle">{row.range ? '–' : '/'}</span>}
                  <kbd
                    className={clsx(
                      'rounded border border-border bg-bg-muted px-1.5 py-px font-mono text-[11px]',
                      label(id) === 'unbound' && 'text-fg-subtle',
                    )}
                  >
                    {label(id)}
                  </kbd>
                </Fragment>
              ))}
            </dt>
            <dd className="text-fg-muted">{row.text}</dd>
          </Fragment>
        ))}
      </dl>
      <button
        type="button"
        onClick={() => useApp.setState({ settingsSection: 'keyboard' })}
        className="mt-3 flex items-center gap-1.5 text-xs text-accent hover:underline"
      >
        <Keyboard size={12} /> Change shortcuts
      </button>
    </div>
  );
}

/** Settings → Grove: the project's default agent, helper agents, and the Grove chords. */
export function GroveSection() {
  return (
    <div data-testid="grove-section">
      <p className="mb-2 text-sm text-fg-muted">
        Grove lists the projects you have not closed. They keep running when you switch back or close the window.
        Quitting Arbora stops them after you confirm. Close a project in the sidebar to drop it from that list.
      </p>
      <SectionTitle>This project</SectionTitle>
      <ProjectDefaults />
      <SectionTitle>Helper agents</SectionTitle>
      <HelperSettings />
      <SectionTitle>Shortcuts</SectionTitle>
      <Chords />
    </div>
  );
}
