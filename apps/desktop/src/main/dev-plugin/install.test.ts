import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { devPluginStatus, findDevPluginRoot, installDevPlugin } from './install.js';

const pluginRoot = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../../packages/dev-plugin');

describe('installDevPlugin', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  function project(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'arbora-dev-plugin-'));
    roots.push(root);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
    return root;
  }

  it('copies the plugin, wires Vite and runs the package manager', async () => {
    const root = project({
      'package.json': '{\n  "name": "app",\n  "devDependencies": {\n    "vite": "6.0.0"\n  }\n}\n',
      'pnpm-lock.yaml': '',
      'vite.config.ts': "import { defineConfig } from 'vite';\n\nexport default defineConfig({\n  plugins: [],\n});\n",
    });
    const commands: string[] = [];
    const result = await installDevPlugin({
      projectPath: root,
      pluginRoot,
      platform: 'linux',
      run: (command, args) => {
        commands.push(`${command} ${args.join(' ')}`);
        return Promise.resolve();
      },
    });
    expect(result).toMatchObject({ ok: true, bundler: 'vite' });
    expect(commands).toEqual(['pnpm install']);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain(
      '"@arbora/dev-plugin": "file:.arbora/dev-plugin"',
    );
    expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).toContain('arboraDevPlugin()');
    expect(existsSync(join(root, '.arbora/dev-plugin/src/core.mjs'))).toBe(true);
    expect(readFileSync(join(root, '.arbora/.gitignore'), 'utf8')).toContain('!dev-plugin/');
    expect(devPluginStatus(root)).toEqual({ bundler: 'vite', installed: true });
  });

  it('does nothing when the plugin is already wired', async () => {
    const root = project({
      'package.json':
        '{\n  "devDependencies": {\n    "vite": "6.0.0",\n    "@arbora/dev-plugin": "file:.arbora/dev-plugin"\n  }\n}\n',
      'vite.config.ts':
        "import { arboraDevPlugin } from '@arbora/dev-plugin';\nexport default { plugins: [arboraDevPlugin()] };\n",
    });
    let ran = false;
    const result = await installDevPlugin({
      projectPath: root,
      pluginRoot,
      platform: 'linux',
      run: () => {
        ran = true;
        return Promise.resolve();
      },
    });
    expect(result.ok).toBe(true);
    expect(ran).toBe(false);
    expect(devPluginStatus(root).installed).toBe(true);
  });

  it('refuses a project that is not Vite, Next or Nuxt', async () => {
    const root = project({ 'package.json': '{ "name": "app" }\n' });
    const result = await installDevPlugin({
      projectPath: root,
      pluginRoot,
      platform: 'linux',
      run: () => Promise.resolve(),
    });
    expect(result).toMatchObject({ ok: false, bundler: null });
    expect(devPluginStatus(root).bundler).toBeNull();
  });

  it('reports a config it cannot edit', async () => {
    const root = project({
      'package.json': '{ "devDependencies": { "vite": "6.0.0" } }\n',
      'vite.config.ts': 'module.exports = require("./vite.base")\n',
    });
    const result = await installDevPlugin({
      projectPath: root,
      pluginRoot,
      platform: 'linux',
      run: () => Promise.resolve(),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('arboraDevPlugin()');
    expect(devPluginStatus(root).installed).toBe(false);
  });
});

describe('findDevPluginRoot', () => {
  it('finds the workspace package by walking up', () => {
    const start = fileURLToPath(new URL('.', import.meta.url));
    expect(findDevPluginRoot([start])).toBe(pluginRoot);
  });
});
