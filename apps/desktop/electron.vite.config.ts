import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Production builds get a strict CSP meta tag. The dev server needs inline scripts and websockets
 * for React Fast Refresh and HMR, so the tag is only injected at build time.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'arbora-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig(({ mode }) => {
  const minify = mode === 'production';
  return {
    main: {
      build: {
        minify,
        // Workspace packages ship TypeScript sources and must be bundled, not required at runtime.
        externalizeDeps: { exclude: ['@arbora/shared'] },
        rolldownOptions: {
          input: { index: resolve(import.meta.dirname, 'src/main/index.ts') },
        },
      },
    },
    preload: {
      build: {
        minify,
        // Sandboxed preloads cannot require node_modules: bundle everything, one file per entry.
        externalizeDeps: false,
        isolatedEntries: true,
        rolldownOptions: {
          input: {
            index: resolve(import.meta.dirname, 'src/preload/index.ts'),
            browser: resolve(import.meta.dirname, 'src/preload/browser.ts'),
          },
          output: {
            format: 'cjs',
            entryFileNames: '[name].cjs',
          },
        },
      },
    },
    renderer: {
      plugins: [react(), tailwindcss(), contentSecurityPolicy()],
      build: { minify },
    },
  };
});
