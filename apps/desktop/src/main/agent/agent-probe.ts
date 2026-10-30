import { AcpSession, AgentProcess, sessionConfigOptions, type CommandLookup } from '@arbora/acp-client';
import type { AgentDefinition, AgentModel, AgentVerification, Platform, SessionConfigOption } from '@arbora/shared';

/** First runs of `npx` adapters download the package; give them time before calling it a failure. */
export const PROBE_TIMEOUT_MS = 60_000;

export interface ProbeOptions {
  readonly agent: AgentDefinition;
  readonly platform: Platform;
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly lookup: CommandLookup;
  readonly now: () => number;
  readonly timeoutMs?: number;
}

/** The `model` select's choices, flattened out of any groups. */
export function modelChoices(options: readonly SessionConfigOption[]): AgentModel[] {
  const model = options.find(
    (option): option is Extract<SessionConfigOption, { type: 'select' }> =>
      option.type === 'select' && option.category === 'model',
  );
  if (!model) return [];
  return model.options
    .flatMap((entry) => ('group' in entry ? entry.options : [entry]))
    .map((entry) => ({ value: entry.value, name: entry.name }));
}

function refuse(): Promise<never> {
  return Promise.reject(new Error('Arbora is only checking the sign-in'));
}

/**
 * Starts the agent without any tools, opens a session, reads its models and stops it. An agent
 * that asks for `authenticate` at `session/new` is `auth_required`. Agents that only fail on the
 * first prompt look `ready` here.
 */
export async function probeAgent(options: ProbeOptions): Promise<AgentVerification> {
  const { agent, now } = options;
  const resolved = options.lookup(agent.command);
  if (!resolved) {
    return { status: 'missing', checkedAt: now(), models: [], error: `${agent.command} was not found on PATH` };
  }
  const stderr: string[] = [];
  const process = new AgentProcess({
    platform: options.platform,
    command: resolved,
    args: agent.args,
    env: { ...options.env, ...agent.env },
    cwd: options.cwd,
    lookup: options.lookup,
    onStderr: (line) => {
      if (stderr.length < 20) stderr.push(line);
    },
  });
  const session = new AcpSession(process.stream, {
    requestPermission: () => Promise.resolve({ outcome: { outcome: 'cancelled' } }),
    readTextFile: refuse,
    writeTextFile: refuse,
    terminal: { create: refuse, output: refuse, waitForExit: refuse, kill: refuse, release: refuse },
    onUpdate: () => undefined,
    onLog: () => undefined,
    onClosed: () => undefined,
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
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
  let version: string | undefined;
  try {
    const initialized = await Promise.race([session.initialize(), timeout]);
    const info = initialized.agentInfo;
    if (info) version = `${info.name} ${info.version}`.trim().slice(0, 200);
    const response = await Promise.race([session.newSession(options.cwd, []), timeout]);
    return {
      status: 'ready',
      checkedAt: now(),
      models: modelChoices(sessionConfigOptions(response)).slice(0, 500),
      ...(version ? { version } : {}),
    };
  } catch (error) {
    if (AcpSession.isAuthRequired(error)) {
      return {
        status: 'auth_required',
        checkedAt: now(),
        models: [],
        ...(version ? { version } : {}),
        error: agent.installHint ?? `${agent.name} needs you to log in`,
      };
    }
    const message = process.startError?.message ?? (error as Error).message;
    const detail = stderr.length > 0 ? `${message}\n${stderr.slice(-5).join('\n')}` : message;
    return {
      status: 'error',
      checkedAt: now(),
      models: [],
      ...(version ? { version } : {}),
      error: detail.slice(0, 2000),
    };
  } finally {
    clearTimeout(timer);
    await session.close().catch(() => undefined);
    process.kill();
  }
}
