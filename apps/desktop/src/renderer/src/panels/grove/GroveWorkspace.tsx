import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Group, Panel, Separator, usePanelRef, type Layout } from 'react-resizable-panels';
import { loadThread, useAgents } from '../../agent-store';
import { setWorkspaceController } from '../../commands';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { ModeSwitch } from '../../components/ModeSwitch';
import {
  maybeAutoStart,
  focusGroveProject,
  selectSession,
  setGroveLayoutController,
  showGroveForBrowserProject,
  useGrove,
  useGroveModel,
  useGroveSidebar,
} from '../../grove-store';
import type { GroveModel } from '../../grove-model';
import { setGroupLayout, SHELL_GROUP, showRightView, updateLayout, useApp } from '../../store';
import { RightColumn } from '../shell/RightColumn';
import { SideColumn } from '../shell/SideColumn';
import { GroveEmpty } from './GroveEmpty';
import { GroveLauncher } from './GroveLauncher';
import { GroveProjectSwitch } from './GroveProjectSwitch';
import { GroveSearch } from './GroveSearch';
import { GroveSide } from './GroveSide';
import { SessionRail } from './SessionList';
import { SessionPane } from './SessionPane';

const SettingsPage = lazy(() => import('../settings/SettingsPage'));
const DesignPanel = lazy(() => import('../design/DesignPanel'));

/** Percentages. The tree, chat and side panel also have pixel minimums. */
const DEFAULT_LAYOUT: Layout = { tree: 18, chat: 32, right: 36, side: 14 };
/** Narrower windows (tiled ones) start with the side column closed; Files and Search open it. */
const COMPACT_LAYOUT: Layout = { tree: 26, chat: 36, right: 38, side: 0 };
const COMPACT_WIDTH = 1100;

/** Below this content width the tree is a rail of status dots and only the chat shows. */
const NARROW_WIDTH = 520;

type PanelRef = ReturnType<typeof usePanelRef>;

function isCollapsed(ref: PanelRef): boolean {
  return ref.current?.isCollapsed() ?? false;
}

function reveal(ref: PanelRef): void {
  if (isCollapsed(ref)) ref.current?.expand();
}

/** Expands `ref`; when the other columns are at their minimums, `makeRoom` collapses them in order. */
function revealWithRoom(ref: PanelRef, makeRoom: readonly PanelRef[]): void {
  reveal(ref);
  for (const other of makeRoom) {
    if (!isCollapsed(ref)) return;
    other.current?.collapse();
    reveal(ref);
  }
}

function toggle(ref: PanelRef, makeRoom: readonly PanelRef[]): void {
  if (isCollapsed(ref)) revealWithRoom(ref, makeRoom);
  else ref.current?.collapse();
}

function Handle({ id }: { id: string }) {
  return (
    <Separator
      id={id}
      className="relative w-px bg-border outline-none transition-colors hover:bg-accent focus-visible:bg-accent data-[separator=active]:bg-accent"
    />
  );
}

function Chat({ model, projectPath }: { model: GroveModel; projectPath: string }) {
  const designMode = useApp((s) => s.mode.kind === 'design');
  const loaded = useAgents((s) => s.loaded);
  const selectedId = useApp((s) => s.layout.groveThreadId);
  const session = selectedId === null ? undefined : model.byId.get(selectedId);
  if (session && !designMode) return <SessionPane session={session} model={model} projectPath={projectPath} />;
  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-8 shrink-0 items-center border-b border-border px-2">
        <ModeSwitch />
      </div>
      <div className="min-h-0 flex-1">
        {designMode ? (
          <Suspense fallback={null}>
            <DesignPanel />
          </Suspense>
        ) : (
          loaded && model.listed.length === 0 && <GroveEmpty />
        )}
      </div>
    </div>
  );
}

