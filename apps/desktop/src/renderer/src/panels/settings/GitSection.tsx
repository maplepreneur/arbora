import type { GitSyncMode } from '@arbora/shared';
import { updateSettings } from '../../settings-client';
import { useApp } from '../../store';
import { Segmented, SectionTitle, SettingRow } from './controls';
import { TaskAgentPicker } from './TaskAgentPicker';

const SYNC_OPTIONS: readonly { value: GitSyncMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'fetch', label: 'Fetch' },
  { value: 'pull', label: 'Fetch and pull' },
];

const CADENCES = [1, 2, 5, 10, 15, 30, 60] as const;

export function GitSection() {
  const git = useApp((s) => s.settings.git);
  return (
    <div data-testid="git-settings">
      <SectionTitle>Background sync</SectionTitle>
      <SettingRow
        title="Sync with the remote"
        detail="Fetch keeps the ahead/behind counts current. Fetch and pull also fast-forwards a clean branch that is only behind; it never merges or rebases."
      >
        <Segmented
          label="Sync with the remote"
          testId="setting-git-sync"
          value={git.autoSync}
          options={SYNC_OPTIONS}
          onChange={(autoSync) => void updateSettings({ git: { autoSync } })}
        />
      </SettingRow>
      <SettingRow title="Every">
        <select
          aria-label="Sync interval"
          data-testid="setting-git-sync-minutes"
          value={git.autoSyncMinutes}
          disabled={git.autoSync === 'off'}
          onChange={(event) => void updateSettings({ git: { autoSyncMinutes: Number(event.target.value) } })}
          className="h-7 rounded border border-border bg-bg px-2 text-xs disabled:opacity-50"
        >
          {CADENCES.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes === 60 ? '1 hour' : `${minutes} min`}
            </option>
          ))}
        </select>
      </SettingRow>
      <SectionTitle>AI</SectionTitle>
      <SettingRow
        title="Commit and PR agent"
        detail="Writes commit messages and pull requests in the background, not in a thread. A small, fast model is enough."
      >
        <TaskAgentPicker task="git" label="Git" />
      </SettingRow>
    </div>
  );
}
