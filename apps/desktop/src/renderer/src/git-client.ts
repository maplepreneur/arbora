import { create } from 'zustand';
import type { GitBranch, GitCommit, GitStash, GitStatus, GitSyncResult } from '@arbora/shared';
import { setGitDecorations, useFiles } from './files-store';
import { applyGitLines } from './panels/editor/sessions';

export const useGit = create<{
  status: GitStatus | null;
  branches: GitBranch[];
  log: GitCommit[];
  stashes: GitStash[];
  /** The commit message box, shared by the panel and the Git commands. */
  message: string;
  /** What a running Git action is doing ("Pushing…"); null when idle. */
  busy: string | null;
  lastSync: GitSyncResult | null;
  /** Bumped to move focus to the commit message box. */
  focusMessage: number;
}>(() => ({
  status: null,
  branches: [],
  log: [],
  stashes: [],
  message: '',
  busy: null,
  lastSync: null,
  focusMessage: 0,
}));

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
    if (!status.repo) {
      useGit.setState({ status, branches: [], log: [], stashes: [] });
      return status;
    }
    useGit.setState({ status });
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
