import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Dynamic `import()` is only allowed at documented lazy boundaries. */
const LAZY_BOUNDARIES = ['apps/desktop/src/main/lazy/**', 'apps/desktop/src/renderer/src/lazy.ts'];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '.tsbuild/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  importX.flatConfigs.typescript,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver({ alwaysTryTypes: true })],
    },
    rules: {
      'import-x/no-cycle': 'error',
      'import-x/first': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message:
            'Inline import() is only allowed in documented lazy boundaries (src/main/lazy/, renderer lazy.ts).',
        },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': 'off',
    },
  },
  {
    // Plain JavaScript (configs, the static fixture server) has no type information.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: LAZY_BOUNDARIES,
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}', 'fixtures/vite-react/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'The renderer talks to main only via window.arbora.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.config.ts', 'apps/desktop/src/main/**', 'apps/desktop/e2e/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  prettier,
);
