import { describe, expect, it } from 'vitest';
import {
  addRecentProject,
  applySettingsPatch,
  appSettingsPatchSchema,
  defaultSettings,
  isPickableAgent,
  loadSettings,
  MAX_RECENT_PROJECTS,
  mergeAgentSettings,
  mergeEditorSettings,
  migrateSettings,
  projectSettingsUpdates,
  resolveDefaultAgent,
  visibleModels,
  SETTINGS_VERSION,
  SettingsMigrationError,
  type Migration,
} from './settings.js';

describe('migrateSettings', () => {
  it('treats a non-object as an empty current-version file', () => {
    expect(migrateSettings(null)).toEqual({ version: SETTINGS_VERSION });
    expect(migrateSettings([1, 2])).toEqual({ version: SETTINGS_VERSION });
  });

  it('upgrades an unversioned file', () => {
    expect(migrateSettings({ theme: 'dark' })).toEqual({ theme: 'dark', version: SETTINGS_VERSION });
  });

  it('runs a chain of migrations in order', () => {
    const migrations: Record<number, Migration> = {
      0: (s) => ({ ...s, version: 1, a: 1 }),
      1: (s) => ({ ...s, version: 2, b: Number(s['a']) + 1 }),
      2: (s) => ({ ...s, version: 3, c: Number(s['b']) + 1 }),
    };
    expect(migrateSettings({}, migrations, 3)).toEqual({ version: 3, a: 1, b: 2, c: 3 });
    expect(migrateSettings({ version: 2, b: 10 }, migrations, 3)).toEqual({ version: 3, b: 10, c: 11 });
  });

  it('throws on files from a newer version', () => {
    expect(() => migrateSettings({ version: SETTINGS_VERSION + 1 })).toThrow(SettingsMigrationError);
  });

  it('throws on a missing step or a migration that does not advance', () => {
    expect(() => migrateSettings({ version: 1 }, { 0: (s) => ({ ...s, version: 1 }) }, 2)).toThrow(
      /No settings migration/,
    );
    expect(() => migrateSettings({}, { 0: (s) => ({ ...s, version: 0 }) }, 1)).toThrow(/did not advance/);
  });
});

