import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appSettingsMigrations,
  appSettingsSchema,
  APP_SETTINGS_VERSION,
  type AppSettings,
} from '@arbora/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VersionedJsonFile } from './json-file';

describe('VersionedJsonFile', () => {
  let dir: string;
  let file: VersionedJsonFile<AppSettings>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbora-json-'));
    file = new VersionedJsonFile({
      path: join(dir, 'nested', 'settings.json'),
      version: APP_SETTINGS_VERSION,
      schema: appSettingsSchema,
      migrations: appSettingsMigrations,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns defaults when the file is missing', () => {
    expect(file.load()).toEqual({
      status: 'missing',
      writable: true,
      value: { version: 1, theme: 'system', keybindings: {}, terminalPassthrough: true },
    });
  });

  it('writes atomically, creating directories, and reads back', async () => {
    const settings = appSettingsSchema.parse({ theme: 'dark' });
    await file.write(settings);
    const text = readFileSync(file.path, 'utf8');
    expect(JSON.parse(text)).toEqual(settings);
    expect(file.isOwnWrite(text)).toBe(true);
    expect(file.load()).toMatchObject({ status: 'current', value: { theme: 'dark' } });
  });

  it('migrates unversioned files', async () => {
    await file.write({ theme: 'light' } as AppSettings);
    expect(file.load()).toMatchObject({
      status: 'migrated',
      writable: true,
      value: { version: 1, theme: 'light' },
    });
  });

  it('refuses to overwrite files from a newer version or with syntax errors', async () => {
    await file.write({ version: 99 } as unknown as AppSettings);
    expect(file.load()).toMatchObject({ status: 'too-new', writable: false });

    writeFileSync(file.path, '{ "theme": "dark", ');
    expect(file.load()).toMatchObject({
      status: 'invalid-json',
      writable: false,
      value: { theme: 'system' },
    });
  });

  it('serialises concurrent writes so the last one wins', async () => {
    await Promise.all([
      file.write(appSettingsSchema.parse({ theme: 'dark' })),
      file.write(appSettingsSchema.parse({ theme: 'light' })),
    ]);
    expect(file.load().value.theme).toBe('light');
  });
});
