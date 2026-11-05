import { lazy, Suspense, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { GitCompare, Globe, Maximize2, Minimize2, PanelRightOpen, Plus, TriangleAlert, X } from 'lucide-react';
import clsx from 'clsx';
import { CommandId } from '@arbora/shared';
import { executeCommand } from '../../commands';
import { EditorTabButtons } from '../../components/EditorTabButtons';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { allDiagnostics, showBrowserTab, useFiles } from '../../files-store';
import { useChordLabel } from '../../keybindings';
import { closeRightPanel, showRightView, useApp } from '../../store';
import { useTerminals } from '../../terminal-store';
import { TerminalTabButtons } from '../terminal/TerminalTabs';

const BrowserPanel = lazy(() => import('../BrowserPanel'));
const TerminalPanel = lazy(() => import('../TerminalPanel'));
const GitPanel = lazy(() => import('../GitPanel'));
const ProblemsPanel = lazy(() => import('../ProblemsPanel'));
const EditorPanel = lazy(() => import('../editor/EditorPanel'));

function ProblemCount() {
  const page = useApp((s) => s.problems.filter((p) => p.level === 'error').length);
  const code = useFiles((s) => allDiagnostics(s).filter((d) => d.severity === 'error').length);
  const errors = page + code;
  if (errors === 0) return null;
  return (
    <span
      data-testid="problems-badge"
      className="rounded-full bg-danger px-1.5 text-[10px] leading-4 font-medium text-white tabular-nums"
    >
      {errors}
    </span>
  );
}

function StripTab({
  testId,
  active,
  onClick,
  onClose,
  children,
}: {
  testId: string;
  active: boolean;
  onClick: () => void;
  onClose?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      data-testid={testId}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onClick();
      }}
      onAuxClick={(event) => {
        if (event.button === 1) onClose?.();
      }}
      className={clsx(
        'group flex h-6 shrink-0 cursor-default items-center gap-1.5 rounded px-2 text-xs',
        onClose && 'pr-1',
        active ? 'bg-bg-muted text-fg' : 'text-fg-subtle hover:text-fg',
      )}
    >
      {children}
      {onClose && (
        <button
          type="button"
          aria-label="Close tab"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100 hover:bg-bg-subtle focus-visible:opacity-100"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

/** The strip scrolls sideways with the wheel and keeps the selected tab in view. */
function useStripScroll(ref: RefObject<HTMLDivElement | null>, key: string): void {
  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent): void => {
      if (strip.scrollWidth <= strip.clientWidth || event.deltaX !== 0) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    };
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, [ref]);
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [ref, key]);
}

async function openAddMenu(): Promise<void> {
  const { id } = await window.arbora.invoke('contextMenu.show', {
    items: [
      { id: 'file', label: 'File…' },
      { id: 'terminal', label: 'Terminal' },
      { id: 'browser', label: 'Browser' },
      { type: 'separator' },
      { id: 'changes', label: 'Changes' },
      { id: 'problems', label: 'Problems' },
    ],
  });
  switch (id) {
    case 'file':
      useFiles.setState({ quickOpen: true });
      return;
    case 'terminal':
      executeCommand(CommandId.terminalNew);
      return;
    case 'browser':
      showBrowserTab();
      return;
    case 'changes':
    case 'problems':
      showRightView(id);
      return;
    default:
      return;
  }
}

interface ColumnControls {
  maximized: boolean;
  onToggleMaximize: () => void;
  sideOpen: boolean;
  onToggleSide: () => void;
}

function Strip({ maximized, onToggleMaximize, sideOpen, onToggleSide }: ColumnControls) {
  const view = useApp((s) => s.layout.rightView);
  const panels = useApp((s) => s.layout.rightPanels);
  const terminalTab = useTerminals((s) => s.activeTabId);
  const editorTab = useFiles((s) => s.active);
  const maximizeChord = useChordLabel(CommandId.toggleMaximizeRight);
  const sideChord = useChordLabel(CommandId.toggleSideColumn);
  const showSideLabel = `Show files, source control and search${sideChord ? ` (${sideChord})` : ''}`;
  const ref = useRef<HTMLDivElement>(null);
  useStripScroll(ref, `${view}:${terminalTab ?? ''}:${editorTab ?? ''}`);
  const maximizeLabel = `${maximized ? 'Restore columns' : 'Maximize'}${maximizeChord ? ` (${maximizeChord})` : ''}`;
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-1.5">
      <div
        ref={ref}
        role="tablist"
        aria-label="Project tabs"
        data-testid="right-tabs"
        className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
      >
        <StripTab testId="right-tab-browser" active={view === 'browser'} onClick={showBrowserTab}>
          <Globe size={13} className="shrink-0" /> Browser
        </StripTab>
        <TerminalTabButtons showing={view === 'terminal'} />
        <EditorTabButtons showing={view === 'editor'} />
        {panels.includes('changes') && (
          <StripTab
            testId="right-tab-changes"
            active={view === 'changes'}
            onClick={() => showRightView('changes')}
            onClose={() => closeRightPanel('changes')}
          >
            <GitCompare size={13} className="shrink-0" /> Changes
          </StripTab>
        )}
        {panels.includes('problems') && (
          <StripTab
            testId="right-tab-problems"
            active={view === 'problems'}
            onClick={() => showRightView('problems')}
            onClose={() => closeRightPanel('problems')}
          >
            <TriangleAlert size={13} className="shrink-0" /> Problems <ProblemCount />
          </StripTab>
        )}
      </div>
      <button
        type="button"
        aria-label="Open a tab"
        title="Open a file, terminal, browser, changes or problems"
        data-testid="right-add"
        onClick={() => void openAddMenu()}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
      >
        <Plus size={14} />
      </button>
      <button
        type="button"
        aria-label={maximizeLabel}
        aria-pressed={maximized}
        title={maximizeLabel}
        data-testid="right-maximize"
        onClick={onToggleMaximize}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
      >
        {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      </button>
      {!sideOpen && (
        <button
          type="button"
          aria-label={showSideLabel}
          title={showSideLabel}
          data-testid="side-show"
          onClick={onToggleSide}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
        >
          <PanelRightOpen size={14} />
        </button>
      )}
    </div>
  );
}

function Content() {
  const view = useApp((s) => s.layout.rightView);
  const editorActive = useFiles((s) => s.active !== null);
  switch (view) {
    case 'browser':
      return <BrowserPanel />;
    case 'terminal':
      return <TerminalPanel />;
    case 'editor':
      return editorActive ? <EditorPanel /> : <BrowserPanel />;
    case 'changes':
      return <GitPanel variant="panel" />;
    case 'problems':
      return <ProblemsPanel />;
    default: {
      const unreachable: never = view;
      return unreachable;
    }
  }
}

/**
 * The selected project's tools: its page, terminals, open files and diffs, Changes and Problems,
 * in one tab strip. Hidden behind Settings, so the native page view comes down with it.
 */
export function RightColumn(controls: ColumnControls) {
  const project = useApp((s) => s.project);
  const settingsOpen = useApp((s) => s.settingsOpen);
  return (
    <section
      data-testid="panel-right"
      data-landmark="center"
      aria-label="Project tabs"
      className="flex h-full min-w-0 flex-col bg-bg"
    >
      <Strip {...controls} />
      <div className="min-h-0 flex-1">
        {project && !settingsOpen ? (
          <ErrorBoundary label="Project tab">
            <Suspense fallback={<div className="h-full bg-bg" />}>
              <Content />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-fg-subtle">
            {project ? '' : 'Select a project to see its page, terminals and files.'}
          </div>
        )}
      </div>
    </section>
  );
}