describe('loadSettings', () => {
  it('returns defaults for an empty file', () => {
    const { settings, warnings } = loadSettings({});
    expect(settings).toEqual(defaultSettings());
    expect(settings.terminalPassthrough).toBe(true);
    expect(settings.theme).toBe('system');
    expect(warnings).toEqual([]);
  });

  it('keeps valid fields and resets only invalid ones', () => {
    const { settings, warnings } = loadSettings({
      version: 1,
      theme: 'purple',
      keybindings: { 'arbora.agentMode': 'mod+i' },
      terminalPassthrough: false,
    });
    expect(settings.theme).toBe('system');
    expect(settings.keybindings).toEqual({ 'arbora.agentMode': 'mod+i' });
    expect(settings.terminalPassthrough).toBe(false);
    expect(warnings).toEqual(['settings.theme is invalid and was reset to its default']);
  });

  it('preserves per-project layout state', () => {
    const projects = {
      '/p': { layout: { groups: { main: { browser: 70, agent: 30 } }, sidebarView: 'git', bottomTab: 'problems' } },
    };
    expect(loadSettings({ version: 1, projects }).settings.projects).toEqual(projects);
  });

  it('upgrades a v1 file with browser defaults and keeps existing values', () => {
    const { settings, warnings } = loadSettings({ version: 1, theme: 'dark', projects: { '/p': {} } });
    expect(warnings).toEqual([]);
    expect(settings.version).toBe(SETTINGS_VERSION);
    expect(settings.theme).toBe('dark');
    expect(settings.browser).toEqual({ devToolsExtensions: true, trustLocalhostCertificates: true });
    expect(settings.projects['/p']?.browser).toBeUndefined();
  });

  it('upgrades a v2 file with empty agent settings', () => {
    const { settings, warnings } = loadSettings({ version: 2, theme: 'light' });
    expect(warnings).toEqual([]);
    expect(settings.version).toBe(3);
    expect(settings.agents).toEqual({
      custom: [],
      permissions: {},
      defaultModels: {},
      favoriteModels: {},
      hidden: [],
      hiddenModels: {},
      verified: {},
      autoVerify: true,
      env: {},
      adapterVersions: {},
    });
  });

  it('keeps custom agents and remembered permissions', () => {
    const agents = {
      custom: [{ id: 'my-agent', name: 'Mine', command: 'my-agent', args: ['acp'], env: { FOO: 'bar' } }],
      permissions: { 'claude-code:execute': 'allow' },
    };
    expect(loadSettings({ version: 3, agents }).settings.agents).toEqual({
      ...agents,
      defaultModels: {},
      favoriteModels: {},
      hidden: [],
      hiddenModels: {},
      verified: {},
      autoVerify: true,
      env: {},
      adapterVersions: {},
    });
  });

  it('offers only signed-in, visible agents and their visible models, default model first', () => {
    const agents = loadSettings({
      version: 3,
      agents: {
        hidden: ['grok'],
        defaultModels: { opencode: 'b' },
        hiddenModels: { opencode: ['c'] },
        verified: {
          opencode: {
            status: 'ready',
            checkedAt: 1,
            models: [
              { value: 'a', name: 'A' },
              { value: 'b', name: 'B' },
              { value: 'c', name: 'C' },
            ],
          },
          grok: { status: 'ready', checkedAt: 1 },
          codex: { status: 'auth_required', checkedAt: 1 },
        },
      },
    }).settings.agents;
    expect(isPickableAgent(agents, 'opencode')).toBe(true);
    expect(isPickableAgent(agents, 'grok')).toBe(false);
    expect(isPickableAgent(agents, 'codex')).toBe(false);
    expect(isPickableAgent(agents, 'claude-code')).toBe(false);
    expect(visibleModels(agents, 'opencode').map((m) => m.value)).toEqual(['b', 'a']);
  });

  it('orders models: default, then favourites as starred, then the rest', () => {
    const models = ['a', 'b', 'c', 'd', 'e'].map((value) => ({ value, name: value.toUpperCase() }));
    const agents = loadSettings({
      version: 3,
      agents: {
        defaultModels: { x: 'd' },
        favoriteModels: { x: ['e', 'b', 'd'] },
        verified: { x: { status: 'ready', checkedAt: 1, models } },
      },
    }).settings.agents;
    expect(visibleModels(agents, 'x').map((m) => m.value)).toEqual(['d', 'e', 'b', 'a', 'c']);
  });

  it('merges agent patches: omitted fields stay, null clears the default agent', () => {
    const current = loadSettings({
      version: 3,
      agents: { defaultAgent: 'kimi', defaultModels: { opencode: 'opencode/beam-free' }, favoriteModels: {} },
    }).settings.agents;
    const starred = mergeAgentSettings(current, { favoriteModels: { opencode: ['opencode/beam-free'] } });
    expect(starred.defaultAgent).toBe('kimi');
    expect(starred.defaultModels).toEqual({ opencode: 'opencode/beam-free' });
    expect(starred.favoriteModels).toEqual({ opencode: ['opencode/beam-free'] });
    expect(mergeAgentSettings(starred, { defaultAgent: 'grok' }).defaultAgent).toBe('grok');
    expect('defaultAgent' in mergeAgentSettings(starred, { defaultAgent: null })).toBe(false);
  });

  it('resolves the default agent: project first, then the app setting, ignoring unknown ids', () => {
    const known = ['kimi', 'grok', 'opencode'];
    expect(resolveDefaultAgent(known, 'grok', 'kimi')).toBe('grok');
    expect(resolveDefaultAgent(known, undefined, 'kimi')).toBe('kimi');
    expect(resolveDefaultAgent(known, 'gone', 'kimi')).toBe('kimi');
    expect(resolveDefaultAgent(known, undefined, undefined)).toBeUndefined();
  });

  it('defaults per-project browser state fields', () => {
    const { settings } = loadSettings({
      version: 2,
      projects: { '/p': { browser: { lastUrl: 'http://localhost:5173/' } } },
    });
    expect(settings.projects['/p']?.browser).toEqual({
      lastUrl: 'http://localhost:5173/',
      preset: 'responsive',
      zoomFactor: 1,
    });
  });

  it('defaults editor settings for files written before Stage 7', () => {
    const { settings, warnings } = loadSettings({ version: 3, theme: 'dark' });
    expect(warnings).toEqual([]);
    expect(settings.editor).toEqual({ formatOnSave: true, eslintOnSave: true, tscOnSave: false, fontSize: 13 });
  });

  it('merges editor patches, leaving omitted fields alone', () => {
    const current = defaultSettings().editor;
    expect(mergeEditorSettings(current, { tscOnSave: true, formatOnSave: undefined })).toEqual({
      ...current,
      tscOnSave: true,
    });
  });
});

