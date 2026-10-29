import '@xterm/xterm/css/xterm.css';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import {
  ArrowDown,
  ArrowUp,
  Columns2,
  Play,
  Plus,
  RotateCw,
  Rows2,
  Search,
  Square,
  SquareTerminal,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { CommandId, type ContextMenuItem, type TerminalInfo } from '@arbora/shared';
import { executeCommand, setTerminalPanelController } from '../commands';
import { useChordLabel } from '../keybindings';
import { activateTerminal, createTerminal, useTerminals, type TerminalTab } from '../terminal-store';
import { copySelection, ensureSession, getSession, initTerminalSessions, pasteClipboard } from './terminal/sessions';

async function showMenu(items: ContextMenuItem[]): Promise<string | null> {
  return (await window.arbora.invoke('contextMenu.show', { items })).id;
}

async function paneMenu(terminal: TerminalInfo): Promise<void> {
  const session = getSession(terminal.id);
  const hasSelection = session?.term.hasSelection() ?? false;
  const running = terminal.exitCode === null;
  const copyKey = window.arbora.platform === 'darwin' ? 'Cmd+C' : 'Ctrl+Shift+C';
  const pasteKey = window.arbora.platform === 'darwin' ? 'Cmd+V' : 'Ctrl+Shift+V';
  const choice = await showMenu([
    { id: 'copy', label: 'Copy', enabled: hasSelection, accelerator: copyKey },
    { id: 'paste', label: 'Paste', enabled: !terminal.readOnly, accelerator: pasteKey },
    { id: 'selectAll', label: 'Select All' },
    { type: 'separator' },
    { id: 'find', label: 'Find…' },
    { id: 'clear', label: 'Clear' },
    { type: 'separator' },
    { id: 'splitRight', label: 'Split Right' },
    { id: 'splitDown', label: 'Split Down' },
    { id: 'rename', label: 'Rename…' },
    { type: 'separator' },
    { id: 'kill', label: 'Kill Process', enabled: running },
    { id: 'close', label: 'Close Terminal' },
  ]);
  if (!session) return;
  switch (choice) {
    case 'copy':
      await copySelection(session);
      break;
    case 'paste':
      await pasteClipboard(session);
      break;
    case 'selectAll':
      session.term.selectAll();
      break;
    case 'find':
      useTerminals.setState({ searchOpen: true });
      break;
    case 'clear':
      session.term.clear();
      break;
    case 'splitRight':
      executeCommand(CommandId.terminalSplitRight);
      break;
    case 'splitDown':
      executeCommand(CommandId.terminalSplitDown);
      break;
    case 'rename':
      useTerminals.setState({ renamingId: terminal.id });
      break;
    case 'kill':
      await window.arbora.invoke('terminal.kill', { id: terminal.id });
      break;
    case 'close':
      await window.arbora.invoke('terminal.close', { id: terminal.id });
      break;
    default:
      break;
  }
  if (choice !== 'find' && choice !== 'rename') session.focus();
}

let handledFocusRequest = 0;

function TerminalPane({ terminal, active }: { terminal: TerminalInfo; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const session = ensureSession(terminal.id);
    session.attach(container);
    return () => session.detach(container);
  }, [terminal.id]);

  const focusRequest = useTerminals((s) => s.focusRequest);
  useEffect(() => {
    if (!active || focusRequest <= handledFocusRequest) return;
    handledFocusRequest = focusRequest;
    getSession(terminal.id)?.focus();
  }, [active, focusRequest, terminal.id]);

  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    activateTerminal(terminal.id);
    void paneMenu(terminal);
  };

  return (
    <div
      data-testid="terminal-pane"
      data-terminal-id={terminal.id}
      data-active={active}
      onContextMenu={onContextMenu}
      onMouseDown={() => activateTerminal(terminal.id)}
      className={clsx('relative h-full w-full bg-bg pl-2 pt-1', active && 'ring-1 ring-accent/40 ring-inset')}
    >
      <div ref={ref} className="h-full w-full" />
    </div>
  );
}

function SearchBar({ terminalId }: { terminalId: string | null }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const session = getSession(terminalId);
  const close = (): void => {
    session?.search.clearDecorations();
    useTerminals.setState({ searchOpen: false });
    session?.focus();
  };
  const find = (direction: 'next' | 'previous'): void => {
    if (!session || !query) return;
    const options = {
      decorations: {
        matchBackground: '#e2b35a66',
        activeMatchBackground: '#e2b35a',
        matchOverviewRuler: '#e2b35a',
        activeMatchColorOverviewRuler: '#e2b35a',
      },
    };
    if (direction === 'next') session.search.findNext(query, options);
    else session.search.findPrevious(query, options);
  };
  return (
    <div
      data-testid="terminal-search"
      className="absolute top-1 right-3 z-10 flex items-center gap-1 rounded-md border border-border bg-bg-elevated p-1 shadow-md"
    >
      <input
        ref={inputRef}
        aria-label="Find in terminal"
        data-testid="terminal-search-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') find(e.shiftKey ? 'previous' : 'next');
          if (e.key === 'Escape') close();
        }}
        className="h-6 w-48 rounded border border-border bg-bg px-2 text-xs outline-none focus:border-accent"
        placeholder="Find"
      />
      <IconButton label="Previous match" onClick={() => find('previous')}>
        <ArrowUp size={14} />
      </IconButton>
      <IconButton label="Next match" onClick={() => find('next')}>
        <ArrowDown size={14} />
      </IconButton>
      <IconButton label="Close find" onClick={close}>
        <X size={14} />
      </IconButton>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
  testId,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
    >
      {children}
    </button>
  );
}

