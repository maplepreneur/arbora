import { create } from 'zustand';
import type { FileChange, GitBranch, GitCommit, GitStash, GitStatus } from '@arbora/shared';
import { noteFileChanged, useAgents } from './agent-store';
import { setGitDecorations, useFiles } from './files-store';
import { applyGitLines } from './panels/editor/sessions';

export const useGit = create<{
  status: GitStatus | null;
  branches: GitBranch[];
  log: GitCommit[];
  stashes: GitStash[];
}>(() => ({ status: null, branches: [], log: [], stashes: [] }));

let timer: ReturnType<typeof setTimeout> | undefined;

/** Debounced status refresh after watcher events. */
export function scheduleGitRefresh(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void refreshGit();
  }, 300);
}

export async function refreshGit(): Promise<GitStatus | null> {
  try {
    const status = await window.arbora.invoke('git.status');
    setGitDecorations(status.files);
    const active = useFiles.getState().tabs.find((tab) => tab.id === useFiles.getState().active);
    if (active?.kind === 'file') {
      const lines = await window.arbora.invoke('git.lines', { path: active.path });
      applyGitLines(active.path, lines);
    }
    useGit.setState({ status, branches: [], log: [], stashes: [] });
    if (!status.repo) return status;
    const [branches, log, stashes] = await Promise.all([
      window.arbora.invoke('git.branches'),
      window.arbora.invoke('git.log'),
      window.arbora.invoke('git.stash'),
    ]);
    useGit.setState({ status, branches, log, stashes });
    return status;
  } catch {
    return null;
  }
}

/** Files the watcher sees while an agent turn is running count as that turn's changes. */
export function noteAgentWatcherChanges(changes: readonly FileChange[]): void {
  const thread = useAgents.getState().threads.find((item) => item.state.status === 'prompting');
  if (!thread) return;
  for (const change of changes) noteFileChanged(thread.id, change.path);
}
