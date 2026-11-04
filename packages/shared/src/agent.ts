import { z } from 'zod';

/**
 * Agent panel domain types shared by main and the renderer. The ACP wire types live in
 * `@agentclientprotocol/sdk`; these zod schemas cover the subset that crosses Arbora's IPC and is
 * persisted in `.arbora/threads/`.
 */

const meta = z.record(z.string(), z.unknown()).nullable().optional();

export const agentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Executable, resolved through the login-shell PATH (`npx`, `kimi`, `grok`, ...). */
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  /** Extra environment for the agent process (values are redacted in the log viewer). */
  env: z.record(z.string(), z.string()).default({}),
  /** How to install or log in when the binary is missing or authentication fails. */
  installHint: z.string().optional(),
  docsUrl: z.string().optional(),
  builtIn: z.boolean().default(false),
});
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

/** Custom agents from settings: the same shape as Zed's `agent_servers` entries. */
export const customAgentSchema = agentDefinitionSchema.omit({ builtIn: true });
export type CustomAgent = z.infer<typeof customAgentSchema>;

export const agentAvailabilitySchema = z.object({
  id: z.string(),
  available: z.boolean(),
  /** Where the executable was found, when it was. */
  resolvedCommand: z.string().optional(),
});
export type AgentAvailability = z.infer<typeof agentAvailabilitySchema>;

// --- ACP content (mirrors the SDK's stable v1 types) -------------------------------------------

export const textContentSchema = z.object({ type: z.literal('text'), text: z.string(), _meta: meta });
export const imageContentSchema = z.object({
  type: z.literal('image'),
  data: z.string(),
  mimeType: z.string(),
  uri: z.string().nullable().optional(),
  _meta: meta,
});
export const audioContentSchema = z.object({
  type: z.literal('audio'),
  data: z.string(),
  mimeType: z.string(),
  _meta: meta,
});
export const resourceLinkSchema = z.object({
  type: z.literal('resource_link'),
  uri: z.string(),
  name: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  size: z.number().nullable().optional(),
  _meta: meta,
});
export const embeddedResourceSchema = z.object({
  type: z.literal('resource'),
  resource: z.union([
    z.object({ uri: z.string(), text: z.string(), mimeType: z.string().nullable().optional() }),
    z.object({ uri: z.string(), blob: z.string(), mimeType: z.string().nullable().optional() }),
  ]),
  _meta: meta,
});
export const contentBlockSchema = z.discriminatedUnion('type', [
  textContentSchema,
  imageContentSchema,
  audioContentSchema,
  resourceLinkSchema,
  embeddedResourceSchema,
]);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export const toolKindSchema = z.enum([
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'switch_mode',
  'other',
]);
export type ToolKind = z.infer<typeof toolKindSchema>;

export const toolCallStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed']);
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;

export const diffSchema = z.object({
  path: z.string(),
  oldText: z.string().nullable().optional(),
  newText: z.string(),
});
export type DiffContent = z.infer<typeof diffSchema>;

export const toolCallContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('content'), content: contentBlockSchema }),
  diffSchema.extend({ type: z.literal('diff') }),
  z.object({ type: z.literal('terminal'), terminalId: z.string() }),
]);
export type ToolCallContent = z.infer<typeof toolCallContentSchema>;

export const toolCallLocationSchema = z.object({ path: z.string(), line: z.number().nullable().optional() });
export type ToolCallLocation = z.infer<typeof toolCallLocationSchema>;

export const permissionOptionKindSchema = z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always']);
export type PermissionOptionKind = z.infer<typeof permissionOptionKindSchema>;

export const permissionOptionSchema = z.object({
  optionId: z.string(),
  name: z.string(),
  kind: permissionOptionKindSchema,
});
export type PermissionOption = z.infer<typeof permissionOptionSchema>;

export const planEntrySchema = z.object({
  content: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  status: z.enum(['pending', 'in_progress', 'completed']),
});
export type PlanEntry = z.infer<typeof planEntrySchema>;

export const availableCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  input: z.object({ hint: z.string() }).nullable().optional(),
});
export type AvailableCommand = z.infer<typeof availableCommandSchema>;

export const sessionModeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
});
export const sessionModeStateSchema = z.object({
  currentModeId: z.string(),
  availableModes: z.array(sessionModeSchema),
});
export type SessionModeState = z.infer<typeof sessionModeStateSchema>;

const configSelectOptionSchema = z.object({
  value: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
});
/** `session/set_config_option` choices; the `model` category is the model picker. */
export const sessionConfigOptionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('select'),
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    currentValue: z.string(),
    options: z.union([
      z.array(configSelectOptionSchema),
      z.array(z.object({ group: z.string(), name: z.string(), options: z.array(configSelectOptionSchema) })),
    ]),
  }),
  z.object({
    type: z.literal('boolean'),
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    currentValue: z.boolean(),
  }),
]);
export type SessionConfigOption = z.infer<typeof sessionConfigOptionSchema>;

export const authMethodSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
});
export type AuthMethod = z.infer<typeof authMethodSchema>;