function TabTitle({ terminal }: { terminal: TerminalInfo }) {
  const renaming = useTerminals((s) => s.renamingId === terminal.id);
  if (!renaming) return <span className="truncate">{terminal.title}</span>;
  return <RenameInput terminal={terminal} />;
}

function RenameInput({ terminal }: { terminal: TerminalInfo }) {
  const [draft, setDraft] = useState(terminal.title);
  const finish = (save: boolean): void => {
    const title = draft.trim();
    if (save && title && title !== terminal.title)
      void window.arbora.invoke('terminal.rename', { id: terminal.id, title });
    useTerminals.setState({ renamingId: null });
    getSession(terminal.id)?.focus();
  };
  return (
    <input
      autoFocus
      aria-label="Terminal name"
      data-testid="terminal-rename-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      onClick={(e) => e.stopPropagation()}
      className="h-5 w-28 rounded border border-accent bg-bg px-1 text-xs outline-none"
    />
  );
}

function Tab({ tab, terminals, active }: { tab: TerminalTab; terminals: TerminalInfo[]; active: boolean }) {
  const members = tab.panes.map((id) => terminals.find((t) => t.id === id)).filter((t) => t !== undefined);
  const first = members[0];
  if (!first) return null;
  const exited = members.every((t) => t.exitCode !== null);
  const close = (): void => {
    for (const t of members) void window.arbora.invoke('terminal.close', { id: t.id });
  };
  const onContextMenu = async (event: MouseEvent): Promise<void> => {
    event.preventDefault();
    const choice = await showMenu([
      { id: 'rename', label: 'Rename…' },
      { id: 'kill', label: 'Kill Process', enabled: !exited },
      { type: 'separator' },
      { id: 'close', label: members.length > 1 ? 'Close Terminals' : 'Close Terminal' },
    ]);
    if (choice === 'rename') useTerminals.setState({ renamingId: first.id });
    if (choice === 'kill') for (const t of members) void window.arbora.invoke('terminal.kill', { id: t.id });
    if (choice === 'close') close();
  };
  return (
    <div
      role="tab"
      aria-selected={active}
      data-testid="terminal-tab"
      data-kind={first.kind}
      onClick={() => {
        useTerminals.setState({ activeTabId: tab.id, activePaneId: first.id });
        getSession(first.id)?.focus();
      }}
      onDoubleClick={() => useTerminals.setState({ renamingId: first.id })}
      onAuxClick={(e) => e.button === 1 && close()}
      onContextMenu={(e) => void onContextMenu(e)}
      className={clsx(
        'group flex h-6 max-w-48 shrink-0 cursor-default items-center gap-1.5 rounded px-2 text-xs',
        active ? 'bg-bg-muted text-fg' : 'text-fg-subtle hover:text-fg',
      )}
    >
      <SquareTerminal size={13} className={clsx('shrink-0', exited && 'opacity-50')} />
      {members.map((t, index) => (
        <Fragment key={t.id}>
          {index > 0 && <span className="text-fg-subtle">|</span>}
          <TabTitle terminal={t} />
        </Fragment>
      ))}
      {first.kind === 'dev' && (
        <span className="rounded bg-accent-soft px-1 text-[10px] font-medium text-accent">dev</span>
      )}
      {first.readOnly && <span className="rounded bg-bg-muted px-1 text-[10px] text-fg-muted">agent</span>}
      {exited && <span className="text-[10px] text-fg-subtle">exited</span>}
      <button
        type="button"
        aria-label={`Close ${first.title}`}
        data-testid="terminal-tab-close"
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
        className="ml-0.5 flex h-4 w-4 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-bg-subtle aria-selected:opacity-100"
      >
        <X size={11} />
      </button>
    </div>
  );
}

