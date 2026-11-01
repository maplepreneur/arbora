import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Pencil, RotateCcw, Search, X } from 'lucide-react';
import {
  assignKeybinding,
  bindingFromChord,
  chordFromInput,
  conflictsFor,
  DEFAULT_COMMANDS,
  formatChord,
  isModifierKey,
  isReservedChord,
  keybindingRows,
  parseChord,
  superChordWarning,
  type KeybindingRow,
  type Platform,
} from '@arbora/shared';
import { executeCommand } from '../../commands';
import { updateSettings } from '../../settings-client';
import { showToast, useApp } from '../../store';
import { SettingRow, Toggle } from './controls';

function chordLabel(binding: string | null, platform: Platform): string {
  if (!binding) return '';
  try {
    return formatChord(parseChord(binding, platform), platform);
  } catch {
    return binding;
  }
}

const WHEN_LABEL: Readonly<Record<KeybindingRow['when'], string | null>> = {
  always: null,
  modeActive: 'in a mode',
  design: 'in design mode',
  agentPanel: 'in the agent panel',
};

interface Pending {
  readonly commandId: string;
  readonly binding: string;
  readonly conflicts: readonly string[];
  readonly warning: string | null;
}

/** Records the next chord; Escape cancels (it is reserved for leaving modes). */
function useRecorder(
  active: boolean,
  platform: Platform,
  onChord: (binding: string, warning: string | null) => void,
  onCancel: () => void,
): void {
  useEffect(() => {
    if (!active) return;
    useApp.setState({ recordingShortcut: true });
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || isModifierKey(event.key)) return;
      const chord = chordFromInput({
        key: event.key,
        code: event.code,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        shift: event.shiftKey,
      });
      if (isReservedChord(chord)) {
        onCancel();
        return;
      }
      onChord(bindingFromChord(chord, platform), superChordWarning(chord, platform));
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      useApp.setState({ recordingShortcut: false });
    };
  }, [active, platform, onChord, onCancel]);
}

/**
 * The shortcut editor (F-SHELL-04): click a shortcut, press the new chord. A chord another command
 * already answers in an overlapping context is flagged, with Replace (the other command loses it)
 * or Keep both. Escape is reserved; Super chords get a warning off macOS.
 */
