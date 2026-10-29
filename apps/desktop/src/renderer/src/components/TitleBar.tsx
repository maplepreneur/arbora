import { CommandId } from '@arbora/shared';
import { useChordLabel } from '../chords';
import { useAppState, useServices } from '../context';
import type { Mode } from '../store';

const MODE_LABEL: Record<Exclude<Mode, 'idle'>, string> = {
  agent: 'Agent mode',
  design: 'Design mode',
};

function ModeBadge() {
  const mode = useAppState((state) => state.mode);
  const exitChord = useChordLabel(CommandId.exitMode);
  if (mode === 'idle') return null;
  return (
    <span
      data-testid="mode-badge"
      data-mode={mode}
      className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-fg"
    >
      {MODE_LABEL[mode]}
      {exitChord ? <span className="ml-1 opacity-70">· {exitChord} to exit</span> : null}
    </span>
  );
}

function WindowControls() {
  const { bridge } = useServices();
  const maximized = useAppState((state) => state.windowState.maximized);
  const button =
    'app-no-drag flex h-full w-11 items-center justify-center text-muted hover:bg-surface-2 hover:text-fg';
  return (
    <div className="flex h-full">
      <button
        type="button"
        aria-label="Minimize"
        className={button}
        onClick={() => void bridge.invoke.windowControl({ action: 'minimize' })}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        className={button}
        onClick={() => void bridge.invoke.windowControl({ action: 'toggleMaximize' })}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Close"
        className={`${button} hover:!bg-red-600 hover:!text-white`}
        onClick={() => void bridge.invoke.windowControl({ action: 'close' })}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" />
        </svg>
      </button>
    </div>
  );
}

export function TitleBar() {
  const { commands, bridge } = useServices();
  const platform = useAppState((state) => state.appInfo.platform);
  const project = useAppState((state) => state.project);
  const fullscreen = useAppState((state) => state.windowState.fullscreen);
  const paletteChord = useChordLabel(CommandId.commandPalette);
  const leftInset = platform === 'darwin' && !fullscreen ? 'pl-20' : 'pl-3';

  return (
    <header
      data-testid="title-bar"
      className={`app-drag flex h-9 shrink-0 items-center gap-3 border-b border-border bg-surface ${leftInset}`}
      onDoubleClick={(event) => {
        if (platform !== 'darwin' && event.target === event.currentTarget) {
          void bridge.invoke.windowControl({ action: 'toggleMaximize' });
        }
      }}
    >
      <span className="text-xs font-semibold tracking-wide text-accent">arbora</span>
      {project ? (
        <span className="truncate text-xs text-muted" title={project.path}>
          {project.name}
        </span>
      ) : null}
      <ModeBadge />
      <div className="flex-1" />
      <button
        type="button"
        data-testid="open-palette"
        className="app-no-drag rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:text-fg"
        onClick={() => void commands.run(CommandId.commandPalette)}
      >
        Commands{paletteChord ? ` ${paletteChord}` : ''}
      </button>
      {platform === 'darwin' ? <div className="w-2" /> : <WindowControls />}
    </header>
  );
}
