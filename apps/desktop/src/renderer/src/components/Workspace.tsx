import { lazy, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { Group, Panel, Separator, usePanelRef, type Layout } from 'react-resizable-panels';
import { Files, GitBranch, Search, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { CommandId, type BottomTab, type SidebarView } from '@arbora/shared';
import { executeCommand, setWorkspaceController } from '../commands';
import { allDiagnostics, useFiles } from '../files-store';
import { useChordLabel } from '../keybindings';
import { setGroupLayout, updateLayout, useApp } from '../store';
import { EditorTabs } from './EditorTabs';

const BrowserPanel = lazy(() => import('../panels/BrowserPanel'));
const AgentPanel = lazy(() => import('../panels/AgentPanel'));
const DesignPanel = lazy(() => import('../panels/design/DesignPanel'));
const SettingsPage = lazy(() => import('../panels/settings/SettingsPage'));
const TerminalPanel = lazy(() => import('../panels/TerminalPanel'));
const GitPanel = lazy(() => import('../panels/GitPanel'));
const ProblemsPanel = lazy(() => import('../panels/ProblemsPanel'));
const FilesPanel = lazy(() => import('../panels/FilesPanel'));
const SearchPanel = lazy(() => import('../panels/SearchPanel'));
const EditorPanel = lazy(() => import('../panels/editor/EditorPanel'));

export const MAIN_GROUP = 'arbora.main';
export const CENTER_GROUP = 'arbora.center';

/** Default sizes in percent; the left and bottom panels also have pixel minimums. */
const DEFAULT_MAIN: Layout = { sidebar: 18, center: 56, agent: 26 };
const DEFAULT_CENTER: Layout = { browser: 72, bottom: 28 };

const SIDEBAR_VIEWS: readonly { id: SidebarView; label: string; icon: LucideIcon; command: string }[] = [
  { id: 'files', label: 'Files', icon: Files, command: CommandId.showFiles },
  { id: 'git', label: 'Source Control', icon: GitBranch, command: CommandId.showGitSidebar },
  { id: 'search', label: 'Search', icon: Search, command: CommandId.showSearch },
];

const BOTTOM_TABS: readonly { id: BottomTab; label: string }[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'git', label: 'Git' },
  { id: 'problems', label: 'Problems' },
];

function ProblemCount() {
  const page = useApp((s) => s.problems.filter((p) => p.level === 'error').length);
  const code = useFiles((s) => allDiagnostics(s).filter((d) => d.severity === 'error').length);
  const errors = page + code;
  if (errors === 0) return null;
  return (
    <span
      data-testid="problems-badge"
      className="ml-1.5 rounded-full bg-danger px-1.5 text-[10px] leading-4 font-medium text-white tabular-nums"
    >
      {errors}
    </span>
  );
}

function PanelFallback() {
  return <div className="h-full w-full bg-bg" />;
}

function ResizeHandle({ orientation, id }: { orientation: 'horizontal' | 'vertical'; id: string }) {
  return (
    <Separator
      id={id}
      className={clsx(
        'relative bg-border outline-none transition-colors hover:bg-accent focus-visible:bg-accent data-[separator=active]:bg-accent',
        orientation === 'horizontal' ? 'w-px' : 'h-px',
      )}
    />
  );
}

function SidebarContent({ view }: { view: SidebarView }) {
  switch (view) {
    case 'files':
      return <FilesPanel />;
    case 'git':
      return <GitPanel variant="sidebar" />;
    case 'search':
      return <SearchPanel />;
    default: {
      const unreachable: never = view;
      return unreachable;
    }
  }
}

function BottomContent({ tab }: { tab: BottomTab }) {
  switch (tab) {
    case 'terminal':
      return <TerminalPanel />;
    case 'git':
      return <GitPanel variant="panel" />;
    case 'problems':
      return <ProblemsPanel />;
    default: {
      const unreachable: never = tab;
      return unreachable;
    }
  }
}

/** Settings, the browser, or the active editor or diff tab. */
function CenterContent() {
  const settingsOpen = useApp((s) => s.settingsOpen);
  const editorActive = useFiles((s) => s.active !== null);
  if (settingsOpen) return <SettingsPage />;
  return editorActive ? <EditorPanel /> : <BrowserPanel />;
}

function ActivityRail({
  active,
  sidebarOpen,
  onSelect,
}: {
  active: SidebarView;
  sidebarOpen: boolean;
  onSelect: (view: SidebarView) => void;
}) {
  return (
    <nav
      aria-label="Activity"
      data-testid="activity-rail"
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-subtle py-2"
    >
      {SIDEBAR_VIEWS.map(({ id, label, icon: Icon }) => (
        <RailButton key={id} id={id} label={label} selected={sidebarOpen && active === id} onClick={() => onSelect(id)}>
          <Icon size={18} />
        </RailButton>
      ))}
    </nav>
  );
}

function RailButton({
  id,
  label,
  selected,
  onClick,
  children,
}: {
  id: SidebarView;
  label: string;
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const command = SIDEBAR_VIEWS.find((v) => v.id === id)?.command ?? '';
  const chord = useChordLabel(command);
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      title={chord ? `${label} (${chord})` : label}
      data-testid={`rail-${id}`}
      onClick={onClick}
      className={clsx(
        'flex h-9 w-9 items-center justify-center rounded-md',
        selected ? 'bg-bg-muted text-fg' : 'text-fg-subtle hover:bg-bg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Layout from PLAN 4.1: activity rail, collapsible sidebar, centre browser with a bottom drawer
 * (Terminal, Git, Problems), and the agent panel on the right. Sizes and collapsed state are saved
 * per project through `project.saveLayout`.
 */
export function Workspace() {
  const layout = useApp((s) => s.layout);
  const designMode = useApp((s) => s.mode.kind === 'design');
  const settingsOpen = useApp((s) => s.settingsOpen);
  const epoch = useApp((s) => s.layoutEpoch);
  const sidebarRef = usePanelRef();
  const agentRef = usePanelRef();
  const bottomRef = usePanelRef();

  // Read once per mount (epoch); later changes come from the groups themselves.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mainDefault = useMemo(() => layout.groups[MAIN_GROUP] ?? DEFAULT_MAIN, [epoch]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const centerDefault = useMemo(() => layout.groups[CENTER_GROUP] ?? DEFAULT_CENTER, [epoch]);

  const isCollapsed = (ref: typeof sidebarRef): boolean => ref.current?.isCollapsed() ?? false;
  const toggle = (ref: typeof sidebarRef): void => {
    if (isCollapsed(ref)) ref.current?.expand();
    else ref.current?.collapse();
  };

  useEffect(() => {
    setWorkspaceController({
      toggleSidebar: () => toggle(sidebarRef),
      toggleAgentPanel: () => toggle(agentRef),
      showAgentPanel: () => {
        if (isCollapsed(agentRef)) agentRef.current?.expand();
      },
      toggleBottomPanel: () => toggle(bottomRef),
      showSidebarView: (view) => {
        updateLayout({ sidebarView: view });
        if (isCollapsed(sidebarRef)) sidebarRef.current?.expand();
      },
      showBottomTab: (tab) => {
        updateLayout({ bottomTab: tab });
        if (isCollapsed(bottomRef)) bottomRef.current?.expand();
      },
    });
    return () => setWorkspaceController(null);
    // Refs are stable objects; registering once per mount is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);

  const sidebarOpen = (layout.groups[MAIN_GROUP]?.['sidebar'] ?? DEFAULT_MAIN['sidebar'] ?? 0) > 0;

  const selectView = (view: SidebarView): void => {
    if (view === layout.sidebarView && !isCollapsed(sidebarRef)) {
      sidebarRef.current?.collapse();
      return;
    }
    const command = SIDEBAR_VIEWS.find((v) => v.id === view)?.command;
    if (command) executeCommand(command);
  };

  return (
    <div className="flex min-h-0 flex-1" data-testid="workspace">
      <ActivityRail active={layout.sidebarView} sidebarOpen={sidebarOpen} onSelect={selectView} />
      <Group
        key={`main-${epoch}`}
        id={MAIN_GROUP}
        orientation="horizontal"
        defaultLayout={mainDefault}
        onLayoutChanged={(next, meta) => setGroupLayout(MAIN_GROUP, meta.requestedLayout ?? next)}
        className="min-w-0 flex-1"
      >
        <Panel
          id="sidebar"
          panelRef={sidebarRef}
          collapsible
          collapsedSize={0}
          minSize="160px"
          defaultSize={DEFAULT_MAIN['sidebar']}
        >
          <aside data-testid="panel-sidebar" className="h-full overflow-hidden bg-bg-subtle">
            <Suspense fallback={<PanelFallback />}>
              <SidebarContent view={layout.sidebarView} />
            </Suspense>
          </aside>
        </Panel>
        <ResizeHandle id="sep-sidebar" orientation="horizontal" />
        <Panel id="center" minSize="240px" defaultSize={DEFAULT_MAIN['center']}>
          <Group
            key={`center-${epoch}`}
            id={CENTER_GROUP}
            orientation="vertical"
            defaultLayout={centerDefault}
            onLayoutChanged={(next, meta) => setGroupLayout(CENTER_GROUP, meta.requestedLayout ?? next)}
          >
            <Panel id="browser" minSize="160px" defaultSize={DEFAULT_CENTER['browser']}>
              <section data-testid="panel-browser" className="flex h-full flex-col">
                {!settingsOpen && <EditorTabs />}
                <div className="min-h-0 flex-1">
                  <Suspense fallback={<PanelFallback />}>
                    <CenterContent />
                  </Suspense>
                </div>
              </section>
            </Panel>
            <ResizeHandle id="sep-bottom" orientation="vertical" />
            <Panel
              id="bottom"
              panelRef={bottomRef}
              collapsible
              collapsedSize={0}
              minSize="96px"
              defaultSize={DEFAULT_CENTER['bottom']}
            >
              <section data-testid="panel-bottom" className="flex h-full flex-col bg-bg">
                <div
                  role="tablist"
                  aria-label="Bottom panel"
                  className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2"
                >
                  {BOTTOM_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={layout.bottomTab === tab.id}
                      data-testid={`bottom-tab-${tab.id}`}
                      onClick={() => updateLayout({ bottomTab: tab.id })}
                      className={clsx(
                        'h-6 rounded px-2 text-xs',
                        layout.bottomTab === tab.id ? 'bg-bg-muted text-fg' : 'text-fg-subtle hover:text-fg',
                      )}
                    >
                      {tab.label}
                      {tab.id === 'problems' && <ProblemCount />}
                    </button>
                  ))}
                </div>
                <div className="min-h-0 flex-1">
                  <Suspense fallback={<PanelFallback />}>
                    <BottomContent tab={layout.bottomTab} />
                  </Suspense>
                </div>
              </section>
            </Panel>
          </Group>
        </Panel>
        <ResizeHandle id="sep-agent" orientation="horizontal" />
        <Panel
          id="agent"
          panelRef={agentRef}
          collapsible
          collapsedSize={0}
          minSize="200px"
          defaultSize={DEFAULT_MAIN['agent']}
        >
          <aside data-testid="panel-agent" className="h-full overflow-hidden bg-bg-subtle">
            <Suspense fallback={<PanelFallback />}>{designMode ? <DesignPanel /> : <AgentPanel />}</Suspense>
          </aside>
        </Panel>
      </Group>
    </div>
  );
}
