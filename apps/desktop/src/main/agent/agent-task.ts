import { spawn } from 'node:child_process';
import type { AgentDefinition, CommandLookup, Platform } from '@arbora/shared';
import { spawnSpec } from './spawn.js';

export interface AgentTaskOptions {
  readonly platform: Platform;
  readonly projectPath: string;
  readonly agent: AgentDefinition;
  /** Full child environment (login-shell PATH plus the agent's env). */
  readonly env: Record<string, string>;
  readonly lookup: CommandLookup;
  readonly prompt: string;
  readonly timeoutMs?: number;
}

export class AgentTaskError extends Error {}

const DEFAULT_TIMEOUT_MS = 180_000;
const OUTPUT_LIMIT = 200_000;

/**
 * One prompt run non-interactively in a throwaway process that never shows up as a thread: commit
 * messages and pull request text. Uses the agent's `task` args (for example `claude -p`, `codex
 * exec`); agents without them are refused. Resolves with the agent's reply text.
 */
export async function runAgentTask(options: AgentTaskOptions): Promise<string> {
  const { agent } = options;
  if (agent.task.length === 0) {
    throw new AgentTaskError(
      `${agent.name} cannot run one-off tasks yet. Start a thread with it and paste the task there.`,
    );
  }
  const command = options.lookup(agent.command);
  if (!command) throw new AgentTaskError(`${agent.command} was not found on PATH. ${agent.installHint ?? ''}`.trim());
  const spec = spawnSpec(options.platform, agent.command, [...agent.task, options.prompt], options.lookup);
  const child = spawn(spec.file, spec.args, {
    cwd: options.projectPath,
    env: { ...options.env, ...agent.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: spec.shell,
    windowsHide: true,
  });
  let reply = '';
  let stderr = '';
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    child.on('error', (error) => {
      stderr += `\n${error.message}`;
      resolveExit({ code: null, signal: null });
    });
    child.on('close', (code, signal) => resolveExit({ code, signal }));
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    if (reply.length < OUTPUT_LIMIT) reply += chunk;
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
            new AgentTaskError(
              `${agent.name} did not answer within ${Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} s`,
            ),
          ),
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
    });
    const done = await Promise.race([exit, timeout]);
    if (done.code !== null && done.code !== 0) {
      const detail = stderr.trim().split('\n').slice(-5).join('\n');
      throw new AgentTaskError(`${agent.name} exited with code ${done.code}${detail ? `:\n${detail}` : ''}`.trim());
    }
    const text = reply.trim();
    if (!text) throw new AgentTaskError(`${agent.name} did not return any text.`);
    return text;
  } catch (error) {
    if (error instanceof AgentTaskError) throw error;
    throw new AgentTaskError(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
    child.kill('SIGKILL');
  }
}
