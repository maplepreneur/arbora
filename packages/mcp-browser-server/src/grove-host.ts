/** A session's status in Grove's words (PLAN § 4.12 "How a session looks"). */
export type GroveStatus = 'needs_you' | 'failed' | 'working' | 'starting' | 'done' | 'idle' | 'stopped';

export interface GroveAgent {
  readonly id: string;
  readonly name: string;
  /** Its command was found on the login-shell PATH. */
  readonly detected: boolean;
  /** The last sign-in check: true, false, or null when it was never checked. */
  readonly signedIn: boolean | null;
}

export interface GroveSession {
  readonly id: string;
  readonly name: string;
  readonly agentId: string;
  readonly status: GroveStatus;
  /** The lead that started it, for helpers. */
  readonly parentId: string | null;
  /** In Grove's Recent. */
  readonly archived: boolean;
  /** First line of its last agent message. */
  readonly lastMessage: string | null;
  /** What it waits on while `needs_you`: a permission title, or a login. */
  readonly waitingFor: string | null;
}

export interface GroveStartRequest {
  readonly agentId: string;
  readonly task: string;
  readonly model?: string | undefined;
  readonly title?: string | undefined;
}

export interface GroveWaitRequest {
  readonly until: 'all' | 'any';
  readonly timeoutMs: number;
  /** Aborted when the lead's MCP request goes away (its turn was cancelled or its process stopped). */
  readonly signal: AbortSignal;
}

/**
 * What the Grove orchestration tools need from the app, for one lead session (Stage 10). The tools
 * own the rules (one permission per session, the helper limit, own helpers only); the host only
 * reads and drives sessions.
 */
export interface GroveToolHost {
  /** The calling session: the lead. */
  readonly sessionId: string;
  agents(): { readonly agents: readonly GroveAgent[]; readonly defaultAgentId: string | null };
  /** Every session of the project, archived ones included. */
  sessions(): readonly GroveSession[];
  /** Running helpers a lead may have at once (`settings.grove.maxChildren`). */
  maxHelpers(): number;
  /** Asks the user, in the lead's thread, whether this session may start helpers. */
  confirmStart(): Promise<boolean>;
  /** Creates a helper of the lead and sends it the task; resolves with its id without waiting for the turn. */
  start(request: GroveStartRequest): Promise<string>;
  /** Sends a prompt to a helper without waiting for the turn. */
  send(sessionId: string, message: string): Promise<void>;
  /** Resolves true once the sessions are settled, false on the timeout, the signal or the lead's turn ending. */
  wait(sessionIds: readonly string[], request: GroveWaitRequest): Promise<boolean>;
  /** The session's latest transcript entries as text, oldest first. Never raw tool input. */
  transcript(sessionId: string, limit: number): readonly string[];
  stop(sessionId: string): Promise<void>;
}
