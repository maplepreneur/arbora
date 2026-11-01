import {
  Bell,
  BellOff,
  ChevronDown,
  Command as CommandIcon,
  Copy,
  Minus,
  Moon,
  Monitor,
  Square,
  Sun,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { badgeLabel, CommandId } from '@arbora/shared';
import { useAttentionCount } from '../attention-store';
import { executeCommand } from '../commands';
import { useChordLabel } from '../keybindings';
import { useApp } from '../store';

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
      className="app-drag flex h-9 shrink-0 items-center border-b border-border bg-bg-subtle"
      onDoubleClick={(event) => {
        if (!isMac && event.target === event.currentTarget) {
          void window.arbora.invoke('window.control', { action: 'toggleMaximize' });
        }
      }}
    >
      <div className={isMac && !fullScreen ? 'w-[78px] shrink-0' : 'w-3 shrink-0'} />
      <div className="flex min-w-0 items-center gap-2 font-medium">
        <span className="pointer-events-none inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-accent" aria-hidden />
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
        {mode !== 'idle' && (
          <span
            data-testid="mode-indicator"
            className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent uppercase"
          >
            {mode === 'agent' ? 'Agent mode' : 'Design mode'}
          </span>
        )}
      </div>
      <div className="flex-1" />
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
