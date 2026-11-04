import {
  Bell,
  BellOff,
  ChevronDown,
  Command as CommandIcon,
  Copy,
  Crosshair,
  Minus,
  MousePointer2,
  Moon,
  Monitor,
  Palette,
  Square,
  Sun,
  TreePine,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { badgeLabel, CommandId } from '@arbora/shared';
import { useAttentionCount } from '../attention-store';
import { executeCommand } from '../commands';
import { useChordLabel } from '../keybindings';
import { useApp } from '../store';
import { WorkspaceSwitch } from './WorkspaceSwitch';

type ModeKind = 'idle' | 'agent' | 'design';

const MODE_PILLS: readonly {
  kind: ModeKind;
  label: string;
  hint: string;
  icon: typeof Crosshair;
  command: CommandId | null;
}[] = [
  { kind: 'idle', label: 'Freestyle', hint: 'Use the page and editor normally', icon: MousePointer2, command: null },
  {
    kind: 'agent',
    label: 'Agent',
    hint: 'Point at the page and ask an agent',
    icon: Crosshair,
    command: CommandId.agentMode,
  },
  {
    kind: 'design',
    label: 'Design',
    hint: 'Edit styles and text on the page',
    icon: Palette,
    command: CommandId.designMode,
  },
];

/** Freestyle / Agent / Design: the current mode, and a click to switch (same as the chords). */
function ModePills({ mode }: { mode: ModeKind }) {
  const agentChord = useChordLabel(CommandId.agentMode);
  const designChord = useChordLabel(CommandId.designMode);
  const exitChord = useChordLabel(CommandId.exitMode);
  const chordOf = (kind: ModeKind): string | undefined =>
    kind === 'agent' ? agentChord : kind === 'design' ? designChord : mode === 'idle' ? undefined : exitChord;
  const select = (kind: ModeKind): void => {
    if (kind === mode) return;
    // Leaving a mode goes through its own toggle, so design mode can ask about unsaved edits.
    if (kind === 'idle') executeCommand(mode === 'agent' ? CommandId.agentMode : CommandId.designMode);
    else executeCommand(kind === 'agent' ? CommandId.agentMode : CommandId.designMode);
  };
  return (
    <div
      role="radiogroup"
      aria-label="Mode"
      data-testid="mode-pills"
      data-mode={mode}
      className="app-no-drag ml-3 flex h-6 shrink-0 items-center rounded-full border border-border bg-bg p-0.5"
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
            data-testid={`mode-pill-${pill.kind}`}
            title={`${pill.label}: ${pill.hint}${chord ? ` (${chord})` : ''}`}
            onClick={() => select(pill.kind)}
            className={clsx(
              'flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors',
              active
                ? pill.kind === 'idle'
                  ? 'bg-bg-muted text-fg'
                  : 'bg-accent text-accent-fg'
                : 'text-fg-subtle hover:text-fg',
            )}
          >
            <Icon size={11} className="shrink-0" />
            <span className="hidden @[40rem]:inline">{pill.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ThemeIcon() {
  const mode = useApp((s) => s.theme.mode);
  switch (mode) {
    case 'light':
      return <Sun size={14} />;
    case 'dark':
      return <Moon size={14} />;
    case 'system':
      return <Monitor size={14} />;
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

function WindowControls() {
  const maximized = useApp((s) => s.windowState.maximized);
  const control = (action: 'minimize' | 'toggleMaximize' | 'close') => () => {
    void window.arbora.invoke('window.control', { action });
  };
  const button =
    'app-no-drag flex h-full w-11 items-center justify-center text-fg-muted hover:bg-bg-muted hover:text-fg';
  return (
    <div className="flex h-full" data-testid="window-controls">
      <button type="button" aria-label="Minimize" className={button} onClick={control('minimize')}>
        <Minus size={14} />
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        className={button}
        onClick={control('toggleMaximize')}
      >
        {maximized ? <Copy size={12} /> : <Square size={12} />}
      </button>
      <button
        type="button"
        aria-label="Close"
        className={`${button} hover:!bg-danger hover:!text-white`}
        onClick={control('close')}
      >
        <X size={15} />
      </button>
    </div>
  );
}

/** Agents that need you, in every workspace: click jumps to the oldest (`Mod+Alt+A`). */
function AttentionButton() {
  const count = useAttentionCount();
  const muted = useApp((s) => !s.settings.notifications.enabled && !s.settings.sounds.enabled);
  const label = useChordLabel(CommandId.agentShowAttention);
  const project = useApp((s) => s.project);
  if (!project) return null;
  const title =
    count > 0
      ? `${count} agent thread${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} you${label ? ` (${label})` : ''}`
      : `No agent needs you${muted ? '. Notifications and sounds are off' : ''}`;
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      data-testid="attention-button"
      data-count={count}
      onClick={() => executeCommand(CommandId.agentShowAttention)}
      className={clsx(
        'app-no-drag mr-1 flex h-6 items-center gap-1 rounded px-1.5',
        count > 0 ? 'bg-attention-soft text-attention' : 'text-fg-subtle hover:bg-bg-muted hover:text-fg',
      )}
    >
      {muted ? <BellOff size={13} /> : <Bell size={13} />}
      {count > 0 && (
        <span data-testid="attention-badge" className="text-[11px] font-semibold tabular-nums">
          {badgeLabel(count)}
        </span>
      )}
    </button>
  );
}

/**
 * Custom title bar. macOS uses `hiddenInset` (traffic lights on the left); Linux and Windows are
 * frameless, so this bar is the drag region and hosts the window controls. Interactive elements
 * opt out of the drag region so the compositor does not swallow their clicks.
 */
export function TitleBar() {
  const platform = useApp((s) => s.info.platform);
  const fullScreen = useApp((s) => s.windowState.fullScreen);
  const project = useApp((s) => s.project);
  const mode = useApp((s) => s.mode.kind);
  const paletteLabel = useChordLabel(CommandId.commandPalette);
  const switchLabel = useChordLabel(CommandId.switchProject);
  const isMac = platform === 'darwin';

  return (
    <header
      data-testid="title-bar"
      data-landmark="title-bar"
      aria-label="Title bar"
      className="app-drag @container flex h-9 shrink-0 items-center border-b border-border bg-bg-subtle"
      onDoubleClick={(event) => {
        if (!isMac && event.target === event.currentTarget) {
          void window.arbora.invoke('window.control', { action: 'toggleMaximize' });
        }
      }}
    >
      {/* Room for the traffic lights, plus a gap so the logo does not read as a fourth button. */}
      <div className={isMac && !fullScreen ? 'w-[88px] shrink-0' : 'w-3 shrink-0'} />
      <div className="flex min-w-0 items-center gap-1.5 font-medium">
        <TreePine
          size={14}
          strokeWidth={2.25}
          className="pointer-events-none shrink-0 text-accent"
          aria-hidden
          data-testid="title-logo"
        />
        <span className="pointer-events-none">Arbora</span>
        {project && (
          <>
            <span className="pointer-events-none text-fg-subtle">/</span>
            <button
              type="button"
              title={switchLabel ? `Switch project (${switchLabel})` : 'Switch project'}
              aria-label={`${project.name}. Switch project`}
              onClick={() => executeCommand(CommandId.switchProject)}
              className="app-no-drag flex min-w-0 items-center gap-1 rounded px-1 text-fg-muted hover:bg-bg-muted hover:text-fg"
            >
              <span className="truncate" data-testid="title-project-name">
                {project.name}
              </span>
              <ChevronDown size={11} className="shrink-0 opacity-60" />
            </button>
          </>
        )}
        {project && <ModePills mode={mode} />}
      </div>
      <div className="flex-1" />
      <WorkspaceSwitch />
      <AttentionButton />
      <button
        type="button"
        className="app-no-drag mr-1 flex h-6 items-center gap-2 rounded border border-border bg-bg px-2 text-fg-muted hover:text-fg"
        onClick={() => executeCommand(CommandId.commandPalette)}
        data-testid="open-palette"
      >
        <CommandIcon size={12} />
        <span>Commands</span>
        {paletteLabel && <kbd className="font-mono text-[11px] text-fg-subtle">{paletteLabel}</kbd>}
      </button>
      <button
        type="button"
        aria-label="Toggle theme"
        className="app-no-drag mr-2 flex h-6 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg"
        onClick={() => executeCommand(CommandId.toggleTheme)}
        data-testid="toggle-theme"
      >
        <ThemeIcon />
      </button>
      {!isMac && <WindowControls />}
    </header>
  );
}
