import { onePasswordChoice, type ExtensionSettings } from '@arbora/shared';
import { updateSettings } from '../../settings-client';
import { useApp } from '../../store';
import { SettingRow, Toggle } from './controls';

const CATALOG: readonly { id: ExtensionSettings['enabled'][number]; title: string; detail: string }[] = [
  {
    id: '1password',
    title: '1Password',
    detail:
      'Optional. Arbora works without it. Turn it on here, or during setup, to sign in to the app and to tools such as Figma. The agent never sees the password.',
  },
  {
    id: 'react-devtools',
    title: 'React DevTools',
    detail: 'Inspect the React component tree. Loads when DevTools opens, unless you choose At startup.',
  },
  {
    id: 'vue-devtools',
    title: 'Vue DevTools',
    detail: 'Inspect the Vue component tree. Loads when DevTools opens, unless you choose At startup.',
  },
];

/** The pre-approved extension store. Today that is 1Password, React DevTools and Vue DevTools. */
export function ExtensionsSection() {
  const enabled = useApp((s) => s.settings.extensions.enabled);
  const toggle = (id: ExtensionSettings['enabled'][number], on: boolean): void => {
    if (id === '1password') {
      void updateSettings(onePasswordChoice(enabled, on));
      return;
    }
    const next = on ? [...enabled.filter((entry) => entry !== id), id] : enabled.filter((entry) => entry !== id);
    void updateSettings({ extensions: { enabled: next } });
  };
  return (
    <div>
      <p className="mb-3 text-[12px] text-fg-muted">
        Arbora only loads extensions from this list. They install with the app; nothing is fetched from the Chrome Web
        Store at runtime.
      </p>
      {CATALOG.map((entry) => (
        <SettingRow key={entry.id} title={entry.title} detail={entry.detail}>
          <Toggle
            on={enabled.includes(entry.id)}
            label={entry.title}
            testId={`extension-${entry.id}`}
            onChange={(on) => toggle(entry.id, on)}
          />
        </SettingRow>
      ))}
    </div>
  );
}
