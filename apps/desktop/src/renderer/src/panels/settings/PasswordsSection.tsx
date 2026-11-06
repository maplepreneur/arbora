import { useState } from 'react';
import { resolvedPasswordMode } from '@arbora/shared';
import { updateSettings } from '../../settings-client';
import { useApp } from '../../store';
import { Segmented, SettingRow, Toggle } from './controls';

/** Asks main whether `op` is on PATH. It does not install anything. */
export function PasswordCheck() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        data-testid="passwords-check"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void window.arbora
            .invoke('passwords.check')
            .then((result) => {
              setStatus(
                result.installed && result.version
                  ? `op ${result.version} · ${result.mode}`
                  : 'op is not installed. Run pnpm setup:1password in a terminal.',
              );
            })
            .catch((error: unknown) => setStatus((error as Error).message))
            .finally(() => setBusy(false));
        }}
        className="rounded border border-border px-2 py-1 text-xs text-fg hover:border-accent disabled:opacity-50"
      >
        Check
      </button>
      {status && (
        <span className="max-w-64 text-xs text-fg-muted" data-testid="passwords-check-result">
          {status}
        </span>
      )}
    </div>
  );
}

/** Opens the checkout setup script in a terminal. The app does not call sudo. */
export function SetupButton() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        data-testid="passwords-setup"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void window.arbora
            .invoke('passwords.runSetup')
            .then((result) => {
              setStatus(result.started ? 'Opened a terminal. Confirm before it uses sudo.' : result.command);
            })
            .catch((error: unknown) => setStatus((error as Error).message))
            .finally(() => setBusy(false));
        }}
        className="rounded border border-border px-2 py-1 text-xs text-fg hover:border-accent disabled:opacity-50"
      >
        Run setup
      </button>
      {status && (
        <span className="max-w-72 text-right text-xs break-all text-fg-muted" data-testid="passwords-setup-result">
          {status}
        </span>
      )}
    </div>
  );
}

/** 1Password is the only password provider. Arbora stores no passwords of its own. */
export function PasswordsSection() {
  const passwords = useApp((s) => s.settings.passwords);
  const on = passwords.provider === '1password';
  const mode = resolvedPasswordMode(passwords.mode);
  return (
    <div>
      <SettingRow
        title="1Password"
        detail="Fills logins for the app and for tools such as Figma. Run pnpm setup:1password once so the op command is on your PATH."
      >
        <Toggle
          on={on}
          label="Use 1Password"
          onChange={(next) => void updateSettings({ passwords: { provider: next ? '1password' : 'none' } })}
        />
      </SettingRow>
      <SettingRow
        title="How Arbora talks to 1Password"
        detail={
          mode === 'cli'
            ? 'Automatic uses the op command. Electron cannot connect to the 1Password desktop app, so the extension cannot unlock the vault by itself.'
            : 'The extension is loaded. Unlock still needs the desktop app integration, which this Electron version does not provide.'
        }
      >
        <Segmented
          label="1Password connection"
          value={passwords.mode}
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: 'cli', label: 'Command line' },
            { value: 'extension', label: 'Extension' },
          ]}
          onChange={(next) => void updateSettings({ passwords: { mode: next } })}
        />
      </SettingRow>
      <SettingRow
        title="1Password command"
        detail="Check looks for op and does not install anything. Run setup opens the checkout script in a terminal. On Linux that asks before it uses sudo."
      >
        <div className="flex items-start gap-2">
          <PasswordCheck />
          <SetupButton />
        </div>
      </SettingRow>
      {passwords.alwaysAllow.length > 0 && (
        <SettingRow
          title="Agent sign-in without asking"
          detail="Sites you allowed with Always. Remove one to ask again."
        >
          <ul className="flex max-w-72 flex-col gap-1">
            {passwords.alwaysAllow.map((origin) => (
              <li key={origin} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate" data-testid="passwords-allow-origin">
                  {origin}
                </span>
                <button
                  type="button"
                  data-testid="passwords-allow-remove"
                  onClick={() =>
                    void updateSettings({
                      passwords: { alwaysAllow: passwords.alwaysAllow.filter((item) => item !== origin) },
                    })
                  }
                  className="shrink-0 text-fg-muted hover:text-fg"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </SettingRow>
      )}
      <SettingRow title="Agent logins" detail="Ask shows a permission card before the agent signs in. Never refuses.">
        <Segmented
          label="Agent logins"
          value={passwords.agentLogins}
          options={[
            { value: 'ask', label: 'Ask' },
            { value: 'never', label: 'Never' },
          ]}
          onChange={(agentLogins) => void updateSettings({ passwords: { agentLogins } })}
        />
      </SettingRow>
    </div>
  );
}
