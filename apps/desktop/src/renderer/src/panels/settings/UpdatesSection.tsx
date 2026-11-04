import { useEffect } from 'react';
import { Download, FolderOpen, RefreshCw, Sparkles } from 'lucide-react';
import { checkoutBranch, CommandId, updatesOffText, type UpdateChannel } from '@arbora/shared';
import { executeCommand } from '../../commands';
import { updateSettings } from '../../settings-client';
import { openOverlay, useApp } from '../../store';
import { checkForUpdates, loadUpdateState, useUpdates } from '../../update-store';
import { SectionTitle, Segmented, SettingRow, Toggle } from './controls';

const CHANNELS: readonly { value: UpdateChannel; label: string }[] = [
  { value: 'latest', label: 'Stable' },
  { value: 'beta', label: 'Beta' },
  { value: 'off', label: 'Development' },
];

function channelDetail(channel: UpdateChannel, sourceLauncher: boolean): string {
  const branch = checkoutBranch(channel);
  const launcher = sourceLauncher
    ? branch
      ? ` This copy runs from a source checkout: each launch moves a clean checkout to origin/${branch}.`
      : ' This copy runs from a source checkout, and the launcher leaves it as it is.'
    : '';
  switch (channel) {
    case 'latest':
      return `Stable releases (x.y.z).${launcher}`;
    case 'beta':
      return `Prereleases built from the beta branch (x.y.z-beta.n), and every stable release.${launcher}`;
    case 'off':
      return `Never checks, downloads or installs an update. For building Arbora yourself.${launcher}`;
    default: {
      const unreachable: never = channel;
      return unreachable;
    }
  }
}

const INSTALL_LABEL: Readonly<Record<ReturnType<typeof useApp.getState>['info']['installKind'], string>> = {
  dmg: 'macOS app',
  nsis: 'Windows installer (per user)',
  appimage: 'AppImage',
  deb: 'Debian package',
  aur: 'AUR package (arbora-bin)',
  tarball: 'Tarball',
  dev: 'Development build',
};

function statusText(state: ReturnType<typeof useUpdates.getState>['state']): string {
  switch (state.status) {
    case 'idle':
      return 'Not checked yet';
    case 'off':
      return updatesOffText(state.reason);
    case 'checking':
      return 'Checking…';
    case 'current':
      return `Up to date (checked ${new Date(state.checkedAt).toLocaleTimeString()})`;
    case 'available':
      return `Arbora ${state.version} is available`;
    case 'downloading':
      return `Downloading ${state.version}: ${state.percent}%`;
    case 'ready':
      return `Arbora ${state.version} installs on restart`;
    case 'error':
      return `Last check failed: ${state.message}`;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

/** Updates, diagnostics, and setup again. */
export function UpdatesSection() {
  const info = useApp((s) => s.info);
  const updates = useApp((s) => s.settings.updates);
  const diagnostics = useApp((s) => s.settings.diagnostics);
  const state = useUpdates((s) => s.state);
  useEffect(() => {
    void loadUpdateState();
  }, []);
  const selfUpdating = useUpdates((s) => s.selfUpdates);
  const sourceLauncher = useUpdates((s) => s.sourceLauncher);
  return (
    <div data-testid="updates-section">
      <SectionTitle>Version</SectionTitle>
      <SettingRow title={`Arbora ${info.version}`} detail={`${INSTALL_LABEL[info.installKind]} · ${statusText(state)}`}>
        <button
          type="button"
          data-testid="check-updates"
          disabled={state.status === 'off' || state.status === 'checking'}
          onClick={() => void checkForUpdates()}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-bg-muted disabled:opacity-40"
        >
          <RefreshCw size={11} /> Check now
        </button>
      </SettingRow>
      <SettingRow title="Channel" detail={channelDetail(updates.channel, sourceLauncher)}>
        <Segmented
          label="Update channel"
          testId="update-channel"
          value={updates.channel}
          options={CHANNELS}
          onChange={(channel) => void updateSettings({ updates: { channel } })}
        />
      </SettingRow>
      <SettingRow
        title="Check on startup"
        detail="Asks GitHub Releases a few seconds after launch, then every six hours."
      >
        <Toggle
          on={updates.autoCheck}
          label="Check for updates on startup"
          onChange={(on) => void updateSettings({ updates: { autoCheck: on } })}
        />
      </SettingRow>
      <SettingRow
        title="Download in the background"
        detail={
          selfUpdating
            ? 'Downloads a new version as soon as it is found and installs it when you quit.'
            : 'This install cannot replace itself (a package-manager install, or an unsigned macOS build), so Arbora tells you when a new version exists and what to download.'
        }
      >
        <Toggle
          on={updates.autoDownload && selfUpdating}
          label="Download updates automatically"
          onChange={(on) => void updateSettings({ updates: { autoDownload: on } })}
        />
      </SettingRow>
      {(state.status === 'available' || state.status === 'ready') && (
        <button
          type="button"
          onClick={() => openOverlay('update')}
          className="mt-2 flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg"
        >
          <Download size={12} /> Release notes and install
        </button>
      )}

      <SectionTitle>Diagnostics</SectionTitle>
      <p className="mb-1 text-xs text-fg-muted">
        Arbora has no telemetry and never uploads anything. These stay on this machine until you export them.
      </p>
      <SettingRow title="Keep a main-process log" detail="Warnings and errors in logs/main.log (1 MB, rotated).">
        <Toggle
          on={diagnostics.logToFile}
          label="Main-process log"
          onChange={(on) => void updateSettings({ diagnostics: { logToFile: on } })}
        />
      </SettingRow>
      <SettingRow title="Keep crash dumps" detail="Chromium minidumps after a crash. Applies after a restart.">
        <Toggle
          on={diagnostics.crashDumps}
          label="Crash dumps"
          onChange={(on) => void updateSettings({ diagnostics: { crashDumps: on } })}
        />
      </SettingRow>
      <div className="flex gap-2 pt-3">
        <button
          type="button"
          data-testid="export-diagnostics"
          onClick={() => executeCommand(CommandId.exportDiagnostics)}
          className="rounded border border-border px-2.5 py-1 text-xs hover:bg-bg-muted"
        >
          Export diagnostics…
        </button>
        <button
          type="button"
          onClick={() => void window.arbora.invoke('diagnostics.openCrashFolder')}
          className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs hover:bg-bg-muted"
        >
          <FolderOpen size={11} /> Crash dumps folder
        </button>
      </div>
      <p className="mt-1 text-[11px] text-fg-subtle">
        The zip has app and OS versions, settings with agent env values and tokens removed, the log, and the names of
        crash dumps. Attach it to a bug report.
      </p>

      <SectionTitle>Setup</SectionTitle>
      <SettingRow title="Getting started" detail="Run the first-run setup again.">
        <button
          type="button"
          onClick={() => openOverlay('onboarding')}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-bg-muted"
        >
          <Sparkles size={11} /> Open
        </button>
      </SettingRow>
      <SettingRow
        title="Language servers"
        detail="TypeScript LSP (hover, go to definition, completion) is an opt-in that ships with Stage 11."
      >
        <span className="rounded bg-bg-muted px-2 py-0.5 text-[11px] text-fg-subtle">Stage 11</span>
      </SettingRow>
    </div>
  );
}
