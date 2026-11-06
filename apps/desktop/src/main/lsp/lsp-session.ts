import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { encodeLspFrame, LspFrameDecoder } from './frame.js';
import { resolveTypeScriptLsp } from './resolve.js';

export interface LspSessionOptions {
  readonly projectPath: string;
  /** Electron's executable, run as Node so the server starts inside the packaged app. */
  readonly execPath: string;
  readonly onMessage: (json: string) => void;
  readonly onExit: (reason: string) => void;
}

/**
 * One `typescript-language-server --stdio` for a project. Messages in and out are bare JSON;
 * this class adds and removes the Content-Length framing.
 */
export class LspSession {
  readonly projectPath: string;
  private tsserverPath: string | null = null;
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly decoder = new LspFrameDecoder();
  private stopped = false;

  constructor(private readonly options: LspSessionOptions) {
    this.projectPath = options.projectPath;
  }

  get tsserver(): string | null {
    return this.tsserverPath;
  }

  get running(): boolean {
    return this.child !== null;
  }

  start(): { ok: true; tsserverPath: string } | { ok: false; error: string } {
    const resolved = resolveTypeScriptLsp(this.projectPath);
    if ('error' in resolved) return { ok: false, error: resolved.error };
    this.tsserverPath = resolved.tsserver;
    const child = spawn(this.options.execPath, [resolved.cli, '--stdio', '--log-level', '1'], {
      cwd: this.projectPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout.on('data', (chunk: Buffer) => {
      for (const message of this.decoder.push(chunk)) this.options.onMessage(message);
    });
    child.on('error', (error) => {
      this.child = null;
      if (!this.stopped) this.options.onExit(error.message);
    });
    child.on('exit', (code) => {
      this.child = null;
      if (this.stopped) return;
      this.options.onExit(
        code === 0 || code === null ? 'The language server stopped.' : `The language server exited (${code}).`,
      );
    });
    return { ok: true, tsserverPath: resolved.tsserver };
  }

  send(json: string): void {
    if (!this.child) throw new Error('The language server is not running.');
    this.child.stdin.write(encodeLspFrame(json));
  }

  stop(): void {
    this.stopped = true;
    const child = this.child;
    this.child = null;
    child?.kill();
  }
}