export const stopReasonSchema = z.enum(['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled']);
export type StopReason = z.infer<typeof stopReasonSchema>;

// --- Normalised thread events -------------------------------------------------------------------

const eventBase = { id: z.string(), at: z.number().int() };

export const toolCallEventSchema = z.object({
  ...eventBase,
  kind: z.literal('tool_call'),
  toolCallId: z.string(),
  title: z.string(),
  toolKind: toolKindSchema,
  status: toolCallStatusSchema,
  content: z.array(toolCallContentSchema),
  locations: z.array(toolCallLocationSchema),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
});
export type ToolCallEvent = z.infer<typeof toolCallEventSchema>;

export const permissionEventSchema = z.object({
  ...eventBase,
  kind: z.literal('permission'),
  /** Correlates the renderer's answer with the pending `session/request_permission`. */
  requestId: z.string(),
  toolCallId: z.string(),
  title: z.string(),
  toolKind: toolKindSchema,
  options: z.array(permissionOptionSchema),
  locations: z.array(toolCallLocationSchema),
  rawInput: z.unknown().optional(),
  /** `null` while the request is pending; `cancelled` when the agent withdrew it. */
  outcome: z.union([z.literal('cancelled'), z.object({ optionId: z.string(), auto: z.boolean() })]).nullable(),
});
export type PermissionEvent = z.infer<typeof permissionEventSchema>;

/**
 * One entry of a thread's transcript. Message chunks of the same kind are coalesced into the
 * preceding event until something else (a tool call, a thought, a turn end) interrupts them.
 */
export const threadEventSchema = z.discriminatedUnion('kind', [
  z.object({ ...eventBase, kind: z.literal('user_message'), blocks: z.array(contentBlockSchema) }),
  z.object({ ...eventBase, kind: z.literal('agent_message'), blocks: z.array(contentBlockSchema) }),
  z.object({ ...eventBase, kind: z.literal('agent_thought'), text: z.string() }),
  toolCallEventSchema,
  permissionEventSchema,
  z.object({ ...eventBase, kind: z.literal('plan'), entries: z.array(planEntrySchema) }),
  z.object({ ...eventBase, kind: z.literal('turn_end'), stopReason: stopReasonSchema }),
  z.object({
    ...eventBase,
    kind: z.literal('notice'),
    severity: z.enum(['info', 'warning', 'error']),
    title: z.string(),
    description: z.string().nullable().optional(),
  }),
  z.object({ ...eventBase, kind: z.literal('error'), message: z.string() }),
  /**
   * A screenshot the agent took with Arbora's browser tools, shown as a thumbnail. The agent's own
   * `tool_call` card stays the record of the call; this only adds what the agent saw.
   */
  z.object({
    ...eventBase,
    kind: z.literal('browser_preview'),
    title: z.string(),
    image: z.object({ data: z.string(), mimeType: z.string(), width: z.number(), height: z.number() }),
    /** The full-size capture under `.arbora/screenshots/`, when saved. */
    path: z.string().nullable(),
  }),
]);
export type ThreadEvent = z.infer<typeof threadEventSchema>;
export type ThreadEventKind = ThreadEvent['kind'];

/** Incremental transcript updates; `replace` targets an existing index (tool status, chunks). */
export const threadChangeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('append'), event: threadEventSchema }),
  z.object({ type: z.literal('replace'), index: z.number().int().min(0), event: threadEventSchema }),
  z.object({ type: z.literal('reset'), events: z.array(threadEventSchema) }),
]);
export type ThreadChange = z.infer<typeof threadChangeSchema>;

export const threadStatusSchema = z.enum([
  /** No agent process yet (new or restored thread). */
  'idle',
  'starting',
  /** The agent asked for `authenticate`; `authMethods` lists the choices. */
  'auth_required',
  'ready',
  'prompting',
  /** Process crashed or a request failed; `error` has the message. */
  'error',
]);
export type ThreadStatus = z.infer<typeof threadStatusSchema>;

export const threadStateSchema = z.object({
  status: threadStatusSchema,
  error: z.string().nullable(),
  authMethods: z.array(authMethodSchema),
  modes: sessionModeStateSchema.nullable(),
  configOptions: z.array(sessionConfigOptionSchema),
  availableCommands: z.array(availableCommandSchema),
  /** From `initialize`; null until the agent answered. */
  capabilities: z
    .object({
      loadSession: z.boolean(),
      resume: z.boolean(),
      image: z.boolean(),
      embeddedContext: z.boolean(),
    })
    .nullable(),
  /** Set when a restored thread could not be loaded/resumed and started a fresh ACP session. */
  contextLost: z.boolean(),
});
export type ThreadState = z.infer<typeof threadStateSchema>;

export function idleThreadState(): ThreadState {
  return {
    status: 'idle',
    error: null,
    authMethods: [],
    modes: null,
    configOptions: [],
    availableCommands: [],
    capabilities: null,
    contextLost: false,
  };
}

export const THREAD_FILE_VERSION = 1;

/** A thread's title until its first prompt (or a rename) sets one. */
export const DEFAULT_THREAD_TITLE = 'New thread';

