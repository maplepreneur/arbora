import { execFile } from 'node:child_process';
import {
  loginsForOrigin,
  opCreateArgs,
  opCreateTemplate,
  opListArgs,
  opOtpArgs,
  opRevealArgs,
  opVersionArgs,
  revealedLogin,
  type LoginSummary,
  type RevealedLogin,
} from './op-command.js';
import type { SecretMask } from './secret-mask.js';

const TIMEOUT_MS = 30_000;

export interface OpRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/** Runs `op`. Stdout and stderr are secret and must not be logged. */
export type OpRunner = (args: readonly string[], stdin?: string) => Promise<OpRunResult>;

export class OnePasswordProvider {
  constructor(
    private readonly run: OpRunner,
    private readonly secrets: SecretMask,
  ) {}

  async version(): Promise<string | null> {
    const result = await this.run(opVersionArgs()).catch(() => null);
    if (!result || result.code !== 0) return null;
    return result.stdout.trim() || null;
  }

  async listLogins(origin: string): Promise<LoginSummary[]> {
    const result = await this.run(opListArgs());
    if (result.code !== 0) throw new Error(opFailure(result.stderr));
    return loginsForOrigin(result.stdout, origin);
  }

  async reveal(id: string): Promise<RevealedLogin> {
    const result = await this.run(opRevealArgs(id));
    if (result.code !== 0) throw new Error(opFailure(result.stderr));
    const login = revealedLogin(result.stdout);
    this.secrets.note(login.password);
    return login;
  }

  async otp(id: string): Promise<string> {
    const result = await this.run(opOtpArgs(id));
    if (result.code !== 0) throw new Error(opFailure(result.stderr));
    const code = result.stdout.trim();
    this.secrets.note(code);
    return code;
  }

  async save(input: { title: string; url: string; username: string; password: string }): Promise<void> {
    this.secrets.note(input.password);
    const result = await this.run(opCreateArgs(), opCreateTemplate(input));
    if (result.code !== 0) throw new Error(opFailure(result.stderr));
  }
}

/** `op` via execFile. Secrets travel on stdin. Nothing from the child is written to the log. */
export function runOp(
  command: string,
  env: Record<string, string>,
  args: readonly string[],
  stdin?: string,
): Promise<OpRunResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      [...args],
      { env, timeout: TIMEOUT_MS, maxBuffer: 2_000_000, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : 0;
        if (typeof code === 'string') {
          reject(error instanceof Error ? error : new Error('Could not run op'));
          return;
        }
        resolve({ stdout, stderr, code: typeof code === 'number' ? code : 0 });
      },
    );
    child.stdin?.end(stdin ?? '');
  });
}

function opFailure(stderr: string): string {
  const line = stderr.trim().split('\n')[0] ?? '';
  if (/not signed in|account is not signed in|not authenticated/i.test(line)) {
    return '1Password is locked. Unlock it and turn on Integrate with 1Password CLI.';
  }
  if (line.length > 0) return '1Password could not complete that request.';
  return '1Password is not available. Run pnpm setup:1password.';
}
