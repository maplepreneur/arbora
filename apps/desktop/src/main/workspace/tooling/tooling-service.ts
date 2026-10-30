import { extname } from 'node:path';
import type { Diagnostic, DiagnosticSource, EditorSettings } from '@arbora/shared';
import { resolveProjectModule } from '../../lazy/project-modules.js';
import { findTsconfig, groupByPath, parseTscOutput, tscArgs } from './diagnostics.js';
import type { ToolRequest, ToolResponse } from './protocol.js';

const TOOL_TIMEOUT_MS = 10_000;
/** `tsc` on a mid-sized project takes longer than ESLint; still bounded so a hang cannot pile up. */
const TSC_TIMEOUT_MS = 30_000;
const TSC_DEBOUNCE_MS = 2000;

const LINT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte']);
const TSC_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** The slice of Electron's `UtilityProcess` the service needs, so tests can use `child_process.fork`. */
export interface ToolProcess {
  postMessage(message: ToolRequest): void;
  onMessage(listener: (message: ToolResponse) => void): void;
  onExit(listener: (code: number | null) => void): void;
  /** Collected stdout (for `tsc`); resolves when the process exits. */
  stdout(): Promise<string>;
  kill(): void;
}

export type ForkTool = (
  modulePath: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly name: string },
) => ToolProcess;

export interface ToolingServiceOptions {
  readonly root: string;
  /** Built `tooling-worker.js`. */
  readonly workerPath: string;
  readonly fork: ForkTool;
  environment(): Promise<NodeJS.ProcessEnv>;
  settings(): EditorSettings;
  readonly events: {
    diagnostics(path: string, source: DiagnosticSource, diagnostics: Diagnostic[]): void;
    toolError(source: string, message: string): void;
  };
  readonly timeoutMs?: number;
  readonly tscTimeoutMs?: number;
  readonly tscDebounceMs?: number;
}

interface Pending {
  resolve(response: ToolResponse): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/**
 * Format on save and diagnostics on save (PLAN F-EDITOR-02/03). Prettier and ESLint run in one
 * long-lived utility process per project; `tsc` runs in its own utility process, debounced, never
 * two at once. Everything is killed on `dispose` (project close).
 */
export class ToolingService {
  private worker: ToolProcess | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private tscTimer: NodeJS.Timeout | undefined;
  private tscRunning: ToolProcess | null = null;
  private tscAgain = false;
  private tscFiles = new Set<string>();
  private disposed = false;

  constructor(private readonly options: ToolingServiceOptions) {}

  /** Prettier output for `content`, or null when the project has no Prettier or it skips the file. */
  async format(file: string, content: string): Promise<{ content: string | null; error?: string }> {
    try {
      const response = await this.request({ type: 'format', root: this.options.root, file, content });
      if (!response.ok) return { content: null, error: response.error };
      return { content: response.type === 'format' ? response.result : null };
    } catch (error) {
      return { content: null, error: (error as Error).message };
    }
  }

  /** Runs the enabled diagnostics for a file that was just saved. */
  afterSave(file: string, content: string): void {
    const settings = this.options.settings();
    const ext = extname(file).toLowerCase();
    if (settings.eslintOnSave && LINT_EXTENSIONS.has(ext)) void this.lint(file, content);
    if (settings.tscOnSave && TSC_EXTENSIONS.has(ext)) this.scheduleTsc(file);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.tscTimer);
    this.tscRunning?.kill();
    this.tscRunning = null;
    this.stopWorker(new Error('Project closed'));
  }

  private async lint(file: string, content: string): Promise<void> {
    try {
      const response = await this.request({ type: 'lint', root: this.options.root, file, content });
      if (!response.ok) {
        this.options.events.toolError('ESLint', response.error);
        return;
      }
      if (response.type === 'lint' && response.result) this.options.events.diagnostics(file, 'eslint', response.result);
    } catch (error) {
      this.options.events.toolError('ESLint', (error as Error).message);
    }
  }

  private scheduleTsc(file: string): void {
    clearTimeout(this.tscTimer);
    this.tscTimer = setTimeout(() => void this.runTsc(file), this.options.tscDebounceMs ?? TSC_DEBOUNCE_MS);
  }

  private async runTsc(file: string): Promise<void> {
    if (this.disposed) return;
    if (this.tscRunning) {
      this.tscAgain = true;
      return;
    }
    const root = this.options.root;
    const tsc = resolveProjectModule(root, 'typescript/bin/tsc');
    const tsconfig = findTsconfig(root, file);
    if (!tsc || !tsconfig) return;
    const child = this.options.fork(tsc, tscArgs(tsconfig), {
      cwd: root,
      env: await this.options.environment(),
      name: 'arbora-tsc',
    });
    this.tscRunning = child;
    const timer = setTimeout(() => {
      this.options.events.toolError(
        'tsc',
        `tsc took longer than ${(this.options.tscTimeoutMs ?? TSC_TIMEOUT_MS) / 1000} s`,
      );
      child.kill();
    }, this.options.tscTimeoutMs ?? TSC_TIMEOUT_MS);
    try {
      const output = await child.stdout();
      if (this.isDisposed() || !this.isRunningTsc(child)) return;
      const diagnostics = parseTscOutput(output, root, root);
      const grouped = groupByPath(diagnostics, this.tscFiles);
      this.tscFiles = new Set(diagnostics.map((d) => d.path));
      for (const [path, list] of grouped) this.options.events.diagnostics(path, 'tsc', list);
    } finally {
      clearTimeout(timer);
      if (this.isRunningTsc(child)) this.tscRunning = null;
      if (this.tscAgain && !this.isDisposed()) {
        this.tscAgain = false;
        this.scheduleTsc(file);
      }
    }
  }

  private async request(body: DistributiveOmit<ToolRequest, 'id'>): Promise<ToolResponse> {
    if (this.disposed) throw new Error('Project closed');
    const worker = await this.ensureWorker();
    const id = this.nextId++;
    return new Promise<ToolResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out after ${(this.options.timeoutMs ?? TOOL_TIMEOUT_MS) / 1000} s`));
        // A hung tool would block every later request; start a fresh process next time.
        this.stopWorker(new Error('Tooling process restarted'));
      }, this.options.timeoutMs ?? TOOL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ ...body, id });
    });
  }

  private async ensureWorker(): Promise<ToolProcess> {
    if (this.worker) return this.worker;
    const env = await this.options.environment();
    const raced = this.currentWorker();
    if (raced) return raced;
    const worker = this.options.fork(this.options.workerPath, [], {
      cwd: this.options.root,
      env,
      name: 'arbora-tooling',
    });
    worker.onMessage((message) => {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      pending.resolve(message);
    });
    worker.onExit(() => {
      if (this.worker === worker) this.stopWorker(new Error('Tooling process exited'));
    });
    this.worker = worker;
    return worker;
  }

  /** Fields re-read after an await (TypeScript keeps narrowing them across it). */
  private isDisposed(): boolean {
    return this.disposed;
  }

  private isRunningTsc(child: ToolProcess): boolean {
    return this.tscRunning === child;
  }

  private currentWorker(): ToolProcess | null {
    return this.worker;
  }

  private stopWorker(error: Error): void {
    const worker = this.worker;
    this.worker = null;
    worker?.kill();
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
