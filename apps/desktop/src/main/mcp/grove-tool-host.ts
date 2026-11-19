import type {
  GroveAgent,
  GroveSession,
  GroveStartRequest,
  GroveStatus,
  GroveToolHost,
  GroveWaitRequest,
} from '@arbora/mcp-browser-server/host';
import {
  deriveSessionStatus,
  displayNames,
  resolveDefaultAgent,
  taskTitle,
  terminalLines,
  type AgentSettings,
  type AgentVerification,
  type SessionStatus,
} from '@arbora/shared';
import type { AgentService } from '../agent/agent-service.js';

const GROVE_STATUS: Readonly<Record<SessionStatus, GroveStatus>> = {
  needsYou: 'needs_you',
  failed: 'failed',
  working: 'working',
  starting: 'starting',
  done: 'done',
  idle: 'idle',
  stopped: 'stopped',
};

export interface GroveHostOptions {
  /** The lead: the thread whose MCP server carries the Grove tools. */
  readonly threadId: string;
  readonly agents: () => AgentService | null;
  readonly agentSettings: () => Pick<AgentSettings, 'defaultAgent' | 'hidden' | 'verified'>;
  /** `.arbora/project.json` `defaultAgent`. */
  readonly projectDefaultAgent: () => string | undefined;
  /** `settings.grove.maxChildren`. */
  readonly maxHelpers: () => number;
}

function runs(verification: AgentVerification | undefined): boolean | null {
  if (verification?.status === 'ready') return true;
  if (verification?.status === 'auth_required' || verification?.status === 'missing') return false;
  return null;
}

/** The Grove orchestration tools' view of the project's agent threads, for one lead (Stage 10). */
export class GroveHost implements GroveToolHost {
  constructor(private readonly options: GroveHostOptions) {}

  get sessionId(): string {
    return this.options.threadId;
  }

  agents(): { agents: GroveAgent[]; defaultAgentId: string | null } {
    const { agents, availability } = this.service().listAgents();
    const settings = this.options.agentSettings();
    const defaultAgentId =
      resolveDefaultAgent(
        agents.map((agent) => agent.id),
        this.options.projectDefaultAgent(),
        settings.defaultAgent,
      ) ?? null;
    const detected = new Set(availability.filter((a) => a.available).map((a) => a.id));
    return {
      agents: agents
        .filter((agent) => agent.id === defaultAgentId || !settings.hidden.includes(agent.id))
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          detected: detected.has(agent.id),
          runs: runs(settings.verified[agent.id]),
        })),
      defaultAgentId,
    };
  }

  sessions(): GroveSession[] {
    const service = this.service();
    const threads = service.listThreads().sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const names = displayNames(threads, (agentId) => service.agentName(agentId));
    return threads.map((thread) => {
      const status = GROVE_STATUS[deriveSessionStatus(thread.state.status, undefined)];
      return {
        id: thread.id,
        name: names.get(thread.id) ?? thread.title,
        agentId: thread.agentId,
        status,
        parentId: thread.parentThreadId,
        archived: thread.archivedAt !== null,
        lastMessage: thread.state.lastLine,
        waitingFor: status === 'needs_you' ? (thread.state.lastLine ?? 'an answer in its terminal') : null,
      };
    });
  }

  maxHelpers(): number {
    return this.options.maxHelpers();
  }

  async confirmStart(): Promise<boolean> {
    const service = this.service();
    const lead = this.sessions().find((session) => session.id === this.sessionId);
    const kind = await service.requestConfirmation(this.sessionId, {
      title: `${lead?.name ?? 'This agent'} wants to start helper agents`,
      detail: `Each helper is a new Grove session that works next to this one; you can open, answer and stop it there. At most ${this.maxHelpers()} run at once.`,
      persistent: false,
    });
    return kind === 'allow_once';
  }

  /** Creates the helper before returning, so a parallel call's limit check already counts it. */
  start(request: GroveStartRequest): Promise<string> {
    const service = this.service();
    const lead = service.listThreads().find((thread) => thread.id === this.sessionId);
    const helper = service.createThread(request.agentId, {
      groupId: lead?.groupId ?? null,
      parentThreadId: this.sessionId,
      title: request.title?.trim() || taskTitle(request.task) || undefined,
    });
    void service.sendPrompt(helper.id, request.task).catch(() => undefined);
    return Promise.resolve(helper.id);
  }

  async send(sessionId: string, message: string): Promise<void> {
    const service = this.service();
    const status = service.getThread(sessionId)?.state.status;
    // A turn still in flight belongs to the agent; writing into it would interleave prompts.
    if (status === 'working' || status === 'starting') {
      return Promise.reject(new Error('That helper is still working. Call grove_wait first.'));
    }
    await service.sendPrompt(sessionId, message);
  }

  wait(sessionIds: readonly string[], request: GroveWaitRequest): Promise<boolean> {
    return this.service().waitForSettled(sessionIds, { ...request, turnOf: this.sessionId });
  }

  transcript(sessionId: string, limit: number): string[] {
    const service = this.service();
    const thread = service.getThread(sessionId);
    if (!thread) return [];
    return terminalLines(thread.state, thread.lastLines, limit);
  }

  stop(sessionId: string): Promise<void> {
    return this.service().stopProcess(sessionId);
  }

  private service(): AgentService {
    const service = this.options.agents();
    if (!service) throw new Error('The project is closing.');
    return service;
  }
}
