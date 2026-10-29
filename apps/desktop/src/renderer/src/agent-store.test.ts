import { describe, expect, it } from 'vitest';
import type { ThreadEvent } from '@arbora/shared';
import { applyChanges } from './agent-store';

const message = (id: string, text: string): ThreadEvent => ({
  id,
  at: 1,
  kind: 'agent_message',
  blocks: [{ type: 'text', text }],
});

describe('applyChanges', () => {
  it('appends, replaces in place and resets', () => {
    const a = message('a', 'hello');
    const b = message('b', 'world');
    let events = applyChanges([], [{ type: 'append', event: a }]);
    expect(events).toEqual([a]);
    events = applyChanges(events, [
      { type: 'append', event: b },
      { type: 'replace', index: 0, event: message('a', 'hello!') },
    ]);
    expect(events.map((e) => (e.kind === 'agent_message' ? e.blocks[0] : null))).toEqual([
      { type: 'text', text: 'hello!' },
      { type: 'text', text: 'world' },
    ]);
    events = applyChanges(events, [{ type: 'reset', events: [b] }]);
    expect(events).toEqual([b]);
  });

  it('appends when a replace targets an index that does not exist yet', () => {
    const events = applyChanges([], [{ type: 'replace', index: 3, event: message('x', 'late') }]);
    expect(events).toHaveLength(1);
  });

  it('does not mutate the input', () => {
    const input = [message('a', 'x')];
    applyChanges(input, [{ type: 'append', event: message('b', 'y') }]);
    expect(input).toHaveLength(1);
  });
});
