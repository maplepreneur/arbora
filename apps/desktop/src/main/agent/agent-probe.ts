import { spawn } from 'node:child_process';
import type { AgentDefinition, AgentVerification, CommandLookup, Platform } from '@arbora/shared';
import { spawnSpec } from './spawn.js';

export const PROBE_TIMEOUT_MS = 30_000;

export interface ProbeOptions {
  readonly agent: AgentDefinition;
  readonly platform: Platform;
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly lookup: CommandLookup;
  readonly now: () => number;
  readonly timeoutMs?: number;
}

/**
 * Runs the agent's version check (`claude --version`) and reads its first line, so pickers can
 * tell an installed CLI from a missing one. Log-in state is the CLI's own business: it happens
 * inside its terminal, not here.
 */
export async function probeAgent(options: ProbeOptions): Promise<AgentVerification> {
  const { agent, now } = options;
  const resolved = options.lookup(agent.command);
  if (!resolved) {
    return { status: 'missing', checkedAt: now(), error: `${agent.command} was not found on PATH` };
  }
  if (agent.probe.length === 0) {
    return { status: 'ready', checkedAt: now(), version: resolved };
  }
  const spec = spawnSpec(options.platform, agent.command, [...agent.args, ...agent.probe], options.lookup);
  const child = spawn(spec.file, spec.args, {
    cwd: options.cwd,
    env: { ...options.env, ...agent.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: spec.shell,
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  const exit = new Promise<{ code: number | null }>((resolveExit) => {
    child.on('error', () => resolveExit({ code: null }));
    child.on('close', (code) => resolveExit({ code }));
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    if (stdout.length < 20_000) stdout += chunk;
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < 20_000) stderr += chunk;
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `${agent.name} did not answer within ${Math.round((options.timeoutMs ?? PROBE_TIMEOUT_MS) / 1000)} s`,
            ),
          ),
        options.timeoutMs ?? PROBE_TIMEOUT_MS,
      );
    });
    const done = await Promise.race([exit, timeout]);
    const firstLine = stdout.trim().split('\n')[0]?.trim() || stderr.trim().split('\n')[0]?.trim() || undefined;
    if (done.code === null) {
      return {
        status: 'error',
        checkedAt: now(),
        ...(firstLine ? { version: firstLine.slice(0, 200) } : {}),
        error: `Could not start ${agent.command}`,
      };
    }
    if (done.code !== 0) {
      return {
        status: 'error',
        checkedAt: now(),
        ...(firstLine ? { version: firstLine.slice(0, 200) } : {}),
        error: `${agent.command} exited with code ${done.code}`,
      };
    }
    return { status: 'ready', checkedAt: now(), ...(firstLine ? { version: firstLine.slice(0, 200) } : {}) };
  } catch (error) {
    return {
      status: 'error',
      checkedAt: now(),
      error: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
    };
  } finally {
    clearTimeout(timer);
    child.kill('SIGKILL');
  }
}
