import { Command as CommandIcon, Copy, Minus, Moon, Monitor, Square, Sun, X } from 'lucide-react';
import { CommandId } from '@arbora/shared';
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

/**
 * Custom title bar. macOS uses `hiddenInset` (traffic lights on the left); Linux and Windows are
 * frameless, so this bar is the drag region and hosts the window controls. Interactive elements
 * opt out of the drag region so the compositor does not swallow their clicks.
 */
export function TitleBar() {
  const platform = useApp((s) => s.info.platform);
  const fullScreen = useApp((s) => s.windowState.fullScreen);
  const project = useApp((s) => s.project);
  const mode = useApp((s) => s.mode);
  const paletteLabel = useChordLabel(CommandId.commandPalette);
  const isMac = platform === 'darwin';

  return (
    <header
      data-testid="title-bar"
      className="app-drag flex h-9 shrink-0 items-center border-b border-border bg-bg-subtle"
      onDoubleClick={(event) => {
        if (!isMac && event.target === event.currentTarget) {
          void window.arbora.invoke('window.control', { action: 'toggleMaximize' });
        }
      }}
    >
      <div className={isMac && !fullScreen ? 'w-[78px] shrink-0' : 'w-3 shrink-0'} />
      <div className="pointer-events-none flex items-center gap-2 font-medium">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />
        <span>Arbora</span>
        {project && (
          <>
            <span className="text-fg-subtle">/</span>
            <span className="text-fg-muted" data-testid="title-project-name">
              {project.name}
            </span>
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
