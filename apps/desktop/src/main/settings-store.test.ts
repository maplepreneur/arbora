import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { defaultSettings, SETTINGS_VERSION } from '@arbora/shared';
import { ensureProjectSettingsFile, projectSettingsPath, readProjectSettings } from './project-settings.js';
import { SettingsStore } from './settings-store.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbora-settings-'));
}

describe('SettingsStore', () => {
  it('starts from defaults without creating the file', () => {
    const file = join(tempDir(), 'settings.json');
    const store = new SettingsStore(file);
    expect(store.get()).toEqual(defaultSettings());
    expect(existsSync(file)).toBe(false);
  });

  it('persists updates and notifies listeners', () => {
    const file = join(tempDir(), 'settings.json');
    const store = new SettingsStore(file);
    const listener = vi.fn();
    store.onChange(listener);
    store.update((s) => ({ ...s, theme: 'dark' }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ version: SETTINGS_VERSION, theme: 'dark' });
    expect(new SettingsStore(file).get().theme).toBe('dark');
  });

  it('migrates an unversioned file on load', () => {
    const file = join(tempDir(), 'settings.json');
    writeFileSync(file, JSON.stringify({ theme: 'light', terminalPassthrough: false }));
    const store = new SettingsStore(file);
    expect(store.get()).toMatchObject({ version: SETTINGS_VERSION, theme: 'light', terminalPassthrough: false });
  });

  it('backs up an unreadable file instead of overwriting it', () => {
    const dir = tempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, '{ not json');
    const store = new SettingsStore(file);
    expect(store.get()).toEqual(defaultSettings());
    expect(store.warnings[0]).toMatch(/reset to defaults/);
    expect(readdirSync(dir).some((name) => name.endsWith('.bak'))).toBe(true);
  });

  it('reloads hand edits and ignores its own writes', () => {
    const file = join(tempDir(), 'settings.json');
    const store = new SettingsStore(file);
    store.update((s) => ({ ...s, theme: 'dark' }));
    const listener = vi.fn();
    store.onChange(listener);
    store.reloadFromDisk();
    expect(listener).not.toHaveBeenCalled();

    writeFileSync(file, JSON.stringify({ version: 1, keybindings: { 'arbora.agentMode': 'mod+i' } }));
    store.reloadFromDisk();
    expect(listener).toHaveBeenCalledOnce();
    expect(store.get().keybindings).toEqual({ 'arbora.agentMode': 'mod+i' });
    expect(store.get().theme).toBe('system');

    writeFileSync(file, '{ "version": 1, ');
    store.reloadFromDisk();
    expect(store.get().keybindings).toEqual({ 'arbora.agentMode': 'mod+i' });
    expect(store.warnings[0]).toMatch(/could not be read/);
  });

  it('keeps a hand edit that lands before the watcher reloads it', () => {
    const file = join(tempDir(), 'settings.json');
    const store = new SettingsStore(file);
    store.update((s) => ({ ...s, theme: 'dark' }));
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const edited = { ...onDisk, keybindings: { 'arbora.agentMode': 'mod+i' } };
    writeFileSync(file, JSON.stringify(edited));
    store.update((s) => ({ ...s, terminalPassthrough: false }));
    expect(store.get()).toMatchObject({ keybindings: { 'arbora.agentMode': 'mod+i' }, terminalPassthrough: false });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ keybindings: { 'arbora.agentMode': 'mod+i' } });
  });
});

describe('project settings', () => {
  it('defaults when .arbora/project.json is missing and creates it on demand', () => {
    const project = tempDir();
    expect(readProjectSettings(project)).toEqual({ settings: { version: 1 }, warnings: [] });
    const file = ensureProjectSettingsFile(project);
    expect(file).toBe(projectSettingsPath(project));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1 });
  });

  it('reads valid settings and reports invalid ones', () => {
    const project = tempDir();
    const file = ensureProjectSettingsFile(project);
    writeFileSync(file, JSON.stringify({ devCommand: 'pnpm dev', keybindings: { 'arbora.designMode': null } }));
    expect(readProjectSettings(project).settings).toEqual({
      version: 1,
      devCommand: 'pnpm dev',
      keybindings: { 'arbora.designMode': null },
    });
    writeFileSync(file, JSON.stringify({ devCommand: 42 }));
    const invalid = readProjectSettings(project);
    expect(invalid.settings).toEqual({ version: 1 });
    expect(invalid.warnings[0]).toMatch(/invalid/);
  });
});
