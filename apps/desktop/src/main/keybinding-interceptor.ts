import type { Event, Input, WebContents } from 'electron';
import { chordFromInput, isModifierKey, type KeybindingContext, type KeybindingTable } from '@arbora/shared';

export interface InterceptorSource {
  table(): KeybindingTable;
  context(): KeybindingContext;
  dispatch(commandId: string): void;
}

/**
 * Pure decision used by the `before-input-event` hook: returns the command to run, or undefined
 * to let the key through. Kept to a cheap table lookup because it runs on every keystroke.
 */
export function interceptCommand(input: Input, source: InterceptorSource): string | undefined {
  if (input.type !== 'keyDown' || isModifierKey(input.key)) return undefined;
  const chord = chordFromInput({
    key: input.key,
    code: input.code,
    ctrl: input.control,
    meta: input.meta,
    alt: input.alt,
    shift: input.shift,
  });
  const binding = source.table().match(chord, source.context());
  return binding?.intercept ? binding.commandId : undefined;
}

/**
 * Intercepts mode chords in main so they work even when the embedded page has focus or binds the
 * same keys (many apps use Ctrl+K for their own palette). Never uses `globalShortcut`, which is a
 * no-op on Wayland.
 */
export function attachKeybindingInterceptor(contents: WebContents, source: InterceptorSource): () => void {
  const listener = (event: Event, input: Input): void => {
    const commandId = interceptCommand(input, source);
    if (commandId === undefined) return;
    event.preventDefault();
    if (!input.isAutoRepeat) source.dispatch(commandId);
  };
  contents.on('before-input-event', listener);
  return () => {
    if (!contents.isDestroyed()) contents.off('before-input-event', listener);
  };
}
