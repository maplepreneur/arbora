import { resolveDefaultAgent, resolveTaskAgent, type AgentSettingsPatch, type TaskId } from '@arbora/shared';
import { useAgents } from './agent-store';
import { showToast, useApp } from './store';

/** Writes `agents` settings through main; the result (and `settings.changed`) updates the store. */
export async function updateAgentSettings(patch: AgentSettingsPatch): Promise<void> {
  try {
    const settings = await window.arbora.invoke('settings.update', { agents: patch });
    useApp.setState({ settings });
  } catch (error) {
    showToast(`Could not save the setting: ${(error as Error).message}`);
  }
}

/** Sets the app-wide default agent for new threads; choosing the current default clears it. */
export function toggleDefaultAgent(agentId: string): void {
  const current = useApp.getState().settings.agents.defaultAgent;
  void updateAgentSettings({ defaultAgent: current === agentId ? null : agentId });
}

/** The agent new threads use: the project's `defaultAgent`, else the app setting, if either is known. */
export function useDefaultAgentId(): string | undefined {
  const projectDefault = useApp((s) => s.project?.settings.defaultAgent);
  const appDefault = useApp((s) => s.settings.agents.defaultAgent);
  const agentIds = useAgents((s) => s.agents.map((a) => a.id).join('\n'));
  return resolveDefaultAgent(agentIds.split('\n'), projectDefault, appDefault);
}

export function defaultAgentId(): string | undefined {
  const { project, settings } = useApp.getState();
  return resolveDefaultAgent(
    useAgents.getState().agents.map((a) => a.id),
    project?.settings.defaultAgent,
    settings.agents.defaultAgent,
  );
}

/** The agent a task starts new threads with (Settings → Agents, "Defaults per task"). */
export function taskAgent(task: TaskId): { agentId: string } | undefined {
  const { project, settings } = useApp.getState();
  return resolveTaskAgent(
    settings.tasks,
    task,
    useAgents.getState().agents.map((a) => a.id),
    settings.agents,
    project?.settings.defaultAgent,
  );
}

/** The agent a task picked itself, if it is still installed; undefined follows the thread default. */
export function useTaskAgentId(task: TaskId): string | undefined {
  const chosen = useApp((s) => s.settings.tasks[task].agentId);
  const known = useAgents((s) => chosen !== null && s.agents.some((a) => a.id === chosen));
  return known && chosen !== null ? chosen : undefined;
}
