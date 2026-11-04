import type { AgentModeSelection } from '@arbora/shared';

/** Where design mode goes once its unsaved edits are sent or discarded: no mode, agent mode, or Grove. */
export type DesignPending = 'idle' | 'agent' | 'grove';

/**
 * The app's interaction mode. Agent mode runs `inspecting -> selected -> prompting -> idle`:
 * hovering the page, waiting for main to capture and resolve the click, then the prompt popover.
 * Design mode is `editing`, or `confirm` when leaving would drop unsaved ops.
 */
export type ModeState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'agent'; readonly phase: 'inspecting' }
  | { readonly kind: 'agent'; readonly phase: 'selected' }
  | { readonly kind: 'agent'; readonly phase: 'prompting'; readonly selection: AgentModeSelection }
  | { readonly kind: 'design'; readonly phase: 'editing' }
  | { readonly kind: 'design'; readonly phase: 'confirm'; readonly pending: DesignPending };

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
  | { readonly type: 'submitted' }
  /** Unsaved design edits: ask before leaving. `pending` is where to go after save or discard. */
  | { readonly type: 'designConfirm'; readonly pending: DesignPending }
  | { readonly type: 'designCancelConfirm' }
  /** Leave design mode. The caller has already saved or discarded. */
  | { readonly type: 'designLeave' };

export const IDLE: ModeState = { kind: 'idle' };
const INSPECTING: ModeState = { kind: 'agent', phase: 'inspecting' };

export function transition(state: ModeState, event: ModeEvent): ModeState {
  switch (event.type) {
    case 'toggleAgent':
      return state.kind === 'agent' ? IDLE : INSPECTING;
    case 'toggleDesign':
      return state.kind === 'design' ? IDLE : { kind: 'design', phase: 'editing' };
    case 'exit':
      if (state.kind === 'design' && state.phase === 'confirm') return { kind: 'design', phase: 'editing' };
      return state.kind === 'idle' ? state : IDLE;
    case 'designConfirm':
      return state.kind === 'design' && state.phase === 'editing'
        ? { kind: 'design', phase: 'confirm', pending: event.pending }
        : state;
    case 'designCancelConfirm':
      return state.kind === 'design' && state.phase === 'confirm' ? { kind: 'design', phase: 'editing' } : state;
    case 'designLeave':
      return state.kind === 'design' ? IDLE : state;
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

/** What the design overlay should do after moving from `previous` to `next`, if anything. */
export function designEffect(previous: ModeState, next: ModeState): 'start' | 'stop' | null {
  if (next.kind === 'design' && previous.kind !== 'design') return 'start';
  if (previous.kind === 'design' && next.kind !== 'design') return 'stop';
  return null;
}

export function modeActive(state: ModeState): boolean {
  return state.kind !== 'idle';
}
