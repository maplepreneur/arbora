import { useState } from 'react';
import clsx from 'clsx';
import { FileJson, X } from 'lucide-react';
import { CommandId, type ThemeMode } from '@arbora/shared';
import { executeCommand } from '../../commands';
import { updateSettings } from '../../settings-client';
import { useApp, type SettingsSection } from '../../store';
import { AgentsSection } from './AgentsSection';
import { ExtensionsSection } from './ExtensionsSection';
import { PasswordsSection } from './PasswordsSection';
import { AppearanceSection } from './AppearanceSection';
import { GitSection } from './GitSection';
import { GroveSection } from './GroveSection';
import { inputClass, Segmented, SettingRow, Toggle } from './controls';
import { KeyboardSection } from './KeyboardSection';
import { McpSection } from './McpSection';
import { NotificationsSection } from './NotificationsSection';
import { ProjectSection } from './ProjectSection';
import { SkillsSection } from './SkillsSection';
import { UpdatesSection } from './UpdatesSection';

type Section = SettingsSection;

const SECTIONS: readonly { id: Section; label: string }[] = [
  { id: 'agents', label: 'Agents' },
  { id: 'grove', label: 'Grove' },
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications & sounds' },
  { id: 'editor', label: 'Editor' },
  { id: 'git', label: 'Git' },
  { id: 'skills', label: 'Skills' },
  { id: 'mcp', label: 'MCP servers' },
  { id: 'browser', label: 'Browser' },
  { id: 'extensions', label: 'Extensions' },
  { id: 'passwords', label: 'Passwords' },
  { id: 'project', label: 'Project' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'updates', label: 'Updates & diagnostics' },
];

function close(): void {
  useApp.setState({ settingsOpen: false });
}

// --- Other sections --------------------------------------------------------------------------------

