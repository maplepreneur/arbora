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
import { modeActive } from './mode';
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
    activeTable = table;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || useApp.getState().recordingShortcut) return;
      const binding = bindingForEvent(event);
      if (!binding) return;
      event.preventDefault();
      if (!event.repeat) executeCommand(binding.commandId);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [table]);
}

let activeTable: KeybindingTable | null = null;

/** Where the CLI-style thread keys apply: the docked agent panel and Grove's session pane. */
const AGENT_THREAD_SELECTOR = '[data-testid="agent-panel"], [data-testid="grove-pane"]';

/**
 * The Arbora binding a keydown triggers in the current context, if any. The terminal asks this
 * before handling a key so a chord that runs a command does not also reach the shell.
 */
export function bindingForEvent(event: KeyboardEvent): ReturnType<KeybindingTable['match']> {
  if (!activeTable || event.isComposing || isModifierKey(event.key)) return undefined;
  const chord = chordFromInput({
    key: event.key,
    code: event.code,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
  });
  const { mode, terminalFocused, settings, design, layout, project } = useApp.getState();
  const binding = activeTable.match(chord, {
    modeActive: modeActive(mode),
    terminalFocused,
    terminalPassthrough: settings.terminalPassthrough,
    designActive: mode.kind === 'design',
    textEditing: design.textEditing,
    agentFocused: event.target instanceof Element && event.target.closest(AGENT_THREAD_SELECTOR) !== null,
    workspace: project ? layout.workspace : 'browser',
  });
  if (binding && design.textEditing && binding.commandId !== 'arbora.exitMode') return undefined;
  return binding;
}

/** Keeps main's interception context in sync with the renderer's mode and focus state. */
export function useKeybindingContextSync(): void {
  const active = useApp((s) => modeActive(s.mode));
  const terminalFocused = useApp((s) => s.terminalFocused);
  const designActive = useApp((s) => s.mode.kind === 'design');
  const textEditing = useApp((s) => s.design.textEditing);
  const recording = useApp((s) => s.recordingShortcut);
  const workspace = useApp((s) => (s.project ? s.layout.workspace : 'browser'));
  useEffect(() => {
    void window.arbora.invoke('keybindings.setContext', {
      modeActive: active,
      terminalFocused,
      designActive,
      textEditing,
      recording,
      workspace,
    });
  }, [active, terminalFocused, designActive, textEditing, recording, workspace]);
}