/** Persisted thread metadata (`.arbora/threads/<id>.json` minus `events`). */
export const threadSummarySchema = z.object({
  id: z.string(),
  agentId: z.string(),
  title: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  /** The agent's session id, for `session/load` / `session/resume`. */
  sessionId: z.string().nullable(),
  /** Skip permission prompts for `edit`/`delete`/`move` tool calls inside the project. */
  autoApproveEdits: z.boolean(),
  /** Agent group (`.arbora/agent-groups.json`); null or an unknown id is ungrouped. */
  groupId: z.string().nullable().default(null),
  /** Pinned threads stay at the top of the list. */
  pinned: z.boolean().default(false),
  /** When the thread moved to Grove's Recent; null while it is listed. */
  archivedAt: z.number().int().nullable().default(null),
  /** The lead session that started this one as a helper (Grove orchestration). */
  parentThreadId: z.string().nullable().default(null),
  state: threadStateSchema,
});
export type ThreadSummary = z.infer<typeof threadSummarySchema>;

export const threadSchema = threadSummarySchema.extend({ events: z.array(threadEventSchema) });
export type Thread = z.infer<typeof threadSchema>;

export const threadFileSchema = threadSchema.omit({ state: true }).extend({ version: z.literal(THREAD_FILE_VERSION) });
export type ThreadFile = z.infer<typeof threadFileSchema>;

/** Raw JSON-RPC traffic and agent stderr, redacted, for the ACP log viewer. */
export const acpLogEntrySchema = z.object({
  id: z.number().int(),
  at: z.number().int(),
  direction: z.enum(['in', 'out', 'stderr', 'info']),
  /** JSON-RPC message (redacted) or a stderr/info line. */
  message: z.unknown(),
});
export type AcpLogEntry = z.infer<typeof acpLogEntrySchema>;

/** Remembered "always" permission answers: `${agentId}:${toolKind}` -> allow or reject. */
export const rememberedPermissionsSchema = z.record(z.string(), z.enum(['allow', 'reject']));
export type RememberedPermissions = z.infer<typeof rememberedPermissionsSchema>;

export function permissionMemoryKey(agentId: string, toolKind: ToolKind): string {
  return `${agentId}:${toolKind}`;
}

/** Tool kinds that only touch files; `autoApproveEdits` answers these without asking. */
export const EDIT_TOOL_KINDS: ReadonlySet<ToolKind> = new Set<ToolKind>(['edit', 'delete', 'move']);

/** Per-thread persistence cap (the in-memory transcript for the current session is not capped). */
export const THREAD_FILE_BYTE_LIMIT = 2 * 1024 * 1024;
/** Tool content longer than this is truncated before persistence. */
export const PERSISTED_TOOL_TEXT_LIMIT = 64 * 1024;
/** Entries kept per thread for the ACP log viewer. */
export const ACP_LOG_LIMIT = 2000;

export const AGENT_GROUP_COLORS = ['green', 'blue', 'purple', 'pink', 'orange', 'yellow', 'gray'] as const;

/** A named set of threads in one project ("Frontend", "Refactor"), like a Herdr herd or a Solo stack. */
export const agentGroupSchema = z.object({
  id: z
    .string()
    .regex(/^[\w-]+$/)
    .max(64),
  name: z.string().min(1).max(100),
  color: z.enum(AGENT_GROUP_COLORS).default('gray'),
  collapsed: z.boolean().default(false),
});
export type AgentGroup = z.infer<typeof agentGroupSchema>;

export const agentGroupsFileSchema = z.object({
  version: z.literal(1).default(1),
  groups: z.array(agentGroupSchema).max(100).default([]),
});

/** One section of the thread list: pinned threads, then each group, then the rest. */
export interface ThreadSection<T extends { groupId: string | null; pinned: boolean }> {
  readonly id: string;
  readonly group: AgentGroup | null;
  readonly title: string;
  readonly threads: readonly T[];
}

export function threadSections<T extends { groupId: string | null; pinned: boolean }>(
  threads: readonly T[],
  groups: readonly AgentGroup[],
): ThreadSection<T>[] {
  const known = new Set(groups.map((g) => g.id));
  const sections: ThreadSection<T>[] = [];
  const pinned = threads.filter((t) => t.pinned);
  if (pinned.length > 0) sections.push({ id: 'pinned', group: null, title: 'Pinned', threads: pinned });
  for (const group of groups) {
    sections.push({
      id: `group:${group.id}`,
      group,
      title: group.name,
      threads: threads.filter((t) => !t.pinned && t.groupId === group.id),
    });
  }
  const rest = threads.filter((t) => !t.pinned && (t.groupId === null || !known.has(t.groupId)));
  if (rest.length > 0 || sections.length === 0) {
    sections.push({ id: 'threads', group: null, title: groups.length > 0 ? 'Ungrouped' : 'Threads', threads: rest });
  }
  return sections;
}

export const attachmentSchema = z.object({
  path: z.string(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  /** Images become `image` blocks (when the agent supports them); other files `resource_link`s. */
  kind: z.enum(['image', 'file']),
});
export type Attachment = z.infer<typeof attachmentSchema>;
