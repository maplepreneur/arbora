import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import type { AppSettings } from '@arbora/shared';
import { redactSettings, redactText } from './diagnostics-redact.js';

const LOG_LIMIT_BYTES = 1024 * 1024;

/**
 * Warnings and errors from the main process, appended to `<userData>/logs/main.log` (rotated at
 * 1 MB to `main.old.log`). Arbora sends nothing anywhere; this file only goes into a diagnostics
 * export the user makes.
 */
export class MainLog {
  private enabled = true;
  private restore: (() => void) | null = null;

  constructor(readonly dir: string) {}

  get file(): string {
    return join(this.dir, 'main.log');
  }

  install(): void {
    if (this.restore) return;
    const { warn, error } = console;
    console.warn = (...args: unknown[]) => {
      warn(...args);
      this.write('warn', args);
    };
    console.error = (...args: unknown[]) => {
      error(...args);
      this.write('error', args);
    };
    this.restore = () => {
      console.warn = warn;
      console.error = error;
    };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  write(level: 'info' | 'warn' | 'error', args: readonly unknown[]): void {
    if (!this.enabled) return;
    const text = args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a))).join(' ');
    try {
      mkdirSync(this.dir, { recursive: true });
      if (existsSync(this.file) && statSync(this.file).size > LOG_LIMIT_BYTES) {
        renameSync(this.file, join(this.dir, 'main.old.log'));
      }
      appendFileSync(this.file, `${new Date().toISOString()} ${level} ${text}\n`, 'utf8');
    } catch {
      // Logging must never take the app down.
    }
  }

  dispose(): void {
    this.restore?.();
    this.restore = null;
  }
}

export interface DiagnosticsInput {
  readonly info: Record<string, unknown>;
  readonly settings: AppSettings;
  readonly logDir: string;
  readonly crashDir: string;
  /** `.arbora/project.json` of each open project, keyed by project name. */
  readonly projects: readonly { name: string; settings: unknown }[];
  readonly metrics: unknown;
}

function readText(path: string, limit = LOG_LIMIT_BYTES * 2): string {
  try {
    const text = readFileSync(path, 'utf8');
    return text.length > limit ? text.slice(-limit) : text;
  } catch {
    return '';
  }
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(path);
    }
  };
  walk(dir);
  return out;
}

/**
 * The zip behind **Export Diagnostics**: app and OS info, redacted settings, the main log and the
 * names and sizes of local crash dumps (not their contents, which can hold page memory).
 */
export function buildDiagnosticsZip(input: DiagnosticsInput): Uint8Array {
  const home = homedir();
  const json = (value: unknown): Uint8Array => strToU8(`${JSON.stringify(value, null, 2)}\n`);
  const crashes = listFiles(input.crashDir).map((path) => {
    const stat = statSync(path);
    return { file: relative(input.crashDir, path), bytes: stat.size, modified: stat.mtime.toISOString() };
  });
  const files: Record<string, Uint8Array> = {
    'README.txt': strToU8(
      'Arbora diagnostics. Agent env values, tokens and your home folder path were removed. Crash dumps are listed, not included.\n',
    ),
    'info.json': json(input.info),
    'settings.json': json(redactSettings(input.settings, home)),
    'metrics.json': json(input.metrics),
    'crash-dumps.json': json(crashes),
    'main.log': strToU8(redactText(readText(join(input.logDir, 'main.log')), home)),
    'main.old.log': strToU8(redactText(readText(join(input.logDir, 'main.old.log')), home)),
  };
  for (const [index, project] of input.projects.entries()) {
    files[`projects/${index + 1}-${project.name.replace(/[^\w.-]+/g, '_')}.json`] = json(project.settings);
  }
  return zipSync(files, { level: 6 });
}
