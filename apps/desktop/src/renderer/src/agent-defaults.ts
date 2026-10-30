import { resolveDefaultAgent, type AgentSettingsPatch } from '@arbora/shared';
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

export function toggleFavoriteModel(agentId: string, value: string): void {
  const all = useApp.getState().settings.agents.favoriteModels;
  const current = all[agentId] ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  void updateAgentSettings({ favoriteModels: { ...all, [agentId]: next } });
}

/** Sets the model new threads of `agentId` start with; choosing the current default clears it. */
export function toggleDefaultModel(agentId: string, value: string): void {
  const all = useApp.getState().settings.agents.defaultModels;
  const { [agentId]: current, ...others } = all;
  void updateAgentSettings({ defaultModels: current === value ? others : { ...others, [agentId]: value } });
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
