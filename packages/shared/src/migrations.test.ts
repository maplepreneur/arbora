import { describe, expect, it } from 'vitest';
import { runMigrations, type MigrationTable } from './migrations';
import {
  addRecentProject,
  appSettingsMigrations,
  appSettingsSchema,
  APP_SETTINGS_VERSION,
  MAX_RECENT_PROJECTS,
  projectSettingsSchema,
} from './settings';

const table: MigrationTable = {
  0: (doc) => ({ ...doc, theme: doc.darkMode === true ? 'dark' : 'light', darkMode: undefined }),
  1: (doc) => ({ ...doc, keybindings: doc.shortcuts ?? {}, shortcuts: undefined }),
};

describe('runMigrations', () => {
  it('runs every step from an unversioned document to the current version', () => {
    const result = runMigrations({ darkMode: true, shortcuts: { a: 'mod+a' } }, 2, table);
    expect(result).toEqual({
      kind: 'migrated',
      from: 0,
      doc: {
        version: 2,
        theme: 'dark',
        darkMode: undefined,
        keybindings: { a: 'mod+a' },
        shortcuts: undefined,
      },
    });
  });

  it('starts from the stored version', () => {
    const result = runMigrations({ version: 1, shortcuts: { b: 'mod+b' } }, 2, table);
    expect(result.kind).toBe('migrated');
    expect(result.kind === 'migrated' && result.from).toBe(1);
    expect(result.kind === 'migrated' && result.doc.keybindings).toEqual({ b: 'mod+b' });
  });

  it('leaves current documents alone and flags newer ones', () => {
    expect(runMigrations({ version: 2, x: 1 }, 2, table)).toEqual({
      kind: 'current',
      doc: { version: 2, x: 1 },
    });
    expect(runMigrations({ version: 3 }, 2, table)).toEqual({ kind: 'too-new', version: 3 });
  });

  it('treats non-object input as an empty unversioned document', () => {
    expect(runMigrations('garbage', 1, { 0: (doc) => doc })).toEqual({
      kind: 'migrated',
      from: 0,
      doc: { version: 1 },
    });
  });

  it('fails loudly when a step is missing', () => {
    expect(() => runMigrations({}, 2, { 0: (doc) => doc })).toThrow(/from version 1 to 2/);
  });
});

describe('app settings', () => {
  it('migrates an unversioned file and fills defaults', () => {
    const result = runMigrations({ theme: 'dark' }, APP_SETTINGS_VERSION, appSettingsMigrations);
    expect(result.kind).toBe('migrated');
    const settings = appSettingsSchema.parse(result.kind === 'migrated' ? result.doc : {});
    expect(settings).toEqual({
      version: 1,
      theme: 'dark',
      keybindings: {},
      terminalPassthrough: true,
    });
  });

  it('resets invalid fields individually', () => {
    const settings = appSettingsSchema.parse({
      version: 1,
      theme: 'sepia',
      keybindings: { 'arbora.agentMode': 'mod+shift+k' },
      terminalPassthrough: 'yes',
    });
    expect(settings.theme).toBe('system');
    expect(settings.terminalPassthrough).toBe(true);
    expect(settings.keybindings).toEqual({ 'arbora.agentMode': 'mod+shift+k' });
  });

  it('keeps project settings optional fields optional', () => {
    expect(projectSettingsSchema.parse({})).toEqual({ version: 1, keybindings: {} });
    expect(projectSettingsSchema.parse({ devCommand: 'pnpm dev', devUrl: 42 })).toEqual({
      version: 1,
      devCommand: 'pnpm dev',
      keybindings: {},
    });
  });
});

describe('addRecentProject', () => {
  it('moves re-opened projects to the front and caps the list', () => {
    let recents = Array.from({ length: MAX_RECENT_PROJECTS }, (_, index) => ({
      path: `/p/${index}`,
      name: `p${index}`,
      lastOpenedAt: index,
    }));
    recents = addRecentProject(recents, { path: '/p/5', name: 'p5', lastOpenedAt: 100 });
    expect(recents[0]).toEqual({ path: '/p/5', name: 'p5', lastOpenedAt: 100 });
    expect(recents).toHaveLength(MAX_RECENT_PROJECTS);

    recents = addRecentProject(recents, { path: '/new', name: 'new', lastOpenedAt: 101 });
    expect(recents).toHaveLength(MAX_RECENT_PROJECTS);
    expect(recents[0]?.path).toBe('/new');
    expect(recents.some((recent) => recent.path === '/p/9')).toBe(false);
  });
});
