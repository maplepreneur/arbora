import type {
  ContentBlock as AcpContentBlock,
  RequestPermissionRequest,
  SessionUpdate,
  ToolCallContent as AcpToolCallContent,
} from '@agentclientprotocol/sdk';
import {
  availableCommandSchema,
  contentBlockSchema,
  sessionConfigOptionSchema,
  toolCallContentSchema,
  toolCallLocationSchema,
  type AvailableCommand,
  type ContentBlock,
  type PermissionEvent,
  type PermissionOption,
  type SessionConfigOption,
  type StopReason,
  type ThreadChange,
  type ThreadEvent,
  type ToolCallContent,
  type ToolCallEvent,
  type ToolCallLocation,
  type ToolKind,
} from '@arbora/shared';

/** Session-level facts carried by `session/update` that are not transcript entries. */
export type StateUpdate =
  | { type: 'availableCommands'; commands: AvailableCommand[] }
  | { type: 'currentMode'; modeId: string }
  | { type: 'configOptions'; options: SessionConfigOption[] }
  | { type: 'title'; title: string };

export interface NormalizedUpdate {
  readonly changes: ThreadChange[];
  readonly state: StateUpdate[];
}

export interface UpdateNormalizerOptions {
  readonly nextId: () => string;
  readonly now: () => number;
  /** Existing transcript to continue (a restored thread). Mutated in place. */
  readonly events?: ThreadEvent[];
}

const NONE: NormalizedUpdate = { changes: [], state: [] };

/**
 * Turns ACP `session/update` notifications into a flat transcript. Consecutive message chunks of
 * one kind are coalesced into the open event; any other event closes it, so text never merges
 * across a tool call. Tool call updates and permission answers replace their event in place.
 */
export class UpdateNormalizer {
  readonly events: ThreadEvent[];
  private readonly toolIndex = new Map<string, number>();
  private readonly permissionIndex = new Map<string, number>();
  /** Index of the event that can still absorb chunks, or -1. */
  private open = -1;
  private planIndex = -1;
  /** Set after a local prompt so the agent's echo of it (`user_message_chunk`) is dropped once. */
  private expectUserEcho = false;

  constructor(private readonly options: UpdateNormalizerOptions) {
    this.events = options.events ?? [];
    this.events.forEach((event, index) => {
      if (event.kind === 'tool_call') this.toolIndex.set(event.toolCallId, index);
      if (event.kind === 'permission') this.permissionIndex.set(event.requestId, index);
    });
  }

