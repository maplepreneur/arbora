import { create } from 'zustand';
import type { UsageTurn } from '@arbora/shared';
import { useGrove } from './grove-store';
import { showToast, useApp } from './store';

interface UsageState {
  turns: UsageTurn[];
  projectPath: string | null;
  loading: boolean;
}

export const useUsage = create<UsageState>(() => ({ turns: [], projectPath: null, loading: false }));

let requestGeneration = 0;

function activeProjectPath(): string | null {
  const { project, layout } = useApp.getState();
  const focus = useGrove.getState().focusPath;
  if (layout.workspace === 'grove' && focus) return focus;
  return project?.path ?? null;
}

export async function loadUsage(force = false): Promise<void> {
  const projectPath = activeProjectPath();
  const current = useUsage.getState();
  if (!force && current.projectPath === projectPath && !current.loading) return;
  const generation = ++requestGeneration;
  useUsage.setState({ projectPath, loading: true, ...(current.projectPath === projectPath ? {} : { turns: [] }) });
  if (!projectPath) {
    useUsage.setState({ turns: [], loading: false });
    return;
  }
  try {
    const result = await window.arbora.invoke('usage.summary', { range: 'all' });
    if (generation !== requestGeneration) return;
    useUsage.setState({ turns: result.turns, loading: false });
  } catch (error) {
    if (generation !== requestGeneration) return;
    useUsage.setState({ loading: false });
    showToast(`Could not read local usage: ${(error as Error).message}`);
  }
}
