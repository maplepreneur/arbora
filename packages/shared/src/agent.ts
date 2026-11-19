import { z } from 'zod';

/**
 * Agent panel domain types shared by main and the renderer. Agents run as interactive CLIs in
 * terminal tabs (`terminal-agent.ts`); these schemas cover what crosses Arbora's IPC and is
 * persisted in `.arbora/threads/`.
 */

export const agentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Executable, resolved through the login-shell PATH (`claude`, `codex`, `kimi`, ...). */
  command: z.string().min(1),
  /** Interactive arguments; the bare CLI is the session. */
  args: z.array(z.string()).default([]),
  /** Extra environment for the agent process (values are never logged). */
  env: z.record(z.string(), z.string()).default({}),
  /** How to install or log in when the binary is missing. */
  installHint: z.string().optional(),
  docsUrl: z.string().optional(),
  builtIn: z.boolean().default(false),
  /** Args that print a version and exit, for the sign-in probe. */
  probe: z.array(z.string()).max(20).default(['--version']),
  /** Args that run one prompt non-interactively (the prompt is appended); empty when unsupported. */
  task: z.array(z.string()).max(20).default([]),
});
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

/** Custom agents from settings: the same shape, plus optional probe/task args. */
export const customAgentSchema = agentDefinitionSchema.omit({ builtIn: true }).extend({
  probe: z.array(z.string()).max(20).optional(),
  task: z.array(z.string()).max(20).optional(),
});
export type CustomAgent = z.infer<typeof customAgentSchema>;

export const agentAvailabilitySchema = z.object({
  id: z.string(),
  available: z.boolean(),
  /** Where the executable was found, when it was. */
  resolvedCommand: z.string().optional(),
});
export type AgentAvailability = z.infer<typeof agentAvailabilitySchema>;

// --- Terminal session state ----------------------------------------------------------------------

/**
 * What a thread's agent terminal is doing. Derived from the pty's output, not from a protocol:
 * `needs_input` is a detected question, `working` is output flowing after a prompt.
 */
export const threadStatusSchema = z.enum(['idle', 'starting', 'ready', 'working', 'needs_input', 'error']);
export type ThreadStatus = z.infer<typeof threadStatusSchema>;

export const threadStateSchema = z.object({
  status: threadStatusSchema,
  error: z.string().nullable(),
  /** The terminal running this agent; null when the process is stopped. */
  terminalId: z.string().nullable(),
  /** The last meaningful output line, for rows, summaries and notifications. */
  lastLine: z.string().nullable(),
  /** Wall-clock ms when the current turn started (the prompt was written), null when none. */
  turnStartedAt: z.number().int().nullable(),
  /** Wall-clock ms of the last process output, null when it never printed. */
  lastOutputAt: z.number().int().nullable(),
  /** How long the last finished turn took, null when none ended. */
  lastTurnMs: z.number().int().nullable(),
});
export type ThreadState = z.infer<typeof threadStateSchema>;

export function idleThreadState(): ThreadState {
  return {
    status: 'idle',
    error: null,
    terminalId: null,
    lastLine: null,
    turnStartedAt: null,
    lastOutputAt: null,
    lastTurnMs: null,
  };
}

export const THREAD_FILE_VERSION = 2;

/** A thread's title until its first prompt (or a rename) sets one. */
export const DEFAULT_THREAD_TITLE = 'New thread';

/** Persisted thread metadata (`.arbora/threads/<id>.json` minus `lastLines`). */
export const threadSummarySchema = z.object({
  id: z.string(),
  agentId: z.string(),
  title: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
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

export const threadSchema = threadSummarySchema.extend({
  /** The last lines of the agent's terminal, for rows and a restored session's tail. */
  lastLines: z.array(z.string()).max(200).default([]),
});
export type Thread = z.infer<typeof threadSchema>;

export const threadFileSchema = threadSchema.omit({ state: true }).extend({
  version: z.literal(THREAD_FILE_VERSION),
});
export type ThreadFile = z.infer<typeof threadFileSchema>;

// --- Agent groups --------------------------------------------------------------------------------

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

// --- Attachments ---------------------------------------------------------------------------------

export const attachmentSchema = z.object({
  path: z.string(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  /** Both kinds reach the agent as a path mentioned in the prompt text. */
  kind: z.enum(['image', 'file']),
});
export type Attachment = z.infer<typeof attachmentSchema>;

// --- Arbora's own confirmation cards --------------------------------------------------------------

/**
 * A question Arbora raises itself (browser tools, Grove helper starts) in the thread's pane. The
 * agent's own permission prompts happen inside its terminal and are answered there.
 */
export const confirmationOptionKindSchema = z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always']);
export type ConfirmationOptionKind = z.infer<typeof confirmationOptionKindSchema>;

export const confirmationOptionSchema = z.object({
  optionId: z.string(),
  name: z.string(),
  kind: confirmationOptionKindSchema,
});
export type ConfirmationOption = z.infer<typeof confirmationOptionSchema>;

export const confirmationRequestSchema = z.object({
  requestId: z.string(),
  threadId: z.string(),
  title: z.string().max(300),
  detail: z.string().max(2000),
  options: z.array(confirmationOptionSchema).min(2),
});
export type ConfirmationRequest = z.infer<typeof confirmationRequestSchema>;

export function confirmationOptions(persistent: boolean): ConfirmationOption[] {
  return [
    { optionId: 'allow', name: persistent ? 'Allow this session' : 'Allow', kind: 'allow_once' },
    ...(persistent
      ? [{ optionId: 'allow-always', name: 'Always allow in this project', kind: 'allow_always' as const }]
      : []),
    { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
    ...(persistent
      ? [{ optionId: 'reject-always', name: 'Never in this project', kind: 'reject_always' as const }]
      : []),
  ];
}
