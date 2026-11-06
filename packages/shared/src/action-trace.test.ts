import { describe, expect, it } from 'vitest';
import { ACTION_TRACE_STEP_LIMIT, pushTraceStep, type ActionTraceStep } from './action-trace.js';

function step(id: string): ActionTraceStep {
  return { id, at: 1, tool: 'browser_click', title: `Click ${id}`, ok: true, error: null, image: null };
}

describe('pushTraceStep', () => {
  it('appends a step', () => {
    expect(pushTraceStep([step('a')], step('b')).map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('drops the oldest step once the limit is passed', () => {
    const steps = Array.from({ length: ACTION_TRACE_STEP_LIMIT }, (_, index) => step(String(index)));
    const next = pushTraceStep(steps, step('new'));
    expect(next).toHaveLength(ACTION_TRACE_STEP_LIMIT);
    expect(next[0]?.id).toBe('1');
    expect(next.at(-1)?.id).toBe('new');
  });
});
