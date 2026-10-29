import { describe, expect, it } from 'vitest';
import {
  addRecentProject,
  defaultSettings,
  loadSettings,
  MAX_RECENT_PROJECTS,
  migrateSettings,
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
    expect(() => migrateSettings({ version: 1 }, { 0: (s) => ({ ...s, version: 1 }) }, 2)).toThrow(/No settings migration/);
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
    const projects = { '/p': { layout: { groups: { main: { browser: 70, agent: 30 } }, sidebarView: 'git', bottomTab: 'problems' } } };
    expect(loadSettings({ version: 1, projects }).settings.projects).toEqual(projects);
  });
});

describe('addRecentProject', () => {
  it('moves an existing entry to the front and caps the list', () => {
    let recents = Array.from({ length: MAX_RECENT_PROJECTS }, (_, i) => ({ path: `/p${i}`, name: `p${i}`, openedAt: i }));
    recents = addRecentProject(recents, { path: '/p5', name: 'p5', openedAt: 100 });
    expect(recents[0]?.path).toBe('/p5');
    expect(recents.filter((r) => r.path === '/p5')).toHaveLength(1);
    recents = addRecentProject(recents, { path: '/new', name: 'new', openedAt: 101 });
    expect(recents).toHaveLength(MAX_RECENT_PROJECTS);
    expect(recents[0]?.path).toBe('/new');
  });
});