function DevServerButtons({ terminals }: { terminals: TerminalInfo[] }) {
  const dev = terminals.find((t) => t.kind === 'dev');
  const running = dev !== undefined && dev.exitCode === null;
  return (
    <>
      {running ? (
        <>
          <IconButton
            label="Restart Dev Server"
            testId="devserver-restart"
            onClick={() => executeCommand(CommandId.devServerRestart)}
          >
            <RotateCw size={13} />
          </IconButton>
          <IconButton
            label="Stop Dev Server"
            testId="devserver-stop"
            onClick={() => executeCommand(CommandId.devServerStop)}
          >
            <Square size={12} />
          </IconButton>
        </>
      ) : (
        <IconButton
          label="Run Dev Server"
          testId="devserver-run"
          onClick={() => executeCommand(CommandId.devServerRun)}
        >
          <Play size={13} />
        </IconButton>
      )}
    </>
  );
}

function TabContent({
  tab,
  terminals,
  activePaneId,
}: {
  tab: TerminalTab;
  terminals: TerminalInfo[];
  activePaneId: string | null;
}) {
  const panes = tab.panes.map((id) => terminals.find((t) => t.id === id)).filter((t) => t !== undefined);
  if (panes.length === 1 && panes[0]) {
    return <TerminalPane terminal={panes[0]} active />;
  }
  return (
    <Group key={`${tab.id}:${tab.panes.join(',')}:${tab.direction}`} orientation={tab.direction} className="h-full">
      {panes.map((terminal, index) => (
        <Fragment key={terminal.id}>
          {index > 0 && (
            <Separator
              className={clsx(
                'bg-border hover:bg-accent data-[separator=active]:bg-accent',
                tab.direction === 'horizontal' ? 'w-px' : 'h-px',
              )}
            />
          )}
          <Panel id={terminal.id} minSize="40px">
            <TerminalPane terminal={terminal} active={terminal.id === activePaneId} />
          </Panel>
        </Fragment>
      ))}
    </Group>
  );
}

/**
 * Terminal tabs and splits on xterm. Terminals live in main (`TerminalService`) and keep running
 * while this panel is hidden; each xterm instance is created once and moved between mounts. While a
 * terminal is focused, plain `Ctrl+<key>` chords go to the shell (`terminalPassthrough`).
 */
export default function TerminalPanel() {
  const terminals = useTerminals((s) => s.terminals);
  const tabs = useTerminals((s) => s.tabs);
  const activeTabId = useTerminals((s) => s.activeTabId);
  const activePaneId = useTerminals((s) => s.activePaneId);
  const searchOpen = useTerminals((s) => s.searchOpen);
  const loaded = useTerminals((s) => s.loaded);
  const devStarting = useTerminals((s) => s.devStarting);
  const newChord = useChordLabel(CommandId.terminalNew);
  const splitChord = useChordLabel(CommandId.terminalSplitRight);
  const autoCreated = useRef(false);

  useEffect(() => {
    initTerminalSessions();
    setTerminalPanelController({
      clear: () => getSession(useTerminals.getState().activePaneId)?.term.clear(),
      find: () => useTerminals.setState({ searchOpen: true }),
    });
    return () => setTerminalPanelController(null);
  }, []);

  // Opening the panel on a project with no terminals starts a shell, like most editors.
  useEffect(() => {
    if (!loaded || devStarting || autoCreated.current || terminals.length > 0) return;
    autoCreated.current = true;
    void createTerminal().catch(() => undefined);
  }, [loaded, devStarting, terminals.length]);

  // Focus follows the active pane when tabs switch.
  useEffect(() => {
    const session = getSession(activePaneId);
    if (session && document.activeElement?.closest('[data-testid="panel-bottom"]')) session.focus();
  }, [activePaneId, activeTabId]);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex h-full flex-col" data-testid="terminal-panel">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-1">
        <div role="tablist" aria-label="Terminals" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {tabs.map((tab) => (
            <Tab key={tab.id} tab={tab} terminals={terminals} active={tab.id === activeTabId} />
          ))}
        </div>
        <DevServerButtons terminals={terminals} />
        <IconButton label="Find in Terminal" onClick={() => executeCommand(CommandId.terminalFind)}>
          <Search size={13} />
        </IconButton>
        <IconButton
          label={splitChord ? `Split Right (${splitChord})` : 'Split Right'}
          testId="terminal-split"
          onClick={() => executeCommand(CommandId.terminalSplitRight)}
        >
          <Columns2 size={13} />
        </IconButton>
        <IconButton label="Split Down" onClick={() => executeCommand(CommandId.terminalSplitDown)}>
          <Rows2 size={13} />
        </IconButton>
        <IconButton
          label={newChord ? `New Terminal (${newChord})` : 'New Terminal'}
          testId="terminal-new"
          onClick={() => executeCommand(CommandId.terminalNew)}
        >
          <Plus size={14} />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1">
        {searchOpen && <SearchBar key={activePaneId} terminalId={activePaneId} />}
        {activeTab ? (
          <TabContent tab={activeTab} terminals={terminals} activePaneId={activePaneId} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-fg-subtle">
            {loaded ? 'No terminals' : 'Loading terminals…'}
          </div>
        )}
      </div>
    </div>
  );
}
