import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  BellOff,
  ChevronDown,
  Copy,
  Crosshair,
  Minus,
  MousePointer2,
  Palette,
  Square,
  TreePine,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { badgeLabel, CommandId, type ContextMenuItem } from '@arbora/shared';
import { useAttentionCount } from '../attention-store';
import { executeCommand } from '../commands';
import { useChordLabel } from '../keybindings';
import { useApp } from '../store';
import { chooseTitleBarCollapses, type TitleBarCollapse } from './title-bar-collapse';
import { menuTriggerKeyDown, openTitleBarMenu } from './title-bar-menu';
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

const EXPANDED: TitleBarCollapse = { mode: false, workspace: false };

function modePill(kind: ModeKind): (typeof MODE_PILLS)[number] {
  const pill = MODE_PILLS.find((entry) => entry.kind === kind);
  if (!pill) throw new Error(`Unknown mode ${kind}`);
  return pill;
}

function boxWidth(element: HTMLElement | null, edge: 'client' | 'offset'): number {
  if (!element) return 0;
  return edge === 'client' ? element.clientWidth : element.offsetWidth;
}

function useTitleBarCollapse(
  barRef: RefObject<HTMLElement | null>,
  spacerRef: RefObject<HTMLDivElement | null>,
  trailingRef: RefObject<HTMLDivElement | null>,
  leftExpandedRef: RefObject<HTMLDivElement | null>,
  leftCollapsedRef: RefObject<HTMLDivElement | null>,
  workspaceExpandedRef: RefObject<HTMLDivElement | null>,
  workspaceCollapsedRef: RefObject<HTMLDivElement | null>,
): TitleBarCollapse {
  const [collapse, setCollapse] = useState<TitleBarCollapse>(EXPANDED);
  useLayoutEffect(() => {
    const measure = (): void => {
      const next = chooseTitleBarCollapses({
        bar: boxWidth(barRef.current, 'client'),
        chrome: boxWidth(spacerRef.current, 'offset') + boxWidth(trailingRef.current, 'offset'),
        leftExpanded: boxWidth(leftExpandedRef.current, 'offset'),
        leftCollapsed: boxWidth(leftCollapsedRef.current, 'offset'),
        workspaceExpanded: boxWidth(workspaceExpandedRef.current, 'offset'),
        workspaceCollapsed: boxWidth(workspaceCollapsedRef.current, 'offset'),
      });
      setCollapse((current) => (current.mode === next.mode && current.workspace === next.workspace ? current : next));
    };
    measure();
    const observed = [
      barRef.current,
      spacerRef.current,
      trailingRef.current,
      leftExpandedRef.current,
      leftCollapsedRef.current,
      workspaceExpandedRef.current,
      workspaceCollapsedRef.current,
    ].filter((element) => element !== null);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    for (const element of observed) observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  });
  return collapse;
}

