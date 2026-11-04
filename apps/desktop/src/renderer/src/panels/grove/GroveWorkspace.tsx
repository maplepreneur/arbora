import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Group, Panel, Separator, usePanelRef, type Layout } from 'react-resizable-panels';
import { loadThread, useAgents } from '../../agent-store';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import {
  focusGroveProject,
  maybeAutoStart,
  selectSession,
  setGroveLayoutController,
  useGrove,
  useGroveModel,
  useGroveSidebar,
} from '../../grove-store';
import type { GroveModel } from '../../grove-model';
import { GROVE_GROUP, setGroupLayout, useApp } from '../../store';
import { GroveEmpty } from './GroveEmpty';
import { GroveLauncher } from './GroveLauncher';
import { GroveProjectSwitch } from './GroveProjectSwitch';
import { GroveSearch } from './GroveSearch';
import { GroveSide } from './GroveSide';
import { GroveTerminal } from './GroveTerminal';
import { SessionRail } from './SessionList';
import { SessionPane } from './SessionPane';

const SettingsPage = lazy(() => import('../settings/SettingsPage'));

/** Percentages, like the browser layout's groups. */
const DEFAULT_LAYOUT: Layout = { 'grove-list': 24, 'grove-main': 76 };

/** Below this content width the list is a rail of status dots. */
const NARROW_WIDTH = 520;

/**
 * The list and the pane, resizable. Mounted only when the window is wide enough, so the rail a
 * narrow window forces is never saved as the list's size.
 */
function GroveColumns({ list, pane }: { list: ReactNode; pane: ReactNode }) {
  const [initial] = useState(() => useApp.getState().layout.groups[GROVE_GROUP] ?? DEFAULT_LAYOUT);
  const listRef = usePanelRef();
  const focusRequest = useGrove((s) => s.listFocusRequest);
  const handledFocus = useRef(focusRequest);

  useEffect(() => {
    setGroveLayoutController({
      toggleList: () => {
        const panel = listRef.current;
        if (panel?.isCollapsed()) panel.expand();
        else panel?.collapse();
      },
    });
    return () => setGroveLayoutController(null);
  }, [listRef]);

  useEffect(() => {
    if (focusRequest === handledFocus.current) return;
    handledFocus.current = focusRequest;
    if (listRef.current?.isCollapsed()) listRef.current.expand();
  }, [focusRequest, listRef]);

  return (
    <Group
      id={GROVE_GROUP}
      orientation="horizontal"
      defaultLayout={initial}
      onLayoutChanged={(next, meta) => setGroupLayout(GROVE_GROUP, meta.requestedLayout ?? next)}
      className="min-w-0 flex-1"
    >
      <Panel
        id="grove-list"
        panelRef={listRef}
        collapsible
        collapsedSize={0}
        minSize="180px"
        maxSize="45%"
        defaultSize="24%"
      >
        {list}
      </Panel>
      <Separator
        id="sep-grove"
        className="relative w-px bg-border outline-none transition-colors hover:bg-accent focus-visible:bg-accent data-[separator=active]:bg-accent"
      />
      <Panel id="grove-main" minSize="280px" defaultSize="76%">
        {pane}
      </Panel>
    </Group>
  );
}

function Pane({ model, projectPath }: { model: GroveModel; projectPath: string }) {
  const settingsOpen = useApp((s) => s.settingsOpen);
  const loaded = useAgents((s) => s.loaded);
  const selectedId = useApp((s) => s.layout.groveThreadId);
  const terminalId = useGrove((s) => s.terminalId);
  const session = selectedId === null ? undefined : model.byId.get(selectedId);
  if (settingsOpen) {
    return (
      <ErrorBoundary label="Settings">
        <Suspense fallback={null}>
          <SettingsPage />
        </Suspense>
      </ErrorBoundary>
    );
  }
  if (terminalId) return <GroveTerminal id={terminalId} />;
  if (session) return <SessionPane session={session} model={model} projectPath={projectPath} />;
  if (loaded && model.listed.length === 0) return <GroveEmpty />;
  return <div className="h-full bg-bg" />;
}

/**
 * Grove: every agent session of the project, in place of the browser layout. The page, the
 * terminals and the agents keep running while it shows.
 */
export default function GroveWorkspace() {
  const model = useGroveModel();
  const sidebar = useGroveSidebar();
  const windowPath = useApp((s) => s.project?.path ?? '');
  const focusPath = useGrove((s) => s.focusPath);
  const projectPath = focusPath ?? windowPath;
  const selectedId = useApp((s) => s.layout.groveThreadId);
  const epoch = useApp((s) => s.layoutEpoch);
  const launcherOpen = useGrove((s) => s.launcherOpen);
  const terminalShown = useGrove((s) => s.terminalId);
  const loaded = useAgents((s) => s.loaded);
  const agentCount = useAgents((s) => s.agents.length);
  const container = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState<boolean | null>(null);

  const selected = selectedId === null ? undefined : model.byId.get(selectedId);
  const selectedSessionId = selected?.id;
  const fallbackId = selected ? null : ((model.order[0] ?? model.listed[0])?.id ?? null);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    setNarrow(element.getBoundingClientRect().width < NARROW_WIDTH);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setNarrow(entry.contentRect.width < NARROW_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    maybeAutoStart();
  }, [loaded, agentCount, projectPath]);

  useEffect(() => {
    const listed = useApp.getState().settings.grove.projects.map((entry) => entry.path);
    const openPath = useApp.getState().project?.path;
    const focus = useGrove.getState().focusPath;
    if (listed.length === 0) return;
    if (focus && listed.includes(focus)) return;
    if (!focus && openPath && listed.includes(openPath)) return;
    const next = listed[0];
    if (next) void focusGroveProject(next === openPath ? null : next);
  }, []);

  useEffect(() => {
    if (terminalShown) return;
    if (fallbackId) selectSession(fallbackId, { focus: false });
  }, [fallbackId, terminalShown]);

  useEffect(() => {
    if (selectedSessionId) void loadThread(selectedSessionId).catch(() => undefined);
  }, [selectedSessionId]);

  const pane = (
    <main data-landmark="center" aria-label="Agent session" className="h-full min-w-0">
      <Pane model={model} projectPath={projectPath} />
    </main>
  );

  return (
    <div
      ref={container}
      className="flex min-h-0 min-w-0 flex-1"
      data-testid="grove"
      data-narrow={narrow === true || undefined}
    >
      {narrow === null ? null : narrow ? (
        <>
          <SessionRail sessions={sidebar.order.map((row) => row.session)} selectedId={selectedSessionId ?? null} />
          <div className="min-w-0 flex-1">{pane}</div>
        </>
      ) : (
        <GroveColumns key={`grove-${epoch}`} list={<GroveSide />} pane={pane} />
      )}
      {launcherOpen && <GroveLauncher />}
      <GroveSearch />
      <GroveProjectSwitch />
    </div>
  );
}