  apply(update: SessionUpdate): NormalizedUpdate {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        this.expectUserEcho = false;
        return { changes: this.appendMessageChunk('agent_message', update.content), state: [] };
      case 'agent_thought_chunk': {
        this.expectUserEcho = false;
        return { changes: this.appendThoughtChunk(update.content), state: [] };
      }
      case 'user_message_chunk': {
        if (this.expectUserEcho) {
          return NONE;
        }
        return { changes: this.appendMessageChunk('user_message', update.content), state: [] };
      }
      case 'tool_call': {
        this.expectUserEcho = false;
        const existing = this.toolIndex.get(update.toolCallId);
        if (existing !== undefined) {
          return { changes: this.mergeToolCall(existing, update), state: [] };
        }
        const event: ToolCallEvent = {
          id: this.options.nextId(),
          at: this.options.now(),
          kind: 'tool_call',
          toolCallId: update.toolCallId,
          title: update.title,
          toolKind: update.kind ?? 'other',
          status: update.status ?? 'pending',
          content: toolContent(update.content),
          locations: toolLocations(update.locations),
          ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
          ...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}),
        };
        this.toolIndex.set(update.toolCallId, this.events.length);
        return { changes: [this.append(event)], state: [] };
      }
      case 'tool_call_update': {
        this.expectUserEcho = false;
        const existing = this.toolIndex.get(update.toolCallId);
        if (existing === undefined) {
          const event: ToolCallEvent = {
            id: this.options.nextId(),
            at: this.options.now(),
            kind: 'tool_call',
            toolCallId: update.toolCallId,
            title: update.title ?? 'Tool call',
            toolKind: update.kind ?? 'other',
            status: update.status ?? 'pending',
            content: toolContent(update.content ?? undefined),
            locations: toolLocations(update.locations ?? undefined),
            ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
            ...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}),
          };
          this.toolIndex.set(update.toolCallId, this.events.length);
          return { changes: [this.append(event)], state: [] };
        }
        return { changes: this.mergeToolCall(existing, update), state: [] };
      }
      case 'plan': {
        this.expectUserEcho = false;
        const entries = update.entries.map((e) => ({ content: e.content, priority: e.priority, status: e.status }));
        if (this.planIndex !== -1) {
          const current = this.events[this.planIndex];
          if (current?.kind === 'plan') {
            const event: ThreadEvent = { ...current, entries };
            this.events[this.planIndex] = event;
            return { changes: [{ type: 'replace', index: this.planIndex, event }], state: [] };
          }
        }
        this.planIndex = this.events.length;
        const event: ThreadEvent = { id: this.options.nextId(), at: this.options.now(), kind: 'plan', entries };
        return { changes: [this.append(event)], state: [] };
      }
      case 'available_commands_update':
        return {
          changes: [],
          state: [
            {
              type: 'availableCommands',
              commands: update.availableCommands.flatMap((c) => {
                const parsed = availableCommandSchema.safeParse(c);
                return parsed.success ? [parsed.data] : [];
              }),
            },
          ],
        };
      case 'current_mode_update':
        return { changes: [], state: [{ type: 'currentMode', modeId: update.currentModeId }] };
      case 'config_option_update':
        return {
          changes: [],
          state: [
            {
              type: 'configOptions',
              options: update.configOptions.flatMap((o) => {
                const parsed = sessionConfigOptionSchema.safeParse(o);
                return parsed.success ? [parsed.data] : [];
              }),
            },
          ],
        };
      case 'session_info_update':
        return update.title ? { changes: [], state: [{ type: 'title', title: update.title }] } : NONE;
      case 'notice': {
        const severity =
          update.severity === 'error' || update.severity === 'warning' || update.severity === 'info'
            ? update.severity
            : 'info';
        const event: ThreadEvent = {
          id: this.options.nextId(),
          at: this.options.now(),
          kind: 'notice',
          severity,
          title: update.title,
          ...(update.description !== undefined ? { description: update.description } : {}),
        };
        return { changes: [this.append(event)], state: [] };
      }
      case 'usage_update':
      case 'compaction_update':
      case 'compaction_summary_chunk':
        return NONE;
      default: {
        // Agents may send variants from newer protocol versions; ignore them.
        const unknown: never = update;
        return ignoreUnknownUpdate(unknown);
      }
    }
  }

  /** The prompt Arbora sends; recorded locally before the agent streams its reply. */
  userMessage(blocks: ContentBlock[]): ThreadChange[] {
    this.expectUserEcho = true;
    const event: ThreadEvent = { id: this.options.nextId(), at: this.options.now(), kind: 'user_message', blocks };
    return [this.append(event)];
  }

  permissionRequested(requestId: string, request: RequestPermissionRequest): ThreadChange[] {
    const { toolCall } = request;
    const known = this.toolIndex.get(toolCall.toolCallId);
    const knownEvent = known !== undefined ? this.events[known] : undefined;
    const base = knownEvent?.kind === 'tool_call' ? knownEvent : undefined;
    const options: PermissionOption[] = request.options.map((o) => ({
      optionId: o.optionId,
      name: o.name,
      kind: o.kind,
    }));
    const event: PermissionEvent = {
      id: this.options.nextId(),
      at: this.options.now(),
      kind: 'permission',
      requestId,
      toolCallId: toolCall.toolCallId,
      title: toolCall.title ?? base?.title ?? 'Tool call',
      toolKind: toolCall.kind ?? base?.toolKind ?? 'other',
      options,
      locations: toolCall.locations ? toolLocations(toolCall.locations) : (base?.locations ?? []),
      ...(toolCall.rawInput !== undefined
        ? { rawInput: toolCall.rawInput }
        : base?.rawInput !== undefined
          ? { rawInput: base.rawInput }
          : {}),
      outcome: null,
    };
    this.permissionIndex.set(requestId, this.events.length);
    return [this.append(event)];
  }

  permissionResolved(requestId: string, outcome: PermissionEvent['outcome']): ThreadChange[] {
    const index = this.permissionIndex.get(requestId);
    const current = index !== undefined ? this.events[index] : undefined;
    if (index === undefined || current?.kind !== 'permission') return [];
    const event: ThreadEvent = { ...current, outcome };
    this.events[index] = event;
    return [{ type: 'replace', index, event }];
  }

  turnEnded(stopReason: StopReason): ThreadChange[] {
    this.expectUserEcho = false;
    this.planIndex = -1;
    const event: ThreadEvent = { id: this.options.nextId(), at: this.options.now(), kind: 'turn_end', stopReason };
    return [this.append(event)];
  }

  error(message: string): ThreadChange[] {
    this.expectUserEcho = false;
    const event: ThreadEvent = { id: this.options.nextId(), at: this.options.now(), kind: 'error', message };
    return [this.append(event)];
  }

  /** A screenshot the agent took through Arbora's browser tools (shown next to its tool card). */
  browserPreview(
    preview: Omit<Extract<ThreadEvent, { kind: 'browser_preview' }>, 'id' | 'at' | 'kind'>,
  ): ThreadChange[] {
    const event: ThreadEvent = {
      id: this.options.nextId(),
      at: this.options.now(),
      kind: 'browser_preview',
      ...preview,
    };
    return [this.append(event)];
  }

  /** Tool kind of a known tool call, for permission memory when the request omits it. */
  toolKindOf(toolCallId: string): ToolKind | undefined {
    return this.toolCall(toolCallId)?.toolKind;
  }

  /** Locations announced for a known tool call; permission requests often omit them. */
  toolLocationsOf(toolCallId: string): readonly ToolCallLocation[] {
    return this.toolCall(toolCallId)?.locations ?? [];
  }

  private toolCall(toolCallId: string): ToolCallEvent | undefined {
    const index = this.toolIndex.get(toolCallId);
    const event = index !== undefined ? this.events[index] : undefined;
    return event?.kind === 'tool_call' ? event : undefined;
  }

  private append(event: ThreadEvent): ThreadChange {
    this.open = -1;
    this.events.push(event);
    return { type: 'append', event };
  }

  private appendMessageChunk(kind: 'agent_message' | 'user_message', raw: AcpContentBlock): ThreadChange[] {
    const parsed = contentBlockSchema.safeParse(raw);
    if (!parsed.success) return [];
    const block = parsed.data;
    const current = this.open !== -1 ? this.events[this.open] : undefined;
    if (current?.kind === kind) {
      const blocks = [...current.blocks];
      const last = blocks[blocks.length - 1];
      if (block.type === 'text' && last?.type === 'text') {
        blocks[blocks.length - 1] = { ...last, text: last.text + block.text };
      } else {
        blocks.push(block);
      }
      const event: ThreadEvent = { ...current, blocks };
      this.events[this.open] = event;
      return [{ type: 'replace', index: this.open, event }];
    }
    const event: ThreadEvent = { id: this.options.nextId(), at: this.options.now(), kind, blocks: [block] };
    const index = this.events.length;
    this.events.push(event);
    this.open = index;
    return [{ type: 'append', event }];
  }

  private appendThoughtChunk(raw: AcpContentBlock): ThreadChange[] {
    const text = raw.type === 'text' ? raw.text : '';
    if (!text) return [];
    const current = this.open !== -1 ? this.events[this.open] : undefined;
    if (current?.kind === 'agent_thought') {
      const event: ThreadEvent = { ...current, text: current.text + text };
      this.events[this.open] = event;
      return [{ type: 'replace', index: this.open, event }];
    }
    const event: ThreadEvent = { id: this.options.nextId(), at: this.options.now(), kind: 'agent_thought', text };
    const index = this.events.length;
    this.events.push(event);
    this.open = index;
    return [{ type: 'append', event }];
  }

  private mergeToolCall(
    index: number,
    update: {
      title?: string | null;
      kind?: ToolKind | null;
      status?: ToolCallEvent['status'] | null;
      content?: AcpToolCallContent[] | null;
      locations?: { path: string; line?: number | null }[] | null;
      rawInput?: unknown;
      rawOutput?: unknown;
    },
  ): ThreadChange[] {
    const current = this.events[index];
    if (current?.kind !== 'tool_call') return [];
    this.open = -1;
    const event: ToolCallEvent = {
      ...current,
      ...(update.title != null ? { title: update.title } : {}),
      ...(update.kind != null ? { toolKind: update.kind } : {}),
      ...(update.status != null ? { status: update.status } : {}),
      ...(update.content != null ? { content: toolContent(update.content) } : {}),
      ...(update.locations != null ? { locations: toolLocations(update.locations) } : {}),
      ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
      ...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}),
    };
    this.events[index] = event;
    return [{ type: 'replace', index, event }];
  }
}

function ignoreUnknownUpdate(_update: never): NormalizedUpdate {
  return NONE;
}

function toolContent(content: AcpToolCallContent[] | undefined): ToolCallContent[] {
  if (!content) return [];
  return content.flatMap((item) => {
    const parsed = toolCallContentSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function toolLocations(locations: { path: string; line?: number | null }[] | undefined): ToolCallLocation[] {
  if (!locations) return [];
  return locations.flatMap((item) => {
    const parsed = toolCallLocationSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
