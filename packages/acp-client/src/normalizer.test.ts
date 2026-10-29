import { describe, expect, it } from 'vitest';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { ThreadEvent } from '@arbora/shared';
import { UpdateNormalizer } from './normalizer.js';

function normalizer(events: ThreadEvent[] = []): UpdateNormalizer {
  let id = 0;
  let at = 1000;
  return new UpdateNormalizer({ nextId: () => `e${++id}`, now: () => at++, events });
}

const text = (s: string): { type: 'text'; text: string } => ({ type: 'text', text: s });
const chunk = (
  kind: 'agent_message_chunk' | 'agent_thought_chunk' | 'user_message_chunk',
  s: string,
): SessionUpdate => ({
  sessionUpdate: kind,
  content: text(s),
});

describe('UpdateNormalizer', () => {
  it('coalesces consecutive agent message chunks into one event', () => {
    const n = normalizer();
    const first = n.apply(chunk('agent_message_chunk', 'Hello'));
    const second = n.apply(chunk('agent_message_chunk', ', world'));
    expect(first.changes).toEqual([
      { type: 'append', event: { id: 'e1', at: 1000, kind: 'agent_message', blocks: [text('Hello')] } },
    ]);
    expect(second.changes).toEqual([
      {
        type: 'replace',
        index: 0,
        event: { id: 'e1', at: 1000, kind: 'agent_message', blocks: [text('Hello, world')] },
      },
    ]);
    expect(n.events).toHaveLength(1);
  });

  it('keeps images in agent messages as separate blocks', () => {
    const n = normalizer();
    n.apply(chunk('agent_message_chunk', 'See:'));
    n.apply({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    });
    n.apply(chunk('agent_message_chunk', 'done'));
    expect(n.events[0]).toMatchObject({
      kind: 'agent_message',
      blocks: [text('See:'), { type: 'image', data: 'AAAA', mimeType: 'image/png' }, text('done')],
    });
  });

  it('does not merge chunks across a tool call boundary', () => {
    const n = normalizer();
    n.apply(chunk('agent_message_chunk', 'Before'));
    n.apply({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read file', kind: 'read', status: 'pending' });
    n.apply(chunk('agent_message_chunk', 'After'));
    expect(n.events.map((e) => e.kind)).toEqual(['agent_message', 'tool_call', 'agent_message']);
  });

  it('separates thoughts from messages and coalesces each', () => {
    const n = normalizer();
    n.apply(chunk('agent_thought_chunk', 'thinking'));
    n.apply(chunk('agent_thought_chunk', ' more'));
    n.apply(chunk('agent_message_chunk', 'answer'));
    expect(n.events).toMatchObject([
      { kind: 'agent_thought', text: 'thinking more' },
      { kind: 'agent_message', blocks: [text('answer')] },
    ]);
  });

  it('records tool calls and merges updates in place', () => {
    const n = normalizer();
    n.apply({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Edit App.tsx',
      kind: 'edit',
      status: 'pending',
      locations: [{ path: '/p/src/App.tsx', line: 3 }],
      rawInput: { path: '/p/src/App.tsx' },
    });
    const result = n.apply({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
      content: [{ type: 'diff', path: '/p/src/App.tsx', oldText: 'a', newText: 'b' }],
    });
    expect(result.changes).toEqual([
      {
        type: 'replace',
        index: 0,
        event: {
          id: 'e1',
          at: 1000,
          kind: 'tool_call',
          toolCallId: 't1',
          title: 'Edit App.tsx',
          toolKind: 'edit',
          status: 'completed',
          content: [{ type: 'diff', path: '/p/src/App.tsx', oldText: 'a', newText: 'b' }],
          locations: [{ path: '/p/src/App.tsx', line: 3 }],
          rawInput: { path: '/p/src/App.tsx' },
        },
      },
    ]);
  });

  it('creates a tool call from an update for an unknown id', () => {
    const n = normalizer();
    n.apply({ sessionUpdate: 'tool_call_update', toolCallId: 'ghost', status: 'in_progress' });
    expect(n.events[0]).toMatchObject({
      kind: 'tool_call',
      toolCallId: 'ghost',
      title: 'Tool call',
      toolKind: 'other',
    });
  });

  it('defaults missing tool call fields', () => {
    const n = normalizer();
    n.apply({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Run' });
    expect(n.events[0]).toMatchObject({ toolKind: 'other', status: 'pending', content: [], locations: [] });
  });

  it('replaces the plan within a turn and appends a new one after a turn ends', () => {
    const n = normalizer();
    n.apply({ sessionUpdate: 'plan', entries: [{ content: 'a', priority: 'high', status: 'pending' }] });
    const update = n.apply({
      sessionUpdate: 'plan',
      entries: [{ content: 'a', priority: 'high', status: 'completed' }],
    });
    expect(update.changes[0]).toMatchObject({ type: 'replace', index: 0 });
    n.turnEnded('end_turn');
    n.apply({ sessionUpdate: 'plan', entries: [{ content: 'b', priority: 'low', status: 'pending' }] });
    expect(n.events.map((e) => e.kind)).toEqual(['plan', 'turn_end', 'plan']);
  });

  it('turns commands, mode, config options and title into state updates, not events', () => {
    const n = normalizer();
    const commands = n.apply({
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: 'help', description: 'Show help' }],
    });
    const mode = n.apply({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' });
    const config = n.apply({
      sessionUpdate: 'config_option_update',
      configOptions: [
        {
          type: 'select',
          id: 'model',
          name: 'Model',
          category: 'model',
          currentValue: 'fast',
          options: [{ value: 'fast', name: 'Fast' }],
        },
      ],
    });
    const title = n.apply({ sessionUpdate: 'session_info_update', title: 'Add a comment' });
    expect(commands).toEqual({
      changes: [],
      state: [{ type: 'availableCommands', commands: [{ name: 'help', description: 'Show help' }] }],
    });
    expect(mode.state).toEqual([{ type: 'currentMode', modeId: 'plan' }]);
    expect(config.state[0]).toMatchObject({ type: 'configOptions' });
    expect(title.state).toEqual([{ type: 'title', title: 'Add a comment' }]);
    expect(n.events).toEqual([]);
  });

  it('ignores usage and compaction updates and unknown variants', () => {
    const n = normalizer();
    expect(n.apply({ sessionUpdate: 'usage_update', used: 1, size: 2 })).toEqual({ changes: [], state: [] });
    expect(n.apply({ sessionUpdate: '_vendor_thing', foo: 1 } as unknown as SessionUpdate)).toEqual({
      changes: [],
      state: [],
    });
  });

  it('records notices as events', () => {
    const n = normalizer();
    n.apply({ sessionUpdate: 'notice', severity: 'warning', title: 'Context nearly full' });
    expect(n.events[0]).toMatchObject({ kind: 'notice', severity: 'warning', title: 'Context nearly full' });
  });

  it('drops the user message echo that follows a prompt it already recorded', () => {
    const n = normalizer();
    n.userMessage([text('do it')]);
    const echo = n.apply(chunk('user_message_chunk', 'do it'));
    expect(echo.changes).toEqual([]);
    n.apply(chunk('agent_message_chunk', 'ok'));
    // A replayed history (session/load) has no preceding local prompt, so it is kept.
    const replay = n.apply(chunk('user_message_chunk', 'next question'));
    expect(replay.changes[0]).toMatchObject({ type: 'append', event: { kind: 'user_message' } });
  });

  it('appends permission requests and resolves them in place', () => {
    const n = normalizer();
    n.permissionRequested('r1', {
      sessionId: 's',
      toolCall: { toolCallId: 't1', title: 'Write file', kind: 'edit', rawInput: { path: '/p/x' } },
      options: [
        { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
        { optionId: 'no', name: 'Reject', kind: 'reject_once' },
      ],
    });
    expect(n.events[0]).toMatchObject({ kind: 'permission', requestId: 'r1', toolKind: 'edit', outcome: null });
    const resolved = n.permissionResolved('r1', { optionId: 'yes', auto: false });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      type: 'replace',
      index: 0,
      event: { outcome: { optionId: 'yes', auto: false } },
    });
    expect(n.permissionResolved('missing', 'cancelled')).toEqual([]);
  });

  it('continues an existing transcript with fresh ids and tool index', () => {
    const existing: ThreadEvent[] = [
      {
        id: 'old',
        at: 1,
        kind: 'tool_call',
        toolCallId: 't1',
        title: 'Old',
        toolKind: 'read',
        status: 'in_progress',
        content: [],
        locations: [],
      },
    ];
    const n = normalizer(existing);
    n.apply({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
    expect(n.events[0]).toMatchObject({ id: 'old', status: 'completed' });
    n.apply(chunk('agent_message_chunk', 'x'));
    expect(n.events[1]?.id).toBe('e1');
  });

  it('records errors and turn ends', () => {
    const n = normalizer();
    n.error('agent exited with code 1');
    n.turnEnded('cancelled');
    expect(n.events).toMatchObject([
      { kind: 'error', message: 'agent exited with code 1' },
      { kind: 'turn_end', stopReason: 'cancelled' },
    ]);
  });
});
