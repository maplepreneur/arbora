import { describe, expect, it } from 'vitest';
import type { AgentModeSelection } from '@arbora/shared';
import { IDLE, inspectorEffect, modeActive, transition, type ModeEvent, type ModeState } from './mode';

const selection = { id: 'sel-1' } as AgentModeSelection;

function run(...events: ModeEvent[]): ModeState {
  return events.reduce(transition, IDLE);
}

describe('mode state machine', () => {
  it('runs idle -> inspecting -> selected -> prompting -> idle', () => {
    expect(run({ type: 'toggleAgent' })).toEqual({ kind: 'agent', phase: 'inspecting' });
    expect(run({ type: 'toggleAgent' }, { type: 'picked' })).toEqual({ kind: 'agent', phase: 'selected' });
    const prompting = run({ type: 'toggleAgent' }, { type: 'picked' }, { type: 'resolved', selection });
    expect(prompting).toEqual({ kind: 'agent', phase: 'prompting', selection });
    expect(transition(prompting, { type: 'submitted' })).toEqual(IDLE);
  });

  it('toggles and exits from every agent phase', () => {
    for (const state of [
      run({ type: 'toggleAgent' }),
      run({ type: 'toggleAgent' }, { type: 'picked' }),
      run({ type: 'toggleAgent' }, { type: 'picked' }, { type: 'resolved', selection }),
    ]) {
      expect(transition(state, { type: 'toggleAgent' })).toEqual(IDLE);
      expect(transition(state, { type: 'exit' })).toEqual(IDLE);
    }
  });

  it('goes back to hovering on failure or repick', () => {
    expect(run({ type: 'toggleAgent' }, { type: 'picked' }, { type: 'failed' })).toEqual({
      kind: 'agent',
      phase: 'inspecting',
    });
    expect(
      run({ type: 'toggleAgent' }, { type: 'picked' }, { type: 'resolved', selection }, { type: 'repick' }),
    ).toEqual({
      kind: 'agent',
      phase: 'inspecting',
    });
  });

  it('ignores events that do not apply', () => {
    expect(run({ type: 'picked' })).toEqual(IDLE);
    expect(run({ type: 'resolved', selection })).toEqual(IDLE);
    expect(run({ type: 'submitted' })).toEqual(IDLE);
    expect(run({ type: 'toggleAgent' }, { type: 'submitted' })).toEqual({ kind: 'agent', phase: 'inspecting' });
    const prompting = run({ type: 'toggleAgent' }, { type: 'resolved', selection });
    expect(transition(prompting, { type: 'resolved', selection: { id: 'other' } as AgentModeSelection })).toBe(
      prompting,
    );
  });

  it('switches to design mode directly from agent mode', () => {
    const design = run({ type: 'toggleAgent' }, { type: 'picked' }, { type: 'toggleDesign' });
    expect(design).toEqual({ kind: 'design', phase: 'editing' });
    expect(transition(design, { type: 'toggleDesign' })).toEqual(IDLE);
    expect(transition(design, { type: 'toggleAgent' })).toEqual({ kind: 'agent', phase: 'inspecting' });
    const confirm = transition(design, { type: 'designConfirm', pending: 'agent' });
    expect(confirm).toEqual({ kind: 'design', phase: 'confirm', pending: 'agent' });
    expect(transition(confirm, { type: 'exit' })).toEqual({ kind: 'design', phase: 'editing' });
    expect(transition(confirm, { type: 'designLeave' })).toEqual(IDLE);
  });

  it('starts and stops the page inspector at the right edges', () => {
    const inspecting = run({ type: 'toggleAgent' });
    const selected = transition(inspecting, { type: 'picked' });
    const prompting = transition(selected, { type: 'resolved', selection });
    expect(inspectorEffect(IDLE, inspecting)).toBe('start');
    expect(inspectorEffect(inspecting, selected)).toBeNull();
    expect(inspectorEffect(selected, prompting)).toBeNull();
    expect(inspectorEffect(prompting, transition(prompting, { type: 'repick' }))).toBe('start');
    expect(inspectorEffect(prompting, IDLE)).toBe('stop');
    expect(inspectorEffect(selected, { kind: 'design', phase: 'editing' })).toBe('stop');
    expect(inspectorEffect(IDLE, { kind: 'design', phase: 'editing' })).toBeNull();
    expect(modeActive(IDLE)).toBe(false);
    expect(modeActive(prompting)).toBe(true);
  });
});
