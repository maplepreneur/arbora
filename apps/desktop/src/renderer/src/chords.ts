import { formatChord, parseChord } from '@arbora/shared';
import { useAppState } from './context';

/** Display label of the chord bound to a command on this platform (`Ctrl+K`, `⌘K`). */
export function useChordLabel(command: string): string | undefined {
  const platform = useAppState((state) => state.appInfo.platform);
  const chord = useAppState(
    (state) => state.keybindings.bindings.find((binding) => binding.command === command)?.chord,
  );
  return chord === undefined ? undefined : formatChord(parseChord(chord, platform), platform);
}

export function useChordLabels(): ReadonlyMap<string, string> {
  const platform = useAppState((state) => state.appInfo.platform);
  const bindings = useAppState((state) => state.keybindings.bindings);
  return new Map(
    bindings.map((binding) => [
      binding.command,
      formatChord(parseChord(binding.chord, platform), platform),
    ]),
  );
}