export function KeyboardSection() {
  const platform = useApp((s) => s.info.platform);
  const user = useApp((s) => s.settings.keybindings);
  const project = useApp((s) => s.project?.settings.keybindings);
  const passthrough = useApp((s) => s.settings.terminalPassthrough);
  const [filter, setFilter] = useState('');
  const [recording, setRecording] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const rows = useMemo(() => keybindingRows(DEFAULT_COMMANDS, user, project, platform), [user, project, platform]);
  const titles = useMemo(() => new Map(rows.map((r) => [r.commandId, r.title])), [rows]);

  const save = (commandId: string, binding: string | null, unbind: readonly string[] = []): void => {
    void updateSettings({ keybindings: assignKeybinding(user, DEFAULT_COMMANDS, commandId, binding, unbind) });
  };

  const onChord = useCallback(
    (binding: string, warning: string | null) => {
      const commandId = recording;
      setRecording(null);
      if (!commandId) return;
      const conflicts = conflictsFor(commandId, binding, DEFAULT_COMMANDS, user, project, platform);
      if (conflicts.length === 0 && !warning) {
        void updateSettings({ keybindings: assignKeybinding(user, DEFAULT_COMMANDS, commandId, binding) });
        return;
      }
      setPending({ commandId, binding, conflicts, warning });
    },
    [recording, user, project, platform],
  );
  const onCancel = useCallback(() => setRecording(null), []);
  useRecorder(recording !== null, platform, onChord, onCancel);

  const q = filter.trim().toLowerCase();
  const shown = rows.filter(
    (row) =>
      q === '' ||
      `${row.title} ${row.category} ${chordLabel(row.binding, platform)} ${row.commandId}`.toLowerCase().includes(q),
  );
  const categories = [...new Set(shown.map((r) => r.category))];
  const overridden = Object.keys(user).length;

  return (
    <div className="flex flex-col gap-3" data-testid="keyboard-section">
      <div className="flex items-center gap-2">
        <label className="flex h-7 flex-1 items-center gap-1.5 rounded border border-border bg-bg px-2 focus-within:border-accent">
          <Search size={12} className="text-fg-subtle" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by command or key"
            aria-label="Filter shortcuts"
            data-testid="shortcut-filter"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        </label>
        <button
          type="button"
          disabled={overridden === 0}
          onClick={() => {
            void updateSettings({ keybindings: {} });
            showToast('Shortcuts reset to the defaults');
          }}
          className="flex h-7 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-bg-muted disabled:opacity-40"
        >
          <RotateCcw size={11} /> Reset all ({overridden})
        </button>
        <button
          type="button"
          onClick={() => executeCommand('arbora.openSettingsFile')}
          className="h-7 rounded border border-border px-2 text-xs hover:bg-bg-muted"
        >
          settings.json
        </button>
      </div>
      {pending && (
        <div
          role="alert"
          data-testid="shortcut-conflict"
          className="flex flex-col gap-2 rounded-lg border border-attention/50 bg-attention-soft px-3 py-2 text-xs"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-attention" />
            <div className="flex-1">
              <p>
                <kbd className="font-mono">{chordLabel(pending.binding, platform)}</kbd> for{' '}
                <strong>{titles.get(pending.commandId)}</strong>
              </p>
              {pending.conflicts.length > 0 && (
                <p>Already used by {pending.conflicts.map((id) => titles.get(id) ?? id).join(', ')}.</p>
              )}
              {pending.warning && <p>{pending.warning}</p>}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              className="rounded border border-border bg-bg px-2 py-1"
            >
              Cancel
            </button>
            {pending.conflicts.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  save(pending.commandId, pending.binding);
                  setPending(null);
                }}
                className="rounded border border-border bg-bg px-2 py-1"
              >
                Keep both
              </button>
            )}
            <button
              type="button"
              data-testid="shortcut-replace"
              onClick={() => {
                save(pending.commandId, pending.binding, pending.conflicts);
                setPending(null);
              }}
              className="rounded bg-accent px-2 py-1 font-medium text-accent-fg"
            >
              {pending.conflicts.length > 0 ? 'Replace' : 'Use it anyway'}
            </button>
          </div>
        </div>
      )}
      {categories.map((category) => (
        <section key={category} aria-label={category}>
          <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">{category}</h3>
          <ul className="rounded-lg border border-border">
            {shown
              .filter((row) => row.category === category)
              .map((row) => {
                const isRecording = recording === row.commandId;
                const changed = row.source !== 'default';
                return (
                  <li
                    key={row.commandId}
                    data-testid="shortcut-row"
                    data-command={row.commandId}
                    data-conflict={row.conflicts.length > 0 || undefined}
                    className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {row.title}
                      {WHEN_LABEL[row.when] && (
                        <span className="ml-1.5 text-[10px] text-fg-subtle">{WHEN_LABEL[row.when]}</span>
                      )}
                      {row.source === 'project' && (
                        <span className="ml-1.5 rounded bg-bg-muted px-1 text-[10px] text-fg-subtle">project.json</span>
                      )}
                    </span>
                    {row.conflicts.length > 0 && (
                      <span
                        className="flex items-center gap-1 text-[10px] text-attention"
                        title={`Also bound to ${row.conflicts.map((id) => titles.get(id) ?? id).join(', ')}`}
                      >
                        <AlertTriangle size={11} /> conflict
                      </span>
                    )}
                    <button
                      type="button"
                      data-testid="shortcut-record"
                      disabled={row.reserved}
                      aria-label={isRecording ? 'Press the new shortcut' : `Change shortcut for ${row.title}`}
                      onClick={() => setRecording(isRecording ? null : row.commandId)}
                      className={clsx(
                        'flex min-w-24 items-center justify-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px]',
                        isRecording
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-border bg-bg-muted hover:border-accent',
                        changed && !isRecording && 'text-accent',
                      )}
                    >
                      {isRecording ? (
                        'Press keys…'
                      ) : row.binding ? (
                        chordLabel(row.binding, platform)
                      ) : (
                        <span className="flex items-center gap-1 font-sans text-fg-subtle">
                          <Pencil size={10} /> Add
                        </span>
                      )}
                    </button>
                    <span className="flex w-10 justify-end gap-0.5">
                      {row.binding && !row.reserved && (
                        <button
                          type="button"
                          aria-label={`Remove shortcut for ${row.title}`}
                          onClick={() => save(row.commandId, null)}
                          className="rounded p-0.5 text-fg-subtle hover:text-danger"
                        >
                          <X size={11} />
                        </button>
                      )}
                      {row.source === 'user' && (
                        <button
                          type="button"
                          aria-label={`Reset ${row.title} to ${chordLabel(row.defaultBinding, platform) || 'no shortcut'}`}
                          title={`Default: ${chordLabel(row.defaultBinding, platform) || 'none'}`}
                          onClick={() => save(row.commandId, row.defaultBinding)}
                          className="rounded p-0.5 text-fg-subtle hover:text-fg"
                        >
                          <RotateCcw size={11} />
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
      <SettingRow
        title="Send Ctrl chords to the focused terminal"
        detail="While a terminal has focus, plain Ctrl+<key> chords (Ctrl+K, Ctrl+D, Ctrl+1) go to the shell."
      >
        <Toggle
          on={passthrough}
          label="Terminal passthrough"
          onChange={(on) => void updateSettings({ terminalPassthrough: on })}
        />
      </SettingRow>
      <p className="text-[11px] text-fg-subtle">
        A project can override shortcuts in <span className="font-mono">.arbora/project.json</span> under{' '}
        <span className="font-mono">keybindings</span>; those win over the ones here.
      </p>
    </div>
  );
}
