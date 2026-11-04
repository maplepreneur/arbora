import clsx from 'clsx';
import { Crosshair, MousePointer2, Palette } from 'lucide-react';
import { CommandId } from '@arbora/shared';
import { executeCommand } from '../commands';
import { useChordLabel } from '../keybindings';
import { useApp } from '../store';

type ModeKind = 'idle' | 'agent' | 'design';

const MODE_PILLS: readonly {
  kind: ModeKind;
  label: string;
  hint: string;
  icon: typeof Crosshair;
}[] = [
  { kind: 'idle', label: 'Freestyle', hint: 'Use the page and editor normally', icon: MousePointer2 },
  { kind: 'agent', label: 'Agent', hint: 'Point at the page and ask an agent', icon: Crosshair },
  { kind: 'design', label: 'Design', hint: 'Edit styles and text on the page', icon: Palette },
];

/**
 * Freestyle / Agent / Design for the selected project's page. Both modes bring the Browser tab
 * forward. Labels fold to icons when the chat column is narrow.
 */
export function ModeSwitch() {
  const mode = useApp((s) => s.mode.kind);
  const hasProject = useApp((s) => s.project !== null);
  const agentChord = useChordLabel(CommandId.agentMode);
  const designChord = useChordLabel(CommandId.designMode);
  const exitChord = useChordLabel(CommandId.exitMode);
  if (!hasProject) return null;
  const chordOf = (kind: ModeKind): string | undefined =>
    kind === 'agent' ? agentChord : kind === 'design' ? designChord : mode === 'idle' ? undefined : exitChord;
  const select = (kind: ModeKind): void => {
    if (kind === mode) return;
    // Leaving a mode goes through its own toggle, so design mode can ask about unsaved edits.
    if (kind === 'idle') executeCommand(mode === 'agent' ? CommandId.agentMode : CommandId.designMode);
    else executeCommand(kind === 'agent' ? CommandId.agentMode : CommandId.designMode);
  };
  return (
    <div className="@container ml-auto flex min-w-0 shrink justify-end">
      <div
        role="radiogroup"
        aria-label="Mode"
        data-testid="mode-pills"
        data-mode={mode}
        className="flex h-6 shrink-0 items-center rounded-full border border-border bg-bg p-0.5"
      >
        {MODE_PILLS.map((pill) => {
          const active = pill.kind === mode;
          const chord = chordOf(pill.kind);
          const Icon = pill.icon;
          return (
            <button
              key={pill.kind}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={pill.label}
              data-testid={`mode-pill-${pill.kind}`}
              title={`${pill.label}: ${pill.hint}${chord ? ` (${chord})` : ''}`}
              onClick={() => select(pill.kind)}
              className={clsx(
                'flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap transition-colors',
                active
                  ? pill.kind === 'idle'
                    ? 'bg-bg-muted text-fg'
                    : 'bg-accent text-accent-fg'
                  : 'text-fg-subtle hover:text-fg',
              )}
            >
              <Icon size={11} className="shrink-0" />
              <span className="hidden @[14rem]:inline">{pill.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
