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
