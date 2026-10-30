import { useEffect, useMemo } from 'react';
import {
  isPickableAgent,
  visibleModels,
  type AgentDefinition,
  type AgentModel,
  type AgentVerification,
} from '@arbora/shared';
import { useAgents } from './agent-store';
import { useDefaultAgentId } from './agent-defaults';
import { showToast, useApp } from './store';

export interface PickableAgent {
  readonly agent: AgentDefinition;
  readonly models: readonly AgentModel[];
  readonly isDefault: boolean;
}

/** `opencode/Beam Free` reads as `Beam Free` where the agent is already named beside it. */
export function shortModelName(name: string): string {
  const slash = name.lastIndexOf('/');
  return slash >= 0 && slash < name.length - 1 ? name.slice(slash + 1) : name;
}

const checking = new Set<string>();

/** Runs the sign-in check for one agent; the result lands in settings (and `settings.changed`). */
export async function verifyAgent(agentId: string): Promise<AgentVerification | null> {
  checking.add(agentId);
  useApp.setState((s) => ({ checkingAgents: [...new Set([...s.checkingAgents, agentId])] }));
  try {
    const result = await window.arbora.invoke('agent.verify', { agentId });
    const settings = await window.arbora.invoke('settings.get');
    useApp.setState({ settings });
    return result;
  } catch (error) {
    showToast(`Could not check ${agentId}: ${(error as Error).message}`);
    return null;
  } finally {
    checking.delete(agentId);
    useApp.setState((s) => ({ checkingAgents: s.checkingAgents.filter((id) => id !== agentId) }));
  }
}

/**
 * Checks installed agents that have never been checked, one at a time, when a picker or the
 * Settings page mounts. Turned off by `agents.autoVerify`.
 */
export function useAutoVerify(): void {
  const auto = useApp((s) => s.settings.agents.autoVerify);
  const verified = useApp((s) => s.settings.agents.verified);
  const availability = useAgents((s) => s.availability);
  useEffect(() => {
    if (!auto) return;
    const pending = availability
      .filter((entry) => entry.available && !verified[entry.id] && !checking.has(entry.id))
      .map((entry) => entry.id);
    if (pending.length === 0) return;
    void (async () => {
      for (const id of pending) await verifyAgent(id);
    })();
  }, [auto, verified, availability]);
}

/** Signed-in, visible agents with their visible models. The default agent comes first. */
export function usePickableAgents(): PickableAgent[] {
  const agents = useAgents((s) => s.agents);
  const settings = useApp((s) => s.settings.agents);
  const defaultAgent = useDefaultAgentId();
  return useMemo(() => {
    const list = agents
      .filter((agent) => isPickableAgent(settings, agent.id))
      .map((agent) => ({ agent, models: visibleModels(settings, agent.id), isDefault: agent.id === defaultAgent }));
    return list.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }, [agents, settings, defaultAgent]);
}
