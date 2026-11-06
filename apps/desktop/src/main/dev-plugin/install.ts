import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  addDevPluginDependency,
  detectDevPluginBundler,
  detectPackageManager,
  devPluginConfigNames,
  DEV_PLUGIN_PACKAGE,
  freshDevPluginConfig,
  lockfileNames,
  patchDevPluginConfig,
  type DevPluginBundler,
  type PackageManager,
} from '@arbora/shared';
import { ensureArboraGitignore } from '../project-settings.js';

const PLUGIN_FILES = [
  'package.json',
  'src/core.mjs',
  'src/core.d.mts',
  'src/nuxt.mjs',
  'src/nuxt.d.mts',
  'src/webpack.mjs',
  'src/webpack.d.mts',
] as const;

const GITIGNORE_LINES = ['!dev-plugin/', '!dev-plugin/**'] as const;

export interface DevPluginStatus {
  readonly bundler: DevPluginBundler | null;
  readonly installed: boolean;
}

export interface InstallDevPluginResult {
  readonly ok: boolean;
  readonly bundler: DevPluginBundler | null;
  readonly message: string;
}

export interface InstallDevPluginOptions {
  readonly projectPath: string;
  readonly pluginRoot: string;
  readonly platform: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Replaces the package-manager install. Tests pass this. */
  readonly run?: ((command: string, args: readonly string[], cwd: string) => Promise<void>) | undefined;
}

interface PackageFile {
  readonly text: string;
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  readonly packageManagerField: string | undefined;
}

export function devPluginStatus(projectPath: string): DevPluginStatus {
  const pkg = readPackage(projectPath);
  if (!pkg) return { bundler: null, installed: false };
  const bundler = detectDevPluginBundler(pkg);
  if (!bundler) return { bundler: null, installed: false };
  return { bundler, installed: packageLinksPlugin(pkg.text) && configLinksPlugin(projectPath, bundler) };
}

