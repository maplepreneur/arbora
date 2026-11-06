import { resolvedPasswordMode } from '@arbora/shared';
import { updateSettings } from '../../settings-client';
import { useApp } from '../../store';
import { Segmented, SettingRow, Toggle } from './controls';

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