/** Freestyle / Agent / Design: the current mode, and a click to switch (same as the chords). */
function ModePills({ mode, measured = false }: { mode: ModeKind; measured?: boolean }) {
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
      data-testid={measured ? undefined : 'mode-pills'}
      data-mode={mode}
      data-collapsed="false"
      className="app-no-drag flex h-6 shrink-0 items-center rounded-full border border-border bg-bg p-0.5"
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
            tabIndex={measured ? -1 : undefined}
            data-testid={measured ? undefined : `mode-pill-${pill.kind}`}
            title={`${pill.label}: ${pill.hint}${chord ? ` (${chord})` : ''}`}
            onClick={() => {
              if (!measured) select(pill.kind);
            }}
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
            <span>{pill.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Active mode, plus the native menu of the other modes. Picking one runs the same command as the pill. */
function ModeMenu({ mode, measured = false }: { mode: ModeKind; measured?: boolean }) {
  const agentChord = useChordLabel(CommandId.agentMode);
  const designChord = useChordLabel(CommandId.designMode);
  const exitChord = useChordLabel(CommandId.exitMode);
  const chordOf = (kind: ModeKind): string | undefined =>
    kind === 'agent' ? agentChord : kind === 'design' ? designChord : mode === 'idle' ? undefined : exitChord;
  const active = modePill(mode);
  const Icon = active.icon;
  const select = (kind: ModeKind): void => {
    if (kind === mode) return;
    if (kind === 'idle') executeCommand(mode === 'agent' ? CommandId.agentMode : CommandId.designMode);
    else executeCommand(kind === 'agent' ? CommandId.agentMode : CommandId.designMode);
  };
  const open = (): void => {
    if (measured) return;
    const items: ContextMenuItem[] = MODE_PILLS.filter((pill) => pill.kind !== mode).map((pill) => {
      const chord = chordOf(pill.kind);
      return { id: pill.kind, label: pill.label, ...(chord ? { accelerator: chord } : {}) };
    });
    void openTitleBarMenu(items).then((id) => {
      if (id === 'idle' || id === 'agent' || id === 'design') select(id);
    });
  };
  const chord = chordOf(mode);
  return (
    <div data-testid={measured ? undefined : 'mode-pills'} data-mode={mode} data-collapsed="true" className="shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-label={`${active.label}. Choose another mode`}
        data-testid={measured ? undefined : 'mode-menu'}
        title={`${active.label}: ${active.hint}${chord ? ` (${chord})` : ''}`}
        onClick={open}
        onKeyDown={menuTriggerKeyDown(open)}
        className={clsx(
          'app-no-drag flex h-6 items-center gap-1 rounded-full border border-border bg-bg px-2 text-[11px] font-medium whitespace-nowrap',
          mode === 'idle' ? 'text-fg' : 'bg-accent text-accent-fg',
        )}
      >
        <Icon size={11} className="shrink-0" />
        <span>{active.label}</span>
        <ChevronDown size={11} className="shrink-0 opacity-60" />
      </button>
    </div>
  );
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

function ProjectIdentity({ natural = false }: { natural?: boolean }) {
  const project = useApp((s) => s.project);
  const switchLabel = useChordLabel(CommandId.switchProject);
  return (
    <>
      <TreePine
        size={14}
        strokeWidth={2.25}
        className="pointer-events-none shrink-0 text-accent"
        aria-hidden
        data-testid={natural ? undefined : 'title-logo'}
      />
      <span className="pointer-events-none whitespace-nowrap">Arbora</span>
      {project && (
        <>
          <span className="pointer-events-none text-fg-subtle">/</span>
          <button
            type="button"
            title={switchLabel ? `Switch project (${switchLabel})` : 'Switch project'}
            aria-label={`${project.name}. Switch project`}
            tabIndex={natural ? -1 : undefined}
            onClick={() => {
              if (!natural) executeCommand(CommandId.switchProject);
            }}
            className={clsx(
              'flex items-center gap-1 px-1',
              natural
                ? 'pointer-events-none whitespace-nowrap'
                : 'app-no-drag min-w-0 rounded text-fg-muted hover:bg-bg-muted hover:text-fg',
            )}
          >
            <span
              className={natural ? 'whitespace-nowrap' : 'truncate'}
              data-testid={natural ? undefined : 'title-project-name'}
            >
              {project.name}
            </span>
            <ChevronDown size={11} className="shrink-0 opacity-60" />
          </button>
        </>
      )}
    </>
  );
}

function LeftCluster({ mode, collapsed, natural }: { mode: ModeKind; collapsed: boolean; natural: boolean }) {
  const project = useApp((s) => s.project);
  return (
    <div className={clsx('flex items-center gap-1.5 font-medium', natural ? 'w-max whitespace-nowrap' : 'min-w-0')}>
      <ProjectIdentity natural={natural} />
      {project && (
        <div className="shrink-0 pl-3">
          {collapsed ? <ModeMenu mode={mode} measured={natural} /> : <ModePills mode={mode} measured={natural} />}
        </div>
      )}
    </div>
  );
}

/**
 * Custom title bar. macOS uses `hiddenInset` (traffic lights on the left); Linux and Windows are
 * frameless, so this bar is the drag region and hosts the window controls. Interactive elements
 * opt out of the drag region so the compositor does not swallow their clicks.
 *
 * The command palette (`Ctrl+Shift+P`) and Toggle Theme stay in the palette and in Settings.
 * They are not drawn here. Mode pills and the workspace switch fold to the active option plus a
 * menu when their measured width, including the project name, does not fit.
 */
export function TitleBar() {
  const platform = useApp((s) => s.info.platform);
  const fullScreen = useApp((s) => s.windowState.fullScreen);
  const project = useApp((s) => s.project);
  const mode = useApp((s) => s.mode.kind);
  const workspace = useApp((s) => s.layout.workspace);
  const isMac = platform === 'darwin';
  const showWorkspace = project !== null || workspace === 'grove';
  const barRef = useRef<HTMLElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const trailingRef = useRef<HTMLDivElement>(null);
  const leftExpandedRef = useRef<HTMLDivElement>(null);
  const leftCollapsedRef = useRef<HTMLDivElement>(null);
  const workspaceExpandedRef = useRef<HTMLDivElement>(null);
  const workspaceCollapsedRef = useRef<HTMLDivElement>(null);
  const collapse = useTitleBarCollapse(
    barRef,
    spacerRef,
    trailingRef,
    leftExpandedRef,
    leftCollapsedRef,
    workspaceExpandedRef,
    workspaceCollapsedRef,
  );

  return (
    <header
      ref={barRef}
      data-testid="title-bar"
      data-measure="bar"
      data-landmark="title-bar"
      aria-label="Title bar"
      className="app-drag relative flex h-9 shrink-0 items-center overflow-hidden border-b border-border bg-bg-subtle"
      onDoubleClick={(event) => {
        if (!isMac && event.target === event.currentTarget) {
          void window.arbora.invoke('window.control', { action: 'toggleMaximize' });
        }
      }}
    >
      {/* Room for the traffic lights, plus a gap so the logo does not read as a fourth button. */}
      <div
        ref={spacerRef}
        data-measure="spacer"
        className={isMac && !fullScreen ? 'w-[88px] shrink-0' : 'w-3 shrink-0'}
      />
      <LeftCluster mode={mode} collapsed={collapse.mode} natural={false} />
      <div className="flex-1" />
      {showWorkspace && (
        <div className="shrink-0 pr-1">
          <WorkspaceSwitch collapsed={collapse.workspace} />
        </div>
      )}
      <div ref={trailingRef} data-measure="trailing" className="flex h-full shrink-0 items-center">
        <AttentionButton />
        {!isMac && <WindowControls />}
      </div>
      {createPortal(
        <div
          aria-hidden
          inert
          className="pointer-events-none fixed top-0 left-[-10000px] flex w-max flex-col items-start"
        >
          <div ref={leftExpandedRef} data-measure="left-expanded" className="w-max">
            <LeftCluster mode={mode} collapsed={false} natural />
          </div>
          {project && (
            <div ref={leftCollapsedRef} data-measure="left-collapsed" className="w-max">
              <LeftCluster mode={mode} collapsed natural />
            </div>
          )}
          {showWorkspace && (
            <>
              <div ref={workspaceExpandedRef} data-measure="workspace-expanded" className="w-max pr-1">
                <WorkspaceSwitch measured collapsed={false} />
              </div>
              <div ref={workspaceCollapsedRef} data-measure="workspace-collapsed" className="w-max pr-1">
                <WorkspaceSwitch measured collapsed />
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
    </header>
  );
}
