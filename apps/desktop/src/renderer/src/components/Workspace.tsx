import type { PanelLayout } from '@arbora/shared';
import { Suspense, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Group,
  Panel,
  Separator,
  usePanelRef,
  type Layout,
  type PanelImperativeHandle,
} from 'react-resizable-panels';
import { useAppState, useServices } from '../context';
import { AgentPanel, BottomPanel, BrowserPanel, SidebarPanel } from '../lazy';
import type { PanelId } from '../store';
import { ActivityRail, type SidebarView } from './ActivityRail';

const HORIZONTAL_GROUP = 'workspace-horizontal';
const VERTICAL_GROUP = 'workspace-vertical';
const SAVE_DEBOUNCE_MS = 300;
const COLLAPSIBLE_PANELS: readonly PanelId[] = ['sidebar', 'agent', 'bottom'];
/** Collapsible panels collapse to 0%; anything this small is collapsed. */
const COLLAPSED_EPSILON = 0.5;

export function Workspace() {
  const { bridge } = useServices();
  const [layout, setLayout] = useState<PanelLayout | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void bridge.invoke.getLayout().then((saved) => {
      if (active) setLayout(saved);
    });
    return () => {
      active = false;
    };
  }, [bridge]);

  // Groups only read `defaultLayout` on mount, so wait for the saved layout before rendering.
  if (layout === undefined) return null;
  return <WorkspaceLayout initial={layout ?? { sizes: {}, collapsed: {} }} />;
}

function PanelFallback() {
  return <div className="h-full bg-bg" />;
}

function SeparatorHandle({ orientation }: { orientation: 'horizontal' | 'vertical' }) {
  return (
    <Separator
      className={`bg-border transition-colors hover:bg-accent data-[separator=active]:bg-accent ${
        orientation === 'horizontal' ? 'w-px' : 'h-px'
      }`}
    />
  );
}

function WorkspaceLayout({ initial }: { initial: PanelLayout }) {
  const { bridge } = useServices();
  const panelToggle = useAppState((state) => state.panelToggle);
  const [sidebarView, setSidebarView] = useState<SidebarView>('files');
  const sidebarRef = usePanelRef();
  const agentRef = usePanelRef();
  const bottomRef = usePanelRef();
  const layoutRef = useRef<PanelLayout>(initial);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const persist = (groupId: string, actual: Layout, requested: Layout | undefined): void => {
    // Imperative panel handles throw while a group is still registering (the first
    // `onLayoutChanged` fires on mount), so derive collapsed state from the layout itself.
    const collapsed: Record<string, boolean> = {};
    for (const id of COLLAPSIBLE_PANELS) {
      const size = actual[id];
      if (size !== undefined) collapsed[id] = size < COLLAPSED_EPSILON;
    }
    layoutRef.current = {
      sizes: { ...layoutRef.current.sizes, [groupId]: requested ?? actual },
      collapsed: { ...layoutRef.current.collapsed, ...collapsed },
    };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void bridge.invoke.setLayout(layoutRef.current);
    }, SAVE_DEBOUNCE_MS);
  };

  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
    },
    [],
  );

  const lastToggle = useRef(panelToggle?.seq);
  useEffect(() => {
    if (!panelToggle || panelToggle.seq === lastToggle.current) return;
    lastToggle.current = panelToggle.seq;
    const panels: Record<PanelId, RefObject<PanelImperativeHandle | null>> = {
      sidebar: sidebarRef,
      agent: agentRef,
      bottom: bottomRef,
    };
    const panel = panels[panelToggle.panel].current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, [panelToggle, sidebarRef, agentRef, bottomRef]);

  const selectSidebarView = (view: SidebarView): void => {
    const panel = sidebarRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
    } else if (view === sidebarView) {
      panel.collapse();
    }
    setSidebarView(view);
  };

  const lazyPanel = (node: ReactNode): ReactNode => (
    <Suspense fallback={<PanelFallback />}>{node}</Suspense>
  );

  return (
    <div data-testid="workspace" className="flex h-full">
      <ActivityRail active={sidebarView} onSelect={selectSidebarView} />
      <Group
        id={HORIZONTAL_GROUP}
        orientation="horizontal"
        className="min-w-0 flex-1"
        defaultLayout={initial.sizes[HORIZONTAL_GROUP]}
        onLayoutChanged={(layout, meta) => {
          persist(HORIZONTAL_GROUP, layout, meta.requestedLayout);
        }}
      >
        <Panel
          id="sidebar"
          panelRef={sidebarRef}
          defaultSize="18"
          minSize={180}
          collapsible
          className="bg-surface"
        >
          {lazyPanel(<SidebarPanel view={sidebarView} />)}
        </Panel>
        <SeparatorHandle orientation="horizontal" />
        <Panel id="center" defaultSize="57" minSize={320}>
          <Group
            id={VERTICAL_GROUP}
            orientation="vertical"
            defaultLayout={initial.sizes[VERTICAL_GROUP]}
            onLayoutChanged={(layout, meta) => {
              persist(VERTICAL_GROUP, layout, meta.requestedLayout);
            }}
          >
            <Panel id="browser" defaultSize="72" minSize={160}>
              {lazyPanel(<BrowserPanel />)}
            </Panel>
            <SeparatorHandle orientation="vertical" />
            <Panel
              id="bottom"
              panelRef={bottomRef}
              defaultSize="28"
              minSize={120}
              collapsible
              className="bg-surface"
            >
              {lazyPanel(<BottomPanel />)}
            </Panel>
          </Group>
        </Panel>
        <SeparatorHandle orientation="horizontal" />
        <Panel
          id="agent"
          panelRef={agentRef}
          defaultSize="25"
          minSize={280}
          collapsible
          className="bg-surface"
        >
          {lazyPanel(<AgentPanel />)}
        </Panel>
      </Group>
    </div>
  );
}
