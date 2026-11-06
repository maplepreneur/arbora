import type { PackageManager } from './terminal.js';

export type ProjectCommandSource = 'package.json' | 'rails' | 'procfile' | 'makefile' | 'composer' | 'cargo' | 'go';

export interface ProjectCommand {
  readonly id: string;
  readonly title: string;
  readonly command: string;
  readonly source: ProjectCommandSource;
}

/** Which package manager a lockfile says this project uses. `npm` when nothing more specific is present. */
export function packageManagerFor(locks: { pnpm?: boolean; yarn?: boolean; bun?: boolean }): PackageManager {
  if (locks.pnpm) return 'pnpm';
  if (locks.yarn) return 'yarn';
  if (locks.bun) return 'bun';
  return 'npm';
}

const AGENT_CLIS: readonly { readonly bin: string; readonly name: string }[] = [
  { bin: 'claude', name: 'Claude Code' },
  { bin: 'codex', name: 'Codex' },
  { bin: 'opencode', name: 'OpenCode' },
  { bin: 'kimi', name: 'Kimi' },
  { bin: 'grok', name: 'Grok' },
  { bin: 'agy', name: 'Antigravity' },
  { bin: 'antigravity', name: 'Antigravity' },
  { bin: 'gemini', name: 'Gemini' },
  { bin: 'amp', name: 'Amp' },
  { bin: 'copilot', name: 'Copilot' },
];

/**
 * The agent a terminal is running, from a process command line (`claude`, `codex`, …).
 * A hyphenated name such as `claude-code-acp` does not count: that is Arbora's own ACP adapter.
 */
export function terminalAgentName(commandLine: string): string | null {
  const tokens = commandLine
    .toLowerCase()
    .split(/[\s'"=]+/)
    .map((token) => token.split(/[/\\]/).pop() ?? token);
  for (const agent of AGENT_CLIS) {
    if (tokens.includes(agent.bin)) return agent.name;
  }
  return null;
}

export interface ProjectCommandInput {
  readonly packageJson?: string;
  readonly packageManager?: PackageManager;
  /** `bin/rails` or a Rails `config/application.rb` is present. */
  readonly rails?: boolean;
  readonly binDev?: boolean;
  readonly binJobs?: boolean;
  readonly gemfile?: string;
  /** A `spec/` folder exists. */
  readonly specDir?: boolean;
  readonly procfileDev?: string;
  readonly makefile?: string;
  readonly composerJson?: string;
  readonly artisan?: boolean;
  readonly cargoToml?: boolean;
  readonly goMod?: boolean;
}

const MAX_COMMANDS = 40;

/** Scripts a package.json app offers as their own rows. `preview` is one of them, not a pre-hook. */
const PREFERRED_SCRIPTS = new Set(['dev', 'build', 'test', 'lint', 'preview', 'start', 'nuxt', 'next', 'vite']);

function scriptRunner(manager: PackageManager, script: string): string {
  if (manager === 'npm') return `npm run ${script}`;
  return `${manager} run ${script}`;
}

function scriptTitle(manager: PackageManager, name: string): string {
  return `${manager}:${name}`;
}

/** A script people run by hand: the short list, or a Nuxt, Next, or Vite command. */
function includeScript(name: string, command: string): boolean {
  if (PREFERRED_SCRIPTS.has(name)) return true;
  if (name.startsWith('pre') || name.startsWith('post')) return false;
  return /(^|[\s/])(nuxt|nuxi|next|vite)(\s|$)/.test(command);
}

function push(commands: ProjectCommand[], source: ProjectCommandSource, title: string, command: string): void {
  if (commands.length >= MAX_COMMANDS) return;
  const id = `${source}:${command}`;
  if (commands.some((existing) => existing.id === id)) return;
  commands.push({ id, title, command, source });
}

/** Commands a project offers to run in a terminal, from the files the caller already read. */
export function detectProjectCommands(input: ProjectCommandInput): ProjectCommand[] {
  const commands: ProjectCommand[] = [];
  const manager = input.packageManager ?? 'npm';
  if (input.packageJson) {
    try {
      const parsed: unknown = JSON.parse(input.packageJson);
      const scripts =
        parsed !== null && typeof parsed === 'object' && 'scripts' in parsed
          ? (parsed as { scripts?: unknown }).scripts
          : undefined;
      if (scripts !== null && typeof scripts === 'object') {
        for (const [name, value] of Object.entries(scripts)) {
          if (typeof value !== 'string' || !includeScript(name, value)) continue;
          push(commands, 'package.json', scriptTitle(manager, name), scriptRunner(manager, name));
        }
      }
    } catch {
      // A broken package.json contributes no scripts. The other detectors still run.
    }
  }
  if (input.rails) {
    const rspec = input.specDir === true && /^\s*gem\s+['"]rspec(-rails)?['"]/m.test(input.gemfile ?? '');
    push(commands, 'rails', 'Dev server', input.binDev ? 'bin/dev' : 'bin/rails server');
    push(commands, 'rails', 'Bundle install', 'bundle install');
    push(commands, 'rails', 'Migrate', 'bin/rails db:migrate');
    push(commands, 'rails', 'Rollback', 'bin/rails db:rollback');
    push(commands, 'rails', 'Seed', 'bin/rails db:seed');
    push(commands, 'rails', 'Routes', 'bin/rails routes');
    push(commands, 'rails', 'Console', 'bin/rails console');
    push(commands, 'rails', 'Test', rspec ? 'bundle exec rspec' : 'bin/rails test');
    if (input.binJobs) push(commands, 'rails', 'Jobs', 'bin/jobs');
  }
  if (input.procfileDev) {
    for (const line of input.procfileDev.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const split = trimmed.indexOf(':');
      if (split <= 0) continue;
      const name = trimmed.slice(0, split).trim();
      const command = trimmed.slice(split + 1).trim();
      if (name && command) push(commands, 'procfile', name, command);
    }
  }
  if (input.makefile) {
    for (const line of input.makefile.split('\n')) {
      const match = /^([A-Za-z0-9][\w-]*)\s*:/.exec(line);
      const target = match?.[1];
      if (!target || target.startsWith('.')) continue;
      push(commands, 'makefile', target, `make ${target}`);
    }
  }
  if (input.composerJson) {
    try {
      const parsed: unknown = JSON.parse(input.composerJson);
      const scripts =
        parsed !== null && typeof parsed === 'object' && 'scripts' in parsed
          ? (parsed as { scripts?: unknown }).scripts
          : undefined;
      if (scripts !== null && typeof scripts === 'object') {
        for (const [name, value] of Object.entries(scripts)) {
          if (typeof value !== 'string' && !Array.isArray(value)) continue;
          push(commands, 'composer', name, `composer run ${name}`);
        }
      }
    } catch {
      // Ignore a broken composer.json.
    }
  }
  if (input.artisan) {
    push(commands, 'composer', 'Artisan serve', 'php artisan serve');
    push(commands, 'composer', 'Artisan migrate', 'php artisan migrate');
    push(commands, 'composer', 'Artisan test', 'php artisan test');
  }
  if (input.cargoToml) {
    push(commands, 'cargo', 'Run', 'cargo run');
    push(commands, 'cargo', 'Test', 'cargo test');
  }
  if (input.goMod) {
    push(commands, 'go', 'Run', 'go run .');
    push(commands, 'go', 'Test', 'go test ./...');
  }
  return commands;
}
