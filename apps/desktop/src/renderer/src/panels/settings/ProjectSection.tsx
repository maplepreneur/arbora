import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { FileJson, FolderOpen } from 'lucide-react';
import { CommandId, type BrowserToolPolicy } from '@arbora/shared';
import { useAgents } from '../../agent-store';
import { executeCommand } from '../../commands';
import { updateProjectSettings } from '../../settings-client';
import { showToast, useApp } from '../../store';
import { inputClass, SectionTitle, Segmented, SettingRow, Toggle } from './controls';

const POLICIES: readonly { value: BrowserToolPolicy; label: string }[] = [
  { value: 'ask', label: 'Ask' },
  { value: 'allow', label: 'Always' },
  { value: 'deny', label: 'Never' },
];

function TextSetting({
  title,
  detail,
  value,
  placeholder,
  testId,
  onSave,
}: {
  title: string;
  detail: string;
  value: string | undefined;
  placeholder: string;
  testId: string;
  onSave: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const commit = (): void => {
    const next = draft.trim();
    if (next === (value ?? '')) return;
    onSave(next === '' ? null : next);
  };
  return (
    <SettingRow title={title} detail={detail}>
      <input
        value={draft}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        className={clsx(inputClass, 'w-64 font-mono')}
      />
    </SettingRow>
  );
}

/** `.arbora/project.json` fields (committed with the project) and this project's agent permissions. */
export function ProjectSection() {
  const project = useApp((s) => s.project);
  const agents = useAgents((s) => s.agents);
  const [detected, setDetected] = useState<string | null>(null);
  useEffect(() => {
    if (project) void window.arbora.invoke('project.detectDevCommand').then(({ command }) => setDetected(command));
  }, [project]);
  if (!project) {
    return <p className="text-sm text-fg-muted">Open a project to edit its settings.</p>;
  }
  const settings = project.settings;
  const tools = settings.browserTools ?? {};
  const setTool = (tool: 'evaluate' | 'terminalRun', policy: BrowserToolPolicy): void => {
    const next = Object.fromEntries(
      Object.entries({ ...tools, [tool]: policy }).filter(([, value]) => value !== 'ask'),
    ) as typeof tools;
    void updateProjectSettings({ browserTools: Object.keys(next).length > 0 ? next : null });
  };
  return (
    <div data-testid="project-section">
      <p className="mb-2 text-sm text-fg-muted">
        Saved in <span className="font-mono">{project.name}/.arbora/project.json</span>, which is meant to be committed
        so the team shares it.
      </p>
      {project.settingsWarnings.map((warning) => (
        <p
          key={warning}
          className="mb-2 rounded border border-attention/40 bg-attention-soft px-3 py-2 text-xs text-attention"
        >
          {warning}
        </p>
      ))}
      <SectionTitle>Dev server</SectionTitle>
      <TextSetting
        key={`cmd:${settings.devCommand ?? ''}`}
        title="Dev command"
        detail={detected ? `Run Dev Server runs this. package.json suggests: ${detected}` : 'Run Dev Server runs this.'}
        value={settings.devCommand}
        placeholder={detected ?? 'pnpm dev'}
        testId="project-dev-command"
        onSave={(devCommand) => void updateProjectSettings({ devCommand })}
      />
      <TextSetting
        key={`url:${settings.devUrl ?? ''}`}
        title="Dev URL"
        detail="Opened by Open Dev Server URL. Usually detected from the dev server's output."
        value={settings.devUrl}
        placeholder="http://localhost:5173"
        testId="project-dev-url"
        onSave={(devUrl) => void updateProjectSettings({ devUrl })}
      />
      <SettingRow
        title="Open detected dev URLs"
        detail="Load a dev-server URL printed in a terminal when the browser panel is empty."
      >
        <Toggle
          on={settings.autoOpenDevUrl !== false}
          label="Open detected dev URLs"
          onChange={(on) => void updateProjectSettings({ autoOpenDevUrl: on ? null : false })}
        />
      </SettingRow>

      <SectionTitle>Agents</SectionTitle>
      <SettingRow
        title="Project default agent"
        detail="Wins over your own default for everyone who opens this project."
      >
        <select
          aria-label="Project default agent"
          value={settings.defaultAgent ?? ''}
          onChange={(e) => void updateProjectSettings({ defaultAgent: e.target.value || null })}
          className="h-7 rounded border border-border bg-bg px-1.5 text-xs"
        >
          <option value="">Use my default</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </SettingRow>

      <SectionTitle>Design match</SectionTitle>
      <TextSetting
        key={`threshold:${settings.designMatch?.threshold ?? 0.92}`}
        title="Stop score"
        detail="The agent stops comparing when the score reaches this. Default 0.92."
        value={settings.designMatch?.threshold !== undefined ? String(settings.designMatch.threshold) : undefined}
        placeholder="0.92"
        testId="project-design-threshold"
        onSave={(raw) => {
          const threshold = raw === null ? null : Number(raw);
          if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) {
            showToast('Stop score must be between 0 and 1');
            return;
          }
          const maxRounds = settings.designMatch?.maxRounds ?? 5;
          void updateProjectSettings({
            designMatch: threshold === null ? null : { threshold, maxRounds },
          });
        }}
      />
      <TextSetting
        key={`rounds:${settings.designMatch?.maxRounds ?? 5}`}
        title="Most rounds"
        detail="The agent also stops after this many compares. Default 5."
        value={settings.designMatch?.maxRounds !== undefined ? String(settings.designMatch.maxRounds) : undefined}
        placeholder="5"
        testId="project-design-rounds"
        onSave={(raw) => {
          const maxRounds = raw === null ? null : Number(raw);
          if (maxRounds !== null && (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 20)) {
            showToast('Most rounds must be a whole number from 1 to 20');
            return;
          }
          const threshold = settings.designMatch?.threshold ?? 0.92;
          void updateProjectSettings({
            designMatch: maxRounds === null ? null : { threshold, maxRounds },
          });
        }}
      />

      <SectionTitle>Browser tools for agents (MCP)</SectionTitle>
      <SettingRow
        title="browser_evaluate"
        detail="Run JavaScript in the page. Ask shows a card once per agent session."
      >
        <Segmented
          label="browser_evaluate permission"
          testId="project-tool-evaluate"
          value={tools.evaluate ?? 'ask'}
          options={POLICIES}
          onChange={(policy) => setTool('evaluate', policy)}
        />
      </SettingRow>
      <SettingRow title="terminal_run" detail="Run a short command in the project folder and read its output.">
        <Segmented
          label="terminal_run permission"
          testId="project-tool-terminal-run"
          value={tools.terminalRun ?? 'ask'}
          options={POLICIES}
          onChange={(policy) => setTool('terminalRun', policy)}
        />
      </SettingRow>
      <SettingRow
        title="Remembered permission answers"
        detail="“Always allow” and “Always reject” answers to agents' own tool cards, for every project."
      >
        <button
          type="button"
          onClick={() =>
            void window.arbora
              .invoke('agent.forgetPermissions', {})
              .then(() => showToast('Forgot every remembered answer'))
          }
          className="rounded border border-border px-2 py-1 text-xs hover:bg-bg-muted"
        >
          Forget all
        </button>
      </SettingRow>

      <SectionTitle>Files</SectionTitle>
      <SettingRow title="Screenshots" detail="Agent and manual screenshots are saved in .arbora/screenshots/.">
        <button
          type="button"
          onClick={() => void window.arbora.invoke('project.openScreenshots')}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-bg-muted"
        >
          <FolderOpen size={11} /> Open folder
        </button>
      </SettingRow>
      <SettingRow title="Edit project.json" detail="Keybinding overrides and anything not shown here.">
        <button
          type="button"
          onClick={() => executeCommand(CommandId.openProjectSettingsFile)}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-bg-muted"
        >
          <FileJson size={11} /> Open
        </button>
      </SettingRow>
    </div>
  );
}
