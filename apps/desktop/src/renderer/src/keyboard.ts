import { findKeybinding, parseChord, type CompiledKeybinding } from '@arbora/shared';
import { useEffect, useMemo } from 'react';
import { showToast, useAppState, useServices } from './context';

/**
 * Wires both keybinding dispatch paths into the command registry: chords main intercepted (sent
 * as `command:invoke`) and the remaining chords from `keydown` in the app chrome. Also keeps main
 * informed of the context it needs to decide what to intercept.
 */
export function useKeyboardDispatch(): void {
  const services = useServices();
  const { store, commands, bridge } = services;
  const platform = useAppState((state) => state.appInfo.platform);
  const keybindings = useAppState((state) => state.keybindings);

  const compiled = useMemo<CompiledKeybinding[]>(
    () =>
      keybindings.bindings.map((entry) => ({
        command: entry.command,
        source: entry.chord,
        chord: parseChord(entry.chord, platform),
        intercept: entry.intercept,
        when: entry.when,
      })),
    [keybindings.bindings, platform],
  );

  useEffect(() => {
    const run = (command: string): void => {
      void commands.run(command).catch((error: unknown) => {
        showToast(store, error instanceof Error ? error.message : String(error), 'error');
      });
    };

    const unsubscribe = bridge.on.commandInvoked(({ command }) => {
      run(command);
    });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return;
      const state = store.getState();
      const binding = findKeybinding(
        compiled,
        event,
        {
          modeActive: state.mode !== 'idle',
          terminalFocused: state.terminalFocused,
          terminalPassthrough: state.keybindings.terminalPassthrough,
        },
        'renderer',
      );
      if (!binding) return;
      event.preventDefault();
      if (!event.repeat) run(binding.command);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      unsubscribe();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [bridge, commands, compiled, store]);

  useEffect(() => {
    let last = '';
    const sync = (): void => {
      const { mode, paletteOpen, terminalFocused } = store.getState();
      // While the palette is open, Escape belongs to it rather than to the active mode.
      const next = { modeActive: mode !== 'idle' && !paletteOpen, terminalFocused };
      const key = JSON.stringify(next);
      if (key === last) return;
      last = key;
      void bridge.invoke.setKeyContext(next);
    };
    sync();
    return store.subscribe(sync);
  }, [bridge, store]);

  useEffect(() => {
    for (const problem of keybindings.problems) {
      showToast(store, problem.message, 'error');
    }
  }, [keybindings.problems, store]);
}