describe('addRecentProject', () => {
  it('moves an existing entry to the front and caps the list', () => {
    let recents = Array.from({ length: MAX_RECENT_PROJECTS }, (_, i) => ({
      path: `/p${i}`,
      name: `p${i}`,
      openedAt: i,
    }));
    recents = addRecentProject(recents, { path: '/p5', name: 'p5', openedAt: 100 });
    expect(recents[0]?.path).toBe('/p5');
    expect(recents.filter((r) => r.path === '/p5')).toHaveLength(1);
    recents = addRecentProject(recents, { path: '/new', name: 'new', openedAt: 101 });
    expect(recents).toHaveLength(MAX_RECENT_PROJECTS);
    expect(recents[0]?.path).toBe('/new');
  });
});

describe('Stage 9 settings', () => {
  it('defaults notifications, sounds, updates, diagnostics, onboarding and groups for older files', () => {
    const { settings, warnings } = loadSettings({ version: 3, theme: 'dark' });
    expect(warnings).toEqual([]);
    expect(settings.notifications).toMatchObject({ enabled: true, whenFocused: false, badge: true });
    expect(settings.sounds).toMatchObject({ enabled: true, volume: 60, finished: 'chime' });
    expect(settings.updates).toEqual({ channel: 'latest', autoCheck: true, autoDownload: true });
    expect(settings.diagnostics).toEqual({ logToFile: true, crashDumps: true });
    expect(settings.onboarding).toEqual({ completed: false, checkedChords: [] });
    expect(settings.projectGroups).toEqual([]);
    expect(settings.agents.env).toEqual({});
    expect(settings.agents.adapterVersions).toEqual({});
  });

  it('applies nested patches field by field', () => {
    const current = defaultSettings();
    const next = applySettingsPatch(current, {
      sounds: { volume: 20, enabled: undefined },
      notifications: { finished: false },
      updates: { channel: 'beta' },
      browser: { trustLocalhostCertificates: false },
      terminal: { fontSize: 15 },
      agents: { adapterVersions: { codex: 'latest' } },
      projectGroups: [{ id: 'work', name: 'Work', color: 'blue', collapsed: false }],
    });
    expect(next.sounds).toEqual({ ...current.sounds, volume: 20 });
    expect(next.notifications.finished).toBe(false);
    expect(next.updates.channel).toBe('beta');
    expect(next.browser).toEqual({ devToolsExtensions: true, trustLocalhostCertificates: false });
    expect(next.terminal.fontSize).toBe(15);
    expect(next.agents.adapterVersions).toEqual({ codex: 'latest' });
    expect(next.projectGroups).toHaveLength(1);
    expect(next.theme).toBe(current.theme);
  });

  it('parses patches without filling in the defaults of the fields left out', () => {
    expect(appSettingsPatchSchema.parse({ onboarding: { completed: true } })).toEqual({
      onboarding: { completed: true },
    });
    expect(appSettingsPatchSchema.parse({ sounds: { enabled: false } })).toEqual({ sounds: { enabled: false } });
    expect(appSettingsPatchSchema.parse({ editor: { formatOnSave: false } })).toEqual({
      editor: { formatOnSave: false },
    });
    const current = {
      ...defaultSettings(),
      onboarding: { completed: false, checkedChords: ['arbora.agentMode'] },
    };
    const next = applySettingsPatch(current, appSettingsPatchSchema.parse({ onboarding: { completed: true } }));
    expect(next.onboarding).toEqual({ completed: true, checkedChords: ['arbora.agentMode'] });
    expect(appSettingsPatchSchema.safeParse({ sounds: { volume: 500 } }).success).toBe(false);
  });

  it('rejects adapter versions that are not latest or semver', () => {
    expect(appSettingsPatchSchema.safeParse({ agents: { adapterVersions: { codex: '1.0; rm -rf' } } }).success).toBe(
      false,
    );
  });

  it('turns null project patches into removals', () => {
    expect(projectSettingsUpdates({ devCommand: 'pnpm dev', devUrl: null })).toEqual({
      devCommand: 'pnpm dev',
      devUrl: undefined,
    });
  });
});
