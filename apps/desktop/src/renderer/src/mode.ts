import type { AgentModeSelection } from '@arbora/shared';

/**
 * The app's interaction mode. Agent mode runs `inspecting -> selected -> prompting -> idle`:
 * hovering the page, waiting for main to capture and resolve the click, then the prompt popover.
 * Design mode (Stage 6) is entered from any of them without going through idle.
 */
export type ModeState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'agent'; readonly phase: 'inspecting' }
  | { readonly kind: 'agent'; readonly phase: 'selected' }
  | { readonly kind: 'agent'; readonly phase: 'prompting'; readonly selection: AgentModeSelection }
  | { readonly kind: 'design' };

export type ModeEvent =
  | { readonly type: 'toggleAgent' }
  | { readonly type: 'toggleDesign' }
  | { readonly type: 'exit' }
  /** The page reported a click; main is capturing it. */
  | { readonly type: 'picked' }
  | { readonly type: 'resolved'; readonly selection: AgentModeSelection }
  /** Capturing or resolving the selection failed; hover again. */
  | { readonly type: 'failed' }
  | { readonly type: 'repick' }
  | { readonly type: 'submitted' };

export const IDLE: ModeState = { kind: 'idle' };
const INSPECTING: ModeState = { kind: 'agent', phase: 'inspecting' };

export function transition(state: ModeState, event: ModeEvent): ModeState {
  switch (event.type) {
    case 'toggleAgent':
      return state.kind === 'agent' ? IDLE : INSPECTING;
    case 'toggleDesign':
      return state.kind === 'design' ? IDLE : { kind: 'design' };
    case 'exit':
      return state.kind === 'idle' ? state : IDLE;
    case 'picked':
      return state.kind === 'agent' && state.phase === 'inspecting' ? { kind: 'agent', phase: 'selected' } : state;
    case 'resolved':
      // `picked` may be lost when the renderer reloads mid-capture; accept the result from hover too.
      return state.kind === 'agent' && state.phase !== 'prompting'
        ? { kind: 'agent', phase: 'prompting', selection: event.selection }
        : state;
    case 'failed':
    case 'repick':
      return state.kind === 'agent' ? INSPECTING : state;
    case 'submitted':
      return state.kind === 'agent' && state.phase === 'prompting' ? IDLE : state;
    default: {
      const unreachable: never = event;
      throw new Error(`Unhandled mode event ${JSON.stringify(unreachable)}`);
    }
  }
}

/** What main's page inspector should do after moving from `previous` to `next`, if anything. */
export function inspectorEffect(previous: ModeState, next: ModeState): 'start' | 'stop' | null {
  const hovering = (s: ModeState): boolean => s.kind === 'agent' && s.phase === 'inspecting';
  if (hovering(next) && !hovering(previous)) return 'start';
  if (previous.kind === 'agent' && next.kind !== 'agent') return 'stop';
  return null;
}

export function modeActive(state: ModeState): boolean {
  return state.kind !== 'idle';
}