const THEMES: readonly { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function GeneralSection() {
  const theme = useApp((s) => s.theme.mode);
  const isMac = useApp((s) => s.info.platform === 'darwin');
  const quitOnLastWindowClose = useApp((s) => s.settings.quitOnLastWindowClose);
  return (
    <div>
      <SettingRow title="Theme">
        <div role="radiogroup" className="flex rounded-md border border-border bg-bg-muted p-0.5">
          {THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={theme === option.value}
              onClick={() => {
                void window.arbora.invoke('theme.set', { mode: option.value }).then((next) => {
                  useApp.setState({ theme: next });
                });
              }}
              className={clsx(
                'rounded px-2 py-0.5 text-xs',
                theme === option.value ? 'bg-bg text-fg shadow-sm' : 'text-fg-subtle hover:text-fg',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </SettingRow>
      {isMac && (
        <SettingRow
          title="Quit when the last window closes"
          detail="Stops dev servers and agents. Off keeps Arbora running in the dock with no window."
        >
          <Toggle
            on={quitOnLastWindowClose}
            label="Quit when the last window closes"
            testId="setting-quit-on-last-window-close"
            onChange={(on) => void updateSettings({ quitOnLastWindowClose: on })}
          />
        </SettingRow>
      )}
    </div>
  );
}

function EditorSection() {
  const editor = useApp((s) => s.settings.editor);
  return (
    <div>
      <SettingRow
        title="Format on save"
        detail="Run the project's own Prettier (from its node_modules) when saving. Skipped without Prettier."
      >
        <Toggle
          on={editor.formatOnSave}
          label="Format on save"
          testId="setting-format-on-save"
          onChange={(on) => void updateSettings({ editor: { formatOnSave: on } })}
        />
      </SettingRow>
      <SettingRow title="ESLint on save" detail="Lint the saved file with the project's ESLint and config.">
        <Toggle
          on={editor.eslintOnSave}
          label="ESLint on save"
          testId="setting-eslint-on-save"
          onChange={(on) => void updateSettings({ editor: { eslintOnSave: on } })}
        />
      </SettingRow>
      <SettingRow
        title="Language server"
        detail="Hover, completion and go to definition in JavaScript and TypeScript, from the project's typescript-language-server. It uses that project's TypeScript. Off until you turn it on."
      >
        <Toggle
          on={editor.lsp}
          label="Language server"
          testId="setting-lsp"
          onChange={(on) => void updateSettings({ editor: { lsp: on } })}
        />
      </SettingRow>
      <SettingRow
        title="Type-check on save"
        detail="Run tsc --noEmit after saving a TypeScript file. Slow on large projects, so off by default."
      >
        <Toggle
          on={editor.tscOnSave}
          label="Type-check on save"
          testId="setting-tsc-on-save"
          onChange={(on) => void updateSettings({ editor: { tscOnSave: on } })}
        />
      </SettingRow>
      <SettingRow title="Terminal shell" detail="Empty uses $SHELL (macOS, Linux) or PowerShell (Windows).">
        <ShellInput />
      </SettingRow>
    </div>
  );
}

function ShellInput() {
  const shell = useApp((s) => s.settings.terminal.shell);
  const [draft, setDraft] = useState(shell ?? '');
  return (
    <input
      value={draft}
      placeholder="default"
      aria-label="Terminal shell"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim();
        if (next && next !== shell) void updateSettings({ terminal: { shell: next } });
      }}
      className={clsx(inputClass, 'w-48 font-mono')}
    />
  );
}

function BrowserSection() {
  const browser = useApp((s) => s.settings.browser);
  const hasProject = useApp((s) => s.project !== null);
  return (
    <div>
      <SettingRow title="React and Vue DevTools" detail="Load the bundled extensions into the browser panel.">
        <Toggle
          on={browser.devToolsExtensions}
          label="DevTools extensions"
          onChange={(on) => void updateSettings({ browser: { devToolsExtensions: on } })}
        />
      </SettingRow>
      <SettingRow
        title="Load DevTools extensions"
        detail="When DevTools opens saves about 45 MB; the page reloads once the first time. At startup keeps them ready for every page."
      >
        <Segmented
          label="When to load the DevTools extensions"
          testId="setting-devtools-load"
          value={browser.devToolsExtensionsLoad}
          options={[
            { value: 'onDemand', label: 'When DevTools opens' },
            { value: 'startup', label: 'At startup' },
          ]}
          onChange={(devToolsExtensionsLoad) => void updateSettings({ browser: { devToolsExtensionsLoad } })}
        />
      </SettingRow>
      <SettingRow
        title="Open links in tabs"
        detail="Links that would open a new window open a reference tab instead. Sign-in popups still open their own window."
      >
        <Toggle
          on={browser.openLinksInTabs}
          label="Open links in tabs"
          onChange={(on) => void updateSettings({ browser: { openLinksInTabs: on } })}
        />
      </SettingRow>
      <SettingRow
        title="Trust localhost certificates"
        detail="Accept self-signed certificates from local dev servers (Vite https, mkcert)."
      >
        <Toggle
          on={browser.trustLocalhostCertificates}
          label="Trust localhost certificates"
          onChange={(on) => void updateSettings({ browser: { trustLocalhostCertificates: on } })}
        />
      </SettingRow>
      <SettingRow
        title="Reset browser data"
        detail="Clear this project's cookies, local storage and cache, then reload the page. Logins are lost."
      >
        <button
          type="button"
          disabled={!hasProject}
          data-testid="reset-browser-data"
          onClick={() => executeCommand(CommandId.browserResetData)}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-bg-muted disabled:opacity-40"
        >
          Reset…
        </button>
      </SettingRow>
    </div>
  );
}

// --- Page ------------------------------------------------------------------------------------------

/** Settings, shown in place of the browser pane. `Mod+,` opens and closes it. */
export default function SettingsPage() {
  const section = useApp((s) => s.settingsSection);
  const setSection = (next: Section): void => useApp.setState({ settingsSection: next });
  return (
    <div data-testid="settings-page" className="flex h-full min-h-0 bg-bg-subtle text-fg">
      <nav aria-label="Settings sections" className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border p-2">
        <h1 className="px-2 pt-1 pb-2 text-sm font-semibold">Settings</h1>
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            data-testid={`settings-nav-${entry.id}`}
            aria-current={section === entry.id ? 'page' : undefined}
            onClick={() => setSection(entry.id)}
            className={clsx(
              'rounded-md px-2 py-1.5 text-left text-sm',
              section === entry.id ? 'bg-accent-soft font-medium text-accent' : 'text-fg-muted hover:bg-bg-muted',
            )}
          >
            {entry.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => executeCommand(CommandId.openSettingsFile)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-fg-subtle hover:bg-bg-muted hover:text-fg"
        >
          <FileJson size={12} /> Edit settings.json
        </button>
      </nav>
      <main className="min-w-0 flex-1 overflow-auto">
        <header className="sticky top-0 z-10 flex items-center border-b border-border bg-bg-subtle px-6 py-3">
          <h2 className="flex-1 text-base font-semibold">{SECTIONS.find((entry) => entry.id === section)?.label}</h2>
          <button
            type="button"
            data-testid="settings-close"
            aria-label="Close settings"
            onClick={close}
            className="rounded p-1 text-fg-subtle hover:bg-bg-muted hover:text-fg"
          >
            <X size={16} />
          </button>
        </header>
        <div className="mx-auto max-w-3xl px-6 py-5">
          {section === 'agents' && <AgentsSection />}
          {section === 'grove' && <GroveSection />}
          {section === 'general' && <GeneralSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'editor' && <EditorSection />}
          {section === 'git' && <GitSection />}
          {section === 'skills' && <SkillsSection />}
          {section === 'mcp' && <McpSection />}
          {section === 'browser' && <BrowserSection />}
          {section === 'extensions' && <ExtensionsSection />}
          {section === 'passwords' && <PasswordsSection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'project' && <ProjectSection />}
          {section === 'keyboard' && <KeyboardSection />}
          {section === 'updates' && <UpdatesSection />}
        </div>
      </main>
    </div>
  );
}
