import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ToolError } from './cdp.js';
import type { GroveSession, GroveStatus, GroveToolHost } from './grove-host.js';

/** Under the 60 s tool-call timeout of the MCP SDK client and Codex, so a default wait is not cut off. */
export const DEFAULT_GROVE_WAIT_SECONDS = 45;
export const MAX_GROVE_WAIT_SECONDS = 300;
const DEFAULT_READ_LIMIT = 20;
const MAX_READ_LIMIT = 100;
const MAX_TASK_LENGTH = 20_000;

const STATUS_WORD: Readonly<Record<GroveStatus, string>> = {
  needs_you: 'Needs you',
  failed: 'Failed',
  working: 'Working',
  starting: 'Starting',
  done: 'Done',
  idle: 'Idle',
  stopped: 'Stopped',
};

/** Has a live agent process, so it counts against the helper limit. */
function isRunning(session: GroveSession): boolean {
  return !session.archived && session.status !== 'stopped' && session.status !== 'failed';
}

function isBusy(session: GroveSession): boolean {
  return session.status === 'working' || session.status === 'starting';
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  return Math.min(max, Math.max(1, Math.round(value ?? fallback)));
}

/** Grove state shared by every MCP request of one lead session: whether the user allowed helpers. */
export class GroveContext {
  private allowed = false;
  private asking: Promise<boolean> | null = null;

  constructor(readonly host: GroveToolHost) {}

  /** Asks once per session; parallel calls share one permission card. */
  async permitStart(): Promise<void> {
    if (this.allowed) return;
    this.asking ??= this.host.confirmStart().finally(() => {
      this.asking = null;
    });
    if (!(await this.asking)) {
      throw new ToolError(
        'The user declined to let you start helper agents. Do not retry; do the work yourself or tell the user what you wanted to delegate.',
      );
    }
    this.allowed = true;
  }

  /** The caller's own helper `sessionId`, or a ToolError the agent can act on. */
  helper(sessionId: string): GroveSession {
    const session = this.host.sessions().find((s) => s.id === sessionId);
    if (!session) throw new ToolError(`Unknown session ${sessionId}. grove_list_agents lists the sessions.`);
    if (session.parentId !== this.host.sessionId) {
      throw new ToolError(
        `${sessionId} is not one of your helpers. You can only send to, wait for, read and stop helpers you started.`,
      );
    }
    return session;
  }

  /** The caller's helpers that are not archived, oldest first (the host's order). */
  helpers(): GroveSession[] {
    return this.host.sessions().filter((s) => s.parentId === this.host.sessionId && !s.archived);
  }
}

function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] };
}

function statusLine(session: GroveSession): string {
  const word = STATUS_WORD[session.status];
  if (session.status === 'needs_you') {
    const what = session.waitingFor ? ` (${session.waitingFor})` : '';
    return `${word}${what}. The user has to answer it in Arbora; tell them.`;
  }
  return session.lastMessage ? `${word}. Last message: ${session.lastMessage}` : `${word}.`;
}

/**
 * Registers the Grove orchestration tools (Stage 10) for a lead session. `cancelled` looks up the
 * signal the server aborts when the client cancels that request id.
 */
