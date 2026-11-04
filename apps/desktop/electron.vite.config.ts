import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/** Workspace packages export TypeScript source, so they must be bundled rather than externalised. */
const WORKSPACE_PACKAGES = [
  '@arbora/shared',
  '@arbora/acp-client',
  '@arbora/browser-bridge',
  '@arbora/mcp-browser-server',
];

export default defineConfig(({ mode }) => {
  const testBuild = mode === 'test';
  return {
    main: {
      // Only release.yml sets this. Local `pnpm package` builds never update themselves (updatePolicy).
      define: { __ARBORA_RELEASE_BUILD__: JSON.stringify(process.env['ARBORA_RELEASE_BUILD'] === 'true') },
      build: {
        externalizeDeps: { exclude: WORKSPACE_PACKAGES },
        minify: false,
        sourcemap: testBuild,
        rolldownOptions: {
          input: {
            index: resolve(import.meta.dirname, 'src/main/index.ts'),
            // Run by agents without HTTP MCP as `<arbora> mcp-shim.js <url>` (ELECTRON_RUN_AS_NODE=1).
            'mcp-shim': resolve(import.meta.dirname, '../../packages/mcp-browser-server/src/shim-main.ts'),
            // Runs the project's Prettier and ESLint in a utility process (Stage 7).
            'tooling-worker': resolve(import.meta.dirname, 'src/main/workspace/tooling/worker.ts'),
          },
        },
      },
    },
    preload: {
      build: {
        // Sandboxed preloads cannot require() anything but electron, so bundle every dependency
        // and emit standalone CommonJS files.
        externalizeDeps: false,
        isolatedEntries: true,
        minify: false,
        sourcemap: testBuild,
        rolldownOptions: {
          external: ['electron'],
          input: {
            index: resolve(import.meta.dirname, 'src/preload/index.ts'),
            browser: resolve(import.meta.dirname, 'src/preload/browser.ts'),
          },
          output: { format: 'cjs', entryFileNames: '[name].cjs' },
        },
      },
    },
    renderer: {
      root: resolve(import.meta.dirname, 'src/renderer'),
      plugins: [react(), tailwindcss()],
      build: {
        minify: !testBuild,
        sourcemap: testBuild,
        rolldownOptions: {
          input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') },
        },
      },
    },
  };
});
