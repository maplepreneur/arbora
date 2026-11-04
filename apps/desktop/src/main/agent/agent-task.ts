import { readFile } from 'node:fs/promises';
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk';
import {
  AcpSession,
  AgentProcess,
  LEGACY_MODEL_OPTION_ID,
  resolveInsideRoot,
  sessionConfigOptions,
  type CommandLookup,
} from '@arbora/acp-client';
import type { AgentDefinition, Platform } from '@arbora/shared';

export interface AgentTaskOptions {
  readonly platform: Platform;
  readonly projectPath: string;
  readonly agent: AgentDefinition;
  /** Full child environment (login-shell PATH plus the agent's env). */
  readonly env: Record<string, string>;
  readonly lookup: CommandLookup;
  /** A value of the agent's `model` config option; ignored when the agent does not offer it. */
  readonly model?: string | null;
  readonly prompt: string;
  readonly timeoutMs?: number;
}

export class AgentTaskError extends Error {}

const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * One prompt in a throwaway ACP session that never shows up as a thread: commit messages and pull
 * request text. The agent may read project files; writes, terminals and permission requests are
 * refused, so a task cannot change anything. Resolves with the agent's reply text.
 */
export async function runAgentTask(options: AgentTaskOptions): Promise<string> {
  const { agent } = options;
  const command = options.lookup(agent.command);
  if (!command) throw new AgentTaskError(`${agent.command} was not found on PATH. ${agent.installHint ?? ''}`.trim());
  const process = new AgentProcess({
    platform: options.platform,
    command,
    args: agent.args,
    env: options.env,
    cwd: options.projectPath,
    lookup: options.lookup,
    onStderr: () => undefined,
  });
  let reply = '';
  const refuse = (): Promise<never> => Promise.reject(new Error('Arbora runs this task read-only'));
  const session = new AcpSession(process.stream, {
    requestPermission: (request) => Promise.resolve(refusePermission(request)),
    readTextFile: async (request) => {
      const text = await readFile(resolveInsideRoot(options.projectPath, request.path), 'utf8');
      return { content: text };
    },
    writeTextFile: refuse,
    terminal: { create: refuse, output: refuse, waitForExit: refuse, kill: refuse, release: refuse },
    onUpdate: (notification: SessionNotification) => {
      const update = notification.update;
      if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
        reply += update.content.text;
      }
    },
    onLog: () => undefined,
    onClosed: () => undefined,
  });

  let timer: NodeJS.Timeout | undefined;
  try {
    await session.initialize();
    const created = await session.newSession(options.projectPath, []);
    if (options.model) await applyModel(session, created.sessionId, created, options.model);
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
    await Promise.race([session.prompt(created.sessionId, [{ type: 'text', text: options.prompt }]), timeout]);
    return reply.trim();
  } catch (error) {
    if (AcpSession.isAuthRequired(error)) {
      throw new AgentTaskError(`${agent.name} needs you to log in. Start a thread with it once, then try again.`);
    }
    if (error instanceof AgentTaskError) throw error;
    throw new AgentTaskError(process.startError?.message ?? (error instanceof Error ? error.message : String(error)));
  } finally {
    clearTimeout(timer);
    await session.close().catch(() => undefined);
    process.kill();
    await Promise.race([process.exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
    process.kill('SIGKILL');
  }
}

function refusePermission(request: RequestPermissionRequest): RequestPermissionResponse {
  const reject =
    request.options.find((o) => o.kind === 'reject_once') ?? request.options.find((o) => o.kind === 'reject_always');
  return reject
    ? { outcome: { outcome: 'selected', optionId: reject.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

async function applyModel(session: AcpSession, sessionId: string, response: unknown, model: string): Promise<void> {
  const option = sessionConfigOptions(response).find(
    (o): o is Extract<typeof o, { type: 'select' }> => o.type === 'select' && o.category === 'model',
  );
  if (!option || option.currentValue === model) return;
  const values = option.options.flatMap((entry) => ('group' in entry ? entry.options : [entry])).map((o) => o.value);
  if (!values.includes(model)) return;
  if (option.id === LEGACY_MODEL_OPTION_ID) await session.setModel(sessionId, model);
  else await session.setConfigOption(sessionId, option.id, model);
}