/** Settings covers everything right of the tree, so the tree stays usable beside it. */
function SettingsLayer({ treeRef }: { treeRef: { current: HTMLElement | null } }) {
  const [left, setLeft] = useState(0);
  useLayoutEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const measure = (): void => setLeft(tree.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tree);
    return () => observer.disconnect();
  }, [treeRef]);
  return (
    <div className="absolute inset-y-0 right-0 z-10 border-l border-border bg-bg" style={{ left }}>
      <ErrorBoundary label="Settings">
        <Suspense fallback={null}>
          <SettingsPage />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

function Columns({ model, projectPath, width }: { model: GroveModel; projectPath: string; width: number }) {
  const [initial] = useState(() => {
    const saved = useApp.getState().layout.groups[SHELL_GROUP];
    if (saved && Object.keys(saved).length === 4) return saved;
    return width < COMPACT_WIDTH ? COMPACT_LAYOUT : DEFAULT_LAYOUT;
  });
  const settingsOpen = useApp((s) => s.settingsOpen);
  const treeRef = usePanelRef();
  const chatRef = usePanelRef();
  const rightRef = usePanelRef();
  const sideRef = usePanelRef();
  const treeElement = useRef<HTMLElement>(null);
  const [maximized, setMaximized] = useState(() => (initial['chat'] ?? 1) === 0);
  const focusRequest = useGrove((s) => s.listFocusRequest);
  const handledFocus = useRef(focusRequest);

  const toggleMaximize = useCallback((): void => {
    if (isCollapsed(chatRef)) {
      chatRef.current?.expand();
      treeRef.current?.expand();
    } else {
      reveal(rightRef);
      chatRef.current?.collapse();
      treeRef.current?.collapse();
    }
  }, [chatRef, treeRef, rightRef]);

  useEffect(() => {
    setGroveLayoutController({ toggleList: () => toggle(treeRef, [sideRef, chatRef]) });
    setWorkspaceController({
      toggleSidebar: () => toggle(sideRef, [treeRef, chatRef]),
      toggleAgentPanel: () => toggle(chatRef, [sideRef, treeRef]),
      showAgentPanel: () => revealWithRoom(chatRef, [sideRef, treeRef]),
      toggleBottomPanel: () => toggle(rightRef, [sideRef, treeRef]),
      toggleMaximizeRight: toggleMaximize,
      showSidebarView: (view) => {
        updateLayout({ sidebarView: view });
        revealWithRoom(sideRef, [treeRef, chatRef]);
      },
      showBottomTab: (tab) => {
        showRightView(tab === 'git' ? 'changes' : tab);
        revealWithRoom(rightRef, [sideRef, treeRef]);
      },
      revealPanel: (panel) => {
        if (panel === 'sidebar') revealWithRoom(sideRef, [treeRef, chatRef]);
        else if (panel === 'agent') revealWithRoom(chatRef, [sideRef, treeRef]);
        else revealWithRoom(rightRef, [sideRef, treeRef]);
      },
    });
    return () => {
      setGroveLayoutController(null);
      setWorkspaceController(null);
    };
  }, [treeRef, chatRef, rightRef, sideRef, toggleMaximize]);

  useEffect(() => {
    if (focusRequest === handledFocus.current) return;
    handledFocus.current = focusRequest;
    revealWithRoom(treeRef, [sideRef, chatRef]);
  }, [focusRequest, treeRef, sideRef, chatRef]);

  return (
    <div className="relative flex min-w-0 flex-1">
      <Group
        id={SHELL_GROUP}
        orientation="horizontal"
        defaultLayout={initial}
        onLayoutChanged={(next, meta) => {
          setGroupLayout(SHELL_GROUP, meta.requestedLayout ?? next);
          setMaximized((next['chat'] ?? 0) === 0);
        }}
        className="min-w-0 flex-1"
      >
        <Panel id="tree" panelRef={treeRef} collapsible collapsedSize={0} minSize="170px" maxSize="40%">
          <nav
            ref={treeElement}
            data-testid="panel-tree"
            data-landmark="tree"
            aria-label="Projects"
            className="h-full overflow-hidden"
          >
            <GroveSide />
          </nav>
        </Panel>
        <Handle id="sep-tree" />
        <Panel id="chat" panelRef={chatRef} collapsible collapsedSize={0} minSize="260px">
          <main data-testid="panel-chat" data-landmark="agent" aria-label="Agent chat" className="h-full min-w-0">
            <Chat model={model} projectPath={projectPath} />
          </main>
        </Panel>
        <Handle id="sep-chat" />
        <Panel id="right" panelRef={rightRef} collapsible collapsedSize={0} minSize="240px">
          <RightColumn maximized={maximized} onToggleMaximize={toggleMaximize} />
        </Panel>
        <Handle id="sep-side" />
        <Panel id="side" panelRef={sideRef} collapsible collapsedSize={0} minSize="160px" maxSize="35%">
          <SideColumn />
        </Panel>
      </Group>
      {settingsOpen && <SettingsLayer treeRef={treeElement} />}
    </div>
  );
}

/**
 * The window: every Grove project in the tree, the selected agent's chat, and the selected
 * project's page, terminals and files on the right. The page, terminals and agents keep running
 * whatever is selected.
 */
export default function GroveWorkspace() {
  const model = useGroveModel();
  const sidebar = useGroveSidebar();
  const projectPath = useApp((s) => s.project?.path ?? '');
  const selectedId = useApp((s) => s.layout.groveThreadId);
  const epoch = useApp((s) => s.layoutEpoch);
  const launcherOpen = useGrove((s) => s.launcherOpen);
  const loaded = useAgents((s) => s.loaded);
  const agentCount = useAgents((s) => s.agents.length);
  const container = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState<boolean | null>(null);
  const [firstWidth, setFirstWidth] = useState(0);

  const selected = selectedId === null ? undefined : model.byId.get(selectedId);
  const selectedSessionId = selected?.id;
  const fallbackId = selected ? null : ((model.order[0] ?? model.listed[0])?.id ?? null);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = (next: number): void => {
      setFirstWidth((current) => current || next);
      setNarrow(next < NARROW_WIDTH);
    };
    measure(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    maybeAutoStart();
  }, [loaded, agentCount, projectPath]);

  // The tree is how you get back to a project, so the one this window opens is listed there.
  useEffect(() => {
    if (!projectPath || useGrove.getState().dismissedOpenPath === projectPath) return;
    void showGroveForBrowserProject();
  }, [projectPath]);

  // A window without a project opens the first project the tree lists.
  useEffect(() => {
    if (useApp.getState().project) return;
    const first = useApp.getState().settings.grove.projects[0]?.path;
    if (first) void focusGroveProject(first).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (fallbackId) selectSession(fallbackId, { focus: false });
  }, [fallbackId]);

  useEffect(() => {
    if (selectedSessionId) void loadThread(selectedSessionId).catch(() => undefined);
  }, [selectedSessionId]);

  return (
    <div
      ref={container}
      className="flex min-h-0 min-w-0 flex-1"
      data-testid="grove"
      data-shell="true"
      data-narrow={narrow === true || undefined}
    >
      {narrow === null ? null : narrow ? (
        <>
          <SessionRail sessions={sidebar.order.map((row) => row.session)} selectedId={selectedSessionId ?? null} />
          <main data-testid="panel-chat" data-landmark="agent" aria-label="Agent chat" className="min-w-0 flex-1">
            <Chat model={model} projectPath={projectPath} />
          </main>
        </>
      ) : (
        <Columns key={`shell-${epoch}`} model={model} projectPath={projectPath} width={firstWidth} />
      )}
      {launcherOpen && <GroveLauncher />}
      <GroveSearch />
      <GroveProjectSwitch />
    </div>
  );
}
