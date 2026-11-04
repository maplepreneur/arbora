import clsx from 'clsx';
import { isPickableAgent, visibleModels, type TaskId } from '@arbora/shared';
import { useAgents } from '../../agent-store';
import { updateSettings } from '../../settings-client';
import { useApp } from '../../store';
import { inputClass } from './controls';

/** Agent and model for one task (`settings.tasks`); "Default" follows the thread default. */
export function TaskAgentPicker({ task, label }: { task: TaskId; label: string }) {
  const choice = useApp((s) => s.settings.tasks[task]);
  const agentSettings = useApp((s) => s.settings.agents);
  const agents = useAgents((s) => s.agents);
  const pickable = agents.filter((agent) => isPickableAgent(agentSettings, agent.id) || agent.id === choice.agentId);
  const models = choice.agentId ? visibleModels(agentSettings, choice.agentId) : [];
  return (
    <div className="flex items-center gap-2" data-testid={`task-agent-${task}`}>
      <select
        aria-label={`${label} agent`}
        data-testid={`task-agent-${task}-agent`}
        value={choice.agentId ?? ''}
        onChange={(event) =>
          void updateSettings({ tasks: { [task]: { agentId: event.target.value || null, model: null } } })
        }
        className={clsx(inputClass, 'w-36')}
      >
        <option value="">Default agent</option>
        {pickable.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label} model`}
        data-testid={`task-agent-${task}-model`}
        value={choice.model ?? ''}
        disabled={choice.agentId === null || models.length === 0}
        onChange={(event) =>
          void updateSettings({ tasks: { [task]: { agentId: choice.agentId, model: event.target.value || null } } })
        }
        className={clsx(inputClass, 'w-36')}
      >
        <option value="">Its default model</option>
        {models.map((model) => (
          <option key={model.value} value={model.value}>
            {model.name}
          </option>
        ))}
      </select>
    </div>
  );
}

const TASKS: readonly { task: TaskId; title: string; detail: string }[] = [
  { task: 'agentMode', title: 'Agent mode', detail: 'Prompts from Mod+K on the page. A strong coding model fits.' },
  { task: 'design', title: 'Design mode', detail: 'Style and text edits sent from design mode.' },
  { task: 'fix', title: 'Fix problems', detail: 'Fix and Fix all in the Problems panel.' },
  { task: 'git', title: 'Commit and PR messages', detail: 'Runs in the background. A small, fast model is enough.' },
];

/** One row per task; "Default agent" follows the project's or the starred agent. */
export function TaskDefaults() {
  return (
    <div className="flex flex-col divide-y divide-border rounded border border-border" data-testid="task-defaults">
      {TASKS.map(({ task, title, detail }) => (
        <div key={task} className="flex items-center gap-3 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm">{title}</div>
            <div className="text-xs text-fg-subtle">{detail}</div>
          </div>
          <TaskAgentPicker task={task} label={title} />
        </div>
      ))}
    </div>
  );
}
