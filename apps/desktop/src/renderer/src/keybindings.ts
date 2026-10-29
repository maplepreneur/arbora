import { useEffect, useMemo } from 'react';
import {
  chordFromInput,
  DEFAULT_COMMANDS,
  formatChord,
  isModifierKey,
  KeybindingTable,
  resolveKeybindingSpecs,
} from '@arbora/shared';
import { executeCommand } from './commands';
import { useApp } from './store';

export function useKeybindingTable(): KeybindingTable {
  const userOverrides = useApp((s) => s.settings.keybindings);
  const projectOverrides = useApp((s) => s.project?.settings.keybindings);
  const platform = useApp((s) => s.info.platform);
  return useMemo(() => {
    const { table, errors } = KeybindingTable.build(
      resolveKeybindingSpecs(DEFAULT_COMMANDS, userOverrides, projectOverrides),
      platform,
    );
    for (const error of errors) console.warn(`[keybindings] ${error.message}`);
    return table;
  }, [userOverrides, projectOverrides, platform]);
}

export function useChordLabel(commandId: string): string | undefined {
  const table = useKeybindingTable();
  const platform = useApp((s) => s.info.platform);
  const binding = table.forCommand(commandId);
  return binding ? formatChord(binding.chord, platform) : undefined;
}

/**
 * Renderer-side dispatch for chords pressed inside the app chrome. Intercepted chords (mode
 * toggles, palette, Esc in a mode) are normally consumed by main via `before-input-event` and
 * arrive as `command.invoke` instead; a keydown that still reaches the renderer was not consumed
 * (e.g. synthetic input), so every binding is handled here without risk of firing twice.
 */
export function useKeybindingDispatch(): void {
  const table = useKeybindingTable();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || isModifierKey(event.key)) return;
      const chord = chordFromInput({
        key: event.key,
        code: event.code,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        shift: event.shiftKey,
      });
      const { mode, terminalFocused, settings } = useApp.getState();
      const binding = table.match(chord, {
        modeActive: mode !== 'idle',
        terminalFocused,
        terminalPassthrough: settings.terminalPassthrough,
      });
      if (!binding) return;
      event.preventDefault();
      if (!event.repeat) executeCommand(binding.commandId);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [table]);
}

/** Keeps main's interception context in sync with the renderer's mode and focus state. */
export function useKeybindingContextSync(): void {
  const mode = useApp((s) => s.mode);
  const terminalFocused = useApp((s) => s.terminalFocused);
  useEffect(() => {
    void window.arbora.invoke('keybindings.setContext', { modeActive: mode !== 'idle', terminalFocused });
  }, [mode, terminalFocused]);
}
