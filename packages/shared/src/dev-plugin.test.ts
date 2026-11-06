import { describe, expect, it } from 'vitest';
import {
  addDevPluginDependency,
  detectDevPluginBundler,
  freshDevPluginConfig,
  patchDevPluginConfig,
} from './dev-plugin.js';

describe('detectDevPluginBundler', () => {
  it('prefers Nuxt, then Next, then Vite', () => {
    expect(detectDevPluginBundler({ dependencies: { nuxt: '3', vite: '6' } })).toBe('nuxt');
    expect(detectDevPluginBundler({ dependencies: { next: '15', vite: '6' } })).toBe('next');
    expect(detectDevPluginBundler({ devDependencies: { vite: '6' } })).toBe('vite');
    expect(detectDevPluginBundler({})).toBeNull();
  });
});

describe('addDevPluginDependency', () => {
  it('inserts the file dependency and leaves an existing one', () => {
    const added = addDevPluginDependency('{\n  "name": "app"\n}\n');
    expect(added.changed).toBe(true);
    expect(added.source).toContain('"@arbora/dev-plugin": "file:.arbora/dev-plugin"');
    expect(JSON.parse(added.source)).toMatchObject({
      name: 'app',
      devDependencies: { '@arbora/dev-plugin': 'file:.arbora/dev-plugin' },
    });
    expect(addDevPluginDependency(added.source).changed).toBe(false);
  });

  it('prepends to an existing devDependencies object', () => {
    const source = '{\n  "devDependencies": {\n    "vite": "6.0.0"\n  }\n}\n';
    const added = addDevPluginDependency(source);
    expect(added.source).toContain('"@arbora/dev-plugin": "file:.arbora/dev-plugin",');
    expect(added.source).toContain('"vite": "6.0.0"');
  });
});

describe('patchDevPluginConfig', () => {
  it('registers the Vite plugin at the front of plugins', () => {
    const source = `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n});\n`;
    const patched = patchDevPluginConfig(source, 'vite');
    expect(patched.status).toBe('patched');
    if (patched.status !== 'patched') return;
    expect(patched.source).toContain("import { arboraDevPlugin } from '@arbora/dev-plugin';");
    expect(patched.source).toContain('plugins: [arboraDevPlugin(), react()]');
    expect(patchDevPluginConfig(patched.source, 'vite').status).toBe('unchanged');
  });

  it('adds a plugins array when the Vite config has none', () => {
    const patched = patchDevPluginConfig(`export default {\n  server: { port: 5173 },\n};\n`, 'vite');
    expect(patched.status).toBe('patched');
    if (patched.status !== 'patched') return;
    expect(patched.source).toContain('plugins: [arboraDevPlugin()],');
  });

  it('wraps a Next config export', () => {
    const source = `import type { NextConfig } from 'next';\n\nconst nextConfig: NextConfig = { reactStrictMode: true };\n\nexport default nextConfig;\n`;
    const patched = patchDevPluginConfig(source, 'next');
    expect(patched.status).toBe('patched');
    if (patched.status !== 'patched') return;
    expect(patched.source).toContain("import { withArbora } from '@arbora/dev-plugin/next';");
    expect(patched.source).toContain('export default withArbora(nextConfig);');
  });

  it('wraps an inline Next object export', () => {
    const patched = patchDevPluginConfig(`export default {\n  reactStrictMode: true,\n};\n`, 'next');
    expect(patched.status).toBe('patched');
    if (patched.status !== 'patched') return;
    expect(patched.source).toContain('export default withArbora({\n  reactStrictMode: true,\n});');
  });

  it('prepends the Nuxt module', () => {
    const source = `export default defineNuxtConfig({\n  modules: ['@nuxt/eslint'],\n});\n`;
    const patched = patchDevPluginConfig(source, 'nuxt');
    expect(patched.status).toBe('patched');
    if (patched.status !== 'patched') return;
    expect(patched.source).toContain("modules: ['@arbora/dev-plugin/nuxt', '@nuxt/eslint']");
    expect(patchDevPluginConfig(patched.source, 'nuxt').status).toBe('unchanged');
  });

  it('refuses a config it cannot see a place to edit', () => {
    expect(patchDevPluginConfig('module.exports = require("./vite.base")\n', 'vite').status).toBe('unsupported');
  });
});

describe('freshDevPluginConfig', () => {
  it('names a file the bundler will load', () => {
    expect(freshDevPluginConfig('vite').name).toBe('vite.config.ts');
    expect(freshDevPluginConfig('vite').source).toContain('arboraDevPlugin()');
    expect(freshDevPluginConfig('nuxt').source).toContain('@arbora/dev-plugin/nuxt');
  });
});