export async function installDevPlugin(options: InstallDevPluginOptions): Promise<InstallDevPluginResult> {
  const pkg = readPackage(options.projectPath);
  if (!pkg) return { ok: false, bundler: null, message: 'This folder has no package.json' };
  const bundler = detectDevPluginBundler(pkg);
  if (!bundler) {
    return { ok: false, bundler: null, message: 'The dev plugin supports Vite, Next and Nuxt projects' };
  }
  if (packageLinksPlugin(pkg.text) && configLinksPlugin(options.projectPath, bundler)) {
    return {
      ok: true,
      bundler,
      message: 'Dev plugin is already installed. Restart the dev server if locations are still approximate.',
    };
  }
  await copyPlugin(options.pluginRoot, options.projectPath);
  allowDevPlugin(options.projectPath);
  if (!packageLinksPlugin(pkg.text)) {
    const added = addDevPluginDependency(pkg.text);
    writeFileSync(join(options.projectPath, 'package.json'), added.source);
  }
  const config = applyConfig(options.projectPath, bundler);
  if (config === 'unsupported') {
    return { ok: false, bundler, message: manualHint(bundler) };
  }
  const manager = detectPackageManager({
    packageManagerField: pkg.packageManagerField,
    lockfiles: lockfileNames().filter((name) => existsSync(join(options.projectPath, name))),
  });
  try {
    await (options.run ?? defaultRun(options.platform, options.env ?? process.env))(
      packageManagerBin(manager, options.platform),
      ['install'],
      options.projectPath,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'package install failed';
    return { ok: false, bundler, message: `The plugin files are in place, but install failed: ${detail}` };
  }
  return {
    ok: true,
    bundler,
    message: 'Dev plugin installed. Restart the dev server, then select the element again.',
  };
}

/** Walks up from each start until `packages/dev-plugin/package.json` exists. */
export function findDevPluginRoot(starts: readonly string[]): string | null {
  for (const start of starts) {
    let dir = start;
    for (let depth = 0; depth < 8; depth += 1) {
      const candidate = join(dir, 'packages/dev-plugin/package.json');
      if (existsSync(candidate)) return join(dir, 'packages/dev-plugin');
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

export function packageManagerBin(manager: PackageManager, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${manager}.cmd` : manager;
}

function defaultRun(platform: NodeJS.Platform, env: NodeJS.ProcessEnv) {
  return (command: string, args: readonly string[], cwd: string): Promise<void> =>
    runPackageInstall(command, args, cwd, platform, env);
}

function runPackageInstall(
  command: string,
  args: readonly string[],
  cwd: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-1500);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} install timed out`));
    }, 120_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} install exited ${String(code)}`));
    });
  });
}

function readPackage(projectPath: string): PackageFile | null {
  const file = join(projectPath, 'package.json');
  if (!existsSync(file)) return null;
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as {
    dependencies?: unknown;
    devDependencies?: unknown;
    packageManager?: unknown;
  };
  return {
    text,
    dependencies: stringRecord(record.dependencies),
    devDependencies: stringRecord(record.devDependencies),
    packageManagerField: typeof record.packageManager === 'string' ? record.packageManager : undefined,
  };
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

function packageLinksPlugin(packageJson: string): boolean {
  return packageJson.includes(`"${DEV_PLUGIN_PACKAGE}"`);
}

function configLinksPlugin(projectPath: string, kind: DevPluginBundler): boolean {
  for (const name of devPluginConfigNames(kind)) {
    const file = join(projectPath, name);
    if (!existsSync(file)) continue;
    try {
      const text = readFileSync(file, 'utf8');
      if (text.includes(DEV_PLUGIN_PACKAGE) || text.includes('arboraDevPlugin') || text.includes('withArbora'))
        return true;
    } catch {
      continue;
    }
  }
  return false;
}

/** `'unsupported'` when a config file exists but cannot be edited. */
function applyConfig(projectPath: string, kind: DevPluginBundler): 'patched' | 'unsupported' {
  for (const name of devPluginConfigNames(kind)) {
    const file = join(projectPath, name);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const patched = patchDevPluginConfig(text, kind);
    switch (patched.status) {
      case 'unchanged':
        return 'patched';
      case 'patched':
        writeFileSync(file, patched.source);
        return 'patched';
      case 'unsupported':
        return 'unsupported';
      default: {
        const neverStatus: never = patched;
        return neverStatus;
      }
    }
  }
  const fresh = freshDevPluginConfig(kind);
  writeFileSync(join(projectPath, fresh.name), fresh.source);
  return 'patched';
}

async function copyPlugin(pluginRoot: string, projectPath: string): Promise<void> {
  const destRoot = join(projectPath, '.arbora', 'dev-plugin');
  for (const relative of PLUGIN_FILES) {
    const from = join(pluginRoot, relative);
    if (!existsSync(from)) throw new Error(`Dev plugin is missing ${relative}`);
    const dest = join(destRoot, relative);
    mkdirSync(dirname(dest), { recursive: true });
    await cp(from, dest);
  }
}

function allowDevPlugin(projectPath: string): void {
  ensureArboraGitignore(projectPath, true);
  const file = join(projectPath, '.arbora', '.gitignore');
  const text = readFileSync(file, 'utf8');
  const missing = GITIGNORE_LINES.filter((line) => !text.includes(line));
  if (missing.length === 0) return;
  const suffix = text.endsWith('\n') ? '' : '\n';
  writeFileSync(file, `${text}${suffix}${missing.join('\n')}\n`);
}

function manualHint(kind: DevPluginBundler): string {
  switch (kind) {
    case 'vite':
      return "Add arboraDevPlugin() from '@arbora/dev-plugin' to the Vite plugins list, then restart the dev server.";
    case 'next':
      return "Wrap the Next config with withArbora() from '@arbora/dev-plugin/next', then restart the dev server.";
    case 'nuxt':
      return "Add '@arbora/dev-plugin/nuxt' to modules in nuxt.config, then restart the dev server.";
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}