export function registerGroveTools(
  server: McpServer,
  context: GroveContext,
  cancelled: (requestId: string | number) => AbortSignal | undefined = () => undefined,
): void {
  const { host } = context;

  const tool = <Shape extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: Shape,
    run: (args: z.infer<z.ZodObject<Shape>>, signal: AbortSignal) => Promise<string>,
    annotations: { readOnlyHint?: boolean; destructiveHint?: boolean } = {},
  ): void => {
    server.registerTool(
      name,
      { description, inputSchema: shape, annotations: { openWorldHint: false, ...annotations } },
      // The SDK infers the callback's argument type from the shape; the cast keeps `run` generic.
      (async (args: z.infer<z.ZodObject<Shape>>, extra: { signal: AbortSignal; requestId: string | number }) => {
        const cancel = cancelled(extra.requestId);
        const signal = cancel ? AbortSignal.any([extra.signal, cancel]) : extra.signal;
        try {
          return text(await run(args, signal));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { isError: true, content: [{ type: 'text', text: message }] };
        }
      }) as never,
    );
  };

  tool(
    'grove_list_agents',
    "List the agents you can start as helpers (the project's default first) and the sessions in this project's Grove with their status.",
    {},
    () => {
      const { agents, defaultAgentId } = host.agents();
      const sessions = host.sessions().filter((s) => !s.archived);
      const names = new Map(sessions.map((s) => [s.id, s.name]));
      const agentName = new Map(agents.map((a) => [a.id, a.name]));
      const ordered = [...agents].sort((a, b) => Number(b.id === defaultAgentId) - Number(a.id === defaultAgentId));
      const agentLines = ordered.map((agent) => {
        const notes = [
          agent.id === defaultAgentId ? 'default' : null,
          agent.detected ? null : 'not installed',
          agent.signedIn === true ? 'signed in' : agent.signedIn === false ? 'not signed in' : null,
        ].filter((note): note is string => note !== null);
        return `- ${agent.id}: ${agent.name}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}`;
      });
      const sessionLines = sessions.map((s) => {
        const whose =
          s.id === host.sessionId
            ? ' [you]'
            : s.parentId === host.sessionId
              ? ' [your helper]'
              : s.parentId
                ? ` [helper of ${names.get(s.parentId) ?? s.parentId}]`
                : '';
        return `- ${s.id} "${s.name}" (${agentName.get(s.agentId) ?? s.agentId}): ${STATUS_WORD[s.status]}${whose}`;
      });
      const running = context.helpers().filter(isRunning).length;
      return Promise.resolve(
        [
          'Agents you can start:',
          ...(agentLines.length > 0 ? agentLines : ['- none configured']),
          '',
          'Sessions in Grove:',
          ...sessionLines,
          '',
          `Running helpers: ${running} of ${host.maxHelpers()}.`,
        ].join('\n'),
      );
    },
    { readOnlyHint: true },
  );

  tool(
    'grove_start_agent',
    'Start a helper agent in a new Grove session and send it a task. Returns its session id at once; it works in parallel with you. The task must stand on its own: the helper cannot see your conversation. The first call in a session asks the user. Then use grove_wait and grove_read.',
    {
      task: z.string().min(1).max(MAX_TASK_LENGTH).describe("The helper's first prompt: everything it needs to know"),
      agent: z
        .string()
        .optional()
        .describe("Agent id from grove_list_agents; the project's default agent when omitted"),
      model: z.string().max(300).optional().describe("A model id for that agent; the user's default when omitted"),
      title: z.string().max(200).optional().describe("The session's name in Grove; the task's first line when omitted"),
    },
    async ({ task, agent, model, title }) => {
      const { agents, defaultAgentId } = host.agents();
      const agentId = agent ?? defaultAgentId;
      if (!agentId) {
        throw new ToolError('No default agent is set for this project. Pass `agent` (grove_list_agents lists them).');
      }
      const definition = agents.find((a) => a.id === agentId);
      if (!definition) {
        throw new ToolError(`Unknown agent ${agentId}. Known agents: ${agents.map((a) => a.id).join(', ') || 'none'}.`);
      }
      if (!definition.detected) throw new ToolError(`${definition.name} is not installed on this machine.`);
      const checkLimit = (): void => {
        const limit = host.maxHelpers();
        const running = context.helpers().filter(isRunning).length;
        if (running < limit) return;
        throw new ToolError(
          `You already have ${running} running helper${running === 1 ? '' : 's'} (the limit is ${limit}). Wait for them with grove_wait, or stop one with grove_stop.`,
        );
      };
      checkLimit();
      await context.permitStart();
      // Parallel calls can all pass the first check while the permission card is open.
      checkLimit();
      const id = await host.start({ agentId, task, model, title });
      return `Started helper ${id} (${definition.name}). It is working on the task. Call grove_wait with this session id, then grove_read to see what it did.`;
    },
  );

  tool(
    'grove_send',
    'Send a follow-up message to one of your helpers that is not working (wait for it first). Returns at once.',
    {
      sessionId: z.string().describe('A helper session id from grove_start_agent'),
      message: z.string().min(1).max(MAX_TASK_LENGTH),
    },
    async ({ sessionId, message }) => {
      const session = context.helper(sessionId);
      if (session.archived) throw new ToolError(`${session.name} was archived by the user.`);
      if (isBusy(session)) throw new ToolError(`${session.name} is still working. Call grove_wait first.`);
      await host.send(sessionId, message);
      return `Sent to ${session.name}. Call grove_wait to wait for its answer.`;
    },
  );

  tool(
    'grove_wait',
    `Wait until your helpers are settled (Done, Idle, Needs you, Failed or Stopped), then return each one's status and last message. Gives up after timeoutSeconds (default ${DEFAULT_GROVE_WAIT_SECONDS}, at most ${MAX_GROVE_WAIT_SECONDS}); call it again to keep waiting.`,
    {
      sessionIds: z.array(z.string()).optional().describe('Helper session ids; all of your helpers when omitted'),
      until: z.enum(['all', 'any']).optional().describe('"all" (default): every helper; "any": the first one'),
      timeoutSeconds: z.number().positive().optional(),
    },
    async ({ sessionIds, until = 'all', timeoutSeconds }, signal) => {
      const ids = sessionIds ?? context.helpers().map((s) => s.id);
      if (ids.length === 0) throw new ToolError('You have not started any helpers. Use grove_start_agent first.');
      for (const id of ids) context.helper(id);
      const seconds = clamp(timeoutSeconds, DEFAULT_GROVE_WAIT_SECONDS, MAX_GROVE_WAIT_SECONDS);
      const settled = await host.wait(ids, { until, timeoutMs: seconds * 1000, signal });
      const byId = new Map(host.sessions().map((s) => [s.id, s]));
      const lines = ids.map((id) => {
        const session = byId.get(id);
        return session ? `- ${id} "${session.name}": ${statusLine(session)}` : `- ${id}: deleted by the user.`;
      });
      let heading: string;
      if (settled) heading = until === 'all' ? 'Settled:' : 'At least one helper is settled:';
      else if (signal.aborted) heading = 'Stopped waiting: your turn was cancelled.';
      else heading = `Still working after ${seconds} s. Call grove_wait again to keep waiting:`;
      return [heading, ...lines].join('\n');
    },
    { readOnlyHint: true },
  );

  tool(
    'grove_read',
    "Read one of your helpers' latest transcript entries as text: messages, tool call titles, permission requests and errors.",
    {
      sessionId: z.string().describe('A helper session id from grove_start_agent'),
      limit: z
        .number()
        .positive()
        .optional()
        .describe(`How many entries (default ${DEFAULT_READ_LIMIT}, at most ${MAX_READ_LIMIT})`),
    },
    ({ sessionId, limit }) => {
      const session = context.helper(sessionId);
      const lines = host.transcript(sessionId, clamp(limit, DEFAULT_READ_LIMIT, MAX_READ_LIMIT));
      const heading = `${session.name}: ${STATUS_WORD[session.status]}`;
      return Promise.resolve([heading, ...(lines.length > 0 ? lines : ['(nothing yet)'])].join('\n'));
    },
    { readOnlyHint: true },
  );

  tool(
    'grove_stop',
    "Stop one of your helpers' agent process. Its transcript stays in Grove, and grove_send starts it again.",
    { sessionId: z.string().describe('A helper session id from grove_start_agent') },
    async ({ sessionId }) => {
      const session = context.helper(sessionId);
      await host.stop(sessionId);
      return `Stopped ${session.name}.`;
    },
    { destructiveHint: true },
  );
}
