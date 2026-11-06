import { describe, expect, it } from 'vitest';
import { ACTION_TRACE_STEP_LIMIT, matchingDesignView, pushTraceStep, type ActionTraceStep } from './action-trace.js';

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

describe('matchingDesignView', () => {
  const shot = (data: string): ActionTraceStep['image'] => ({ data, mimeType: 'image/png', width: 2, height: 2 });
  const compare = (id: string, title: string, path: string, data: string): ActionTraceStep => ({
    id,
    at: 1,
    tool: 'browser_compare',
    title,
    ok: true,
    error: null,
    image: shot(data),
    path,
  });

  it('shows the latest side-by-side and the saved round', () => {
    const view = matchingDesignView([
      step('click'),
      compare('a', 'Matching design · 0.40 · side by side', '.arbora/screenshots/t/round-1.png', 'side'),
      compare('b', 'Matching design · 0.95 · diff', '.arbora/screenshots/t/round-2.png', 'diff'),
    ]);
    expect(view).toMatchObject({
      round: 2,
      path: '.arbora/screenshots/t/round-2.png',
      image: shot('side'),
    });
    expect(view?.scores).toContain('0.40');
    expect(view?.scores).toContain('0.95');
  });

  it('is absent when the trace has no compare', () => {
    expect(matchingDesignView([step('click')])).toBeNull();
  });
});
