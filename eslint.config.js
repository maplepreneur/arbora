// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Inline `import()` is banned except for documented lazy boundaries: `React.lazy(() => import(...))`
 * panel entries and modules under `src/main/lazy/`.
 */
const noInlineImports = {
  selector: "ImportExpression:not(CallExpression[callee.name='lazy'] > ArrowFunctionExpression > ImportExpression)",
  message:
    'Inline import() is only allowed in React.lazy panel entries and src/main/lazy/. Import at the top of the file.',
};

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/out-*/**',
      '**/dist/**',
      '**/test-results/**',
      '**/playwright-report/**',
      'fixtures/plain-html/app.js',
      // Framework fixtures type-check only against types `next dev` / `nuxt dev` generate.
      'fixtures/next/**',
      'fixtures/nuxt/**',
      '**/.next/**',
      '**/.nuxt/**',
      '**/.output/**',
      'apps/desktop/resources/extensions/*/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({ alwaysTryTypes: true, noWarnOnMultipleProjects: true }),
      ],
    },
    rules: {
      'no-restricted-syntax': ['error', noInlineImports],
      'import-x/no-cycle': ['error', { ignoreExternal: true }],
      'import-x/first': 'error',
      'import-x/no-duplicates': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/src/main/lazy/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}', 'fixtures/vite-react/src/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}', 'fixtures/vite-react/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    rules: {
      // The renderer must never talk to Electron directly; it goes through window.arbora.
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'electron', message: 'Use window.arbora (packages/shared channels).' }] },
      ],
    },
  },
  {
    files: [
      'apps/desktop/src/main/**',
      'apps/desktop/src/preload/**',
      'apps/desktop/e2e/**',
      '**/*.config.{js,ts}',
      'fixtures/plain-html/server.mjs',
      'apps/desktop/scripts/**',
      'scripts/*.mjs',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: [
      'fixtures/plain-html/server.mjs',
      'fixtures/plain-html/*.config.js',
      'apps/desktop/scripts/**',
      'scripts/*.mjs',
      'packages/dev-plugin/**/*.mjs',
    ],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['packages/dev-plugin/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/desktop/scripts/**', 'scripts/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['fixtures/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.test.ts', 'apps/desktop/e2e/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
);
