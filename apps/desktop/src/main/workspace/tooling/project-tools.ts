import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnostic } from '@arbora/shared';
import { importProjectModule } from '../../lazy/project-modules.js';
import { detectEslintConfig, eslintDiagnostics, type EslintMessage } from './diagnostics.js';

/**
 * The format and lint steps, run inside the tooling utility process with the project as cwd so the
 * project's own Prettier, ESLint and their plugins resolve exactly as on the command line.
 */

interface PrettierModule {
  format(source: string, options: Record<string, unknown>): Promise<string>;
  resolveConfig(file: string, options?: { editorconfig?: boolean }): Promise<Record<string, unknown> | null>;
  getFileInfo(
    file: string,
    options?: { ignorePath?: string | string[]; resolveConfig?: boolean },
  ): Promise<{ ignored: boolean; inferredParser: string | null }>;
}

interface EslintInstance {
  isPathIgnored(file: string): Promise<boolean>;
  lintText(code: string, options: { filePath: string }): Promise<{ messages: EslintMessage[] }[]>;
}

type EslintConstructor = new (options: { cwd: string }) => EslintInstance;

interface EslintModule {
  ESLint?: EslintConstructor;
  loadESLint?: (options: { useFlatConfig: boolean; cwd?: string }) => Promise<EslintConstructor>;
  default?: EslintModule;
}

/** Formatted text, or null when the project has no Prettier or Prettier skips this file. */
export async function formatWithProject(root: string, file: string, content: string): Promise<string | null> {
  const loaded = await importProjectModule<PrettierModule & { default?: PrettierModule }>(root, 'prettier');
  if (!loaded) return null;
  const prettier = typeof loaded.format === 'function' ? loaded : loaded.default;
  if (!prettier) return null;
  const absolute = join(root, file);
  const info = await prettier.getFileInfo(absolute, { ignorePath: join(root, '.prettierignore'), resolveConfig: true });
  if (info.ignored || !info.inferredParser) return null;
  const options = (await prettier.resolveConfig(absolute, { editorconfig: true })) ?? {};
  return prettier.format(content, { ...options, filepath: absolute });
}

let cachedEslint: { key: string; instance: EslintInstance } | null = null;

/** ESLint diagnostics for `content` as `file`, or null when the project has no ESLint or config. */
export async function lintWithProject(root: string, file: string, content: string): Promise<Diagnostic[] | null> {
  const config = detectEslintConfig(root);
  if (!config) return null;
  const key = `${root}|${config.file}|${statSync(config.file).mtimeMs}`;
  let instance = cachedEslint?.key === key ? cachedEslint.instance : null;
  if (!instance) {
    // ESLint 8.x reads this to choose between flat and legacy configs.
    process.env['ESLINT_USE_FLAT_CONFIG'] = config.kind === 'flat' ? 'true' : 'false';
    const loaded = await importProjectModule<EslintModule>(root, 'eslint');
    if (!loaded) return null;
    const eslint = loaded.ESLint || loaded.loadESLint ? loaded : (loaded.default ?? loaded);
    const Ctor = eslint.loadESLint
      ? await eslint.loadESLint({ useFlatConfig: config.kind === 'flat', cwd: root })
      : eslint.ESLint;
    if (!Ctor) return null;
    instance = new Ctor({ cwd: root });
    cachedEslint = { key, instance };
  }
  const absolute = join(root, file);
  if (await instance.isPathIgnored(absolute)) return [];
  const [result] = await instance.lintText(content, { filePath: absolute });
  return eslintDiagnostics(file, result?.messages ?? []);
}
