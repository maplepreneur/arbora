import type {
  GroveAgent,
  GroveSession,
  GroveStartRequest,
  GroveStatus,
  GroveToolHost,
  GroveWaitRequest,
} from '@arbora/mcp-browser-server/host';
import {
  attentionFromTranscript,
  deriveSessionStatus,
  displayNames,
  resolveDefaultAgent,
  taskTitle,
  transcriptLines,
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

function signedIn(verification: AgentVerification | undefined): boolean | null {
  if (verification?.status === 'ready') return true;
  if (verification?.status === 'auth_required') return false;
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
          signedIn: signedIn(settings.verified[agent.id]),
        })),
      defaultAgentId,
    };
  }

  sessions(): GroveSession[] {
    const service = this.service();
    const threads = service.listThreads().sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const names = displayNames(threads, (agentId) => service.agentName(agentId));
    return threads.map((thread) => {
      const attention = attentionFromTranscript(service.getThread(thread.id)?.events ?? [], thread.state);
      const status = GROVE_STATUS[deriveSessionStatus(thread.state.status, attention)];
      let waitingFor: string | null = null;
      if (status === 'needs_you') {
        waitingFor =
          attention.pendingPermissions.length > 0 ? (attention.permissionTitle ?? 'a permission request') : 'a login';
      }
      return {
        id: thread.id,
        name: names.get(thread.id) ?? thread.title,
        agentId: thread.agentId,
        status,
        parentId: thread.parentThreadId,
        archived: thread.archivedAt !== null,
        lastMessage: attention.lastMessage,
        waitingFor,
      };
    });
  }

  maxHelpers(): number {
    return this.options.maxHelpers();
  }

  async confirmStart(): Promise<boolean> {
    const service = this.service();
    const lead = this.sessions().find((session) => session.id === this.sessionId);
    const kind = await service.requestToolPermission(this.sessionId, {
      title: `${lead?.name ?? 'This agent'} wants to start helper agents`,
      detail: `Each helper is a new Grove session that works next to this one; you can open, answer and stop it there. At most ${this.maxHelpers()} run at once.`,
      toolKind: 'execute',
      persistent: false,
    });
    return kind === 'allow_once';
  }

  /** Creates the helper before returning, so a parallel call's limit check already counts it. */
  start(request: GroveStartRequest): Promise<string> {
    const service = this.service();
    const lead = service.listThreads().find((thread) => thread.id === this.sessionId);
    const helper = service.createThread(request.agentId, {
      model: request.model,
      groupId: lead?.groupId ?? null,
      parentThreadId: this.sessionId,
      title: request.title?.trim() || taskTitle(request.task) || undefined,
      autoApproveEdits: lead?.autoApproveEdits ?? false,
    });
    void service.prompt(helper.id, [{ type: 'text', text: request.task }]).catch(() => undefined);
    return Promise.resolve(helper.id);
  }

  send(sessionId: string, message: string): Promise<void> {
    const service = this.service();
    // A turn that waits on a permission card is still a turn; `prompt` would refuse it later.
    if (service.getThread(sessionId)?.state.status === 'prompting') {
      return Promise.reject(
        new Error('That helper is waiting for the user to answer it in Arbora. Its turn has to end first.'),
      );
    }
    void service.prompt(sessionId, [{ type: 'text', text: message }]).catch(() => undefined);
    return Promise.resolve();
  }

  wait(sessionIds: readonly string[], request: GroveWaitRequest): Promise<boolean> {
    return this.service().waitForSettled(sessionIds, { ...request, turnOf: this.sessionId });
  }

  transcript(sessionId: string, limit: number): string[] {
    return transcriptLines(this.service().getThread(sessionId)?.events ?? [], limit);
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
