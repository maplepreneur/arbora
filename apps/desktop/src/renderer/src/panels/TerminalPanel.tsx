import '@xterm/xterm/css/xterm.css';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import {
  ArrowDown,
  ArrowUp,
  BrushCleaning,
  Check,
  Columns2,
  LoaderCircle,
  Play,
  Plus,
  RotateCw,
  Rows2,
  Search,
  Square,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { agentCommandLabel, CommandId, type ContextMenuItem, type TerminalInfo } from '@arbora/shared';
import { executeCommand, setTerminalPanelController } from '../commands';
import { useChordLabel } from '../keybindings';
import { useApp } from '../store';
import {
  activateTerminal,
  AGENT_TAB_ID,
  clearFinishedAgentTerminals,
  createTerminal,
  useTerminals,
  type TerminalTab,
} from '../terminal-store';
import { exitLabel } from './terminal/TerminalTabs';
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

function tabLabel(tab: TerminalTab, terminals: readonly TerminalInfo[]): string {
  if (tab.id === AGENT_TAB_ID) return 'Commands run by agents';
  return tab.panes
    .map((id) => terminals.find((t) => t.id === id)?.title)
    .filter((title) => title !== undefined)
    .join(' | ');
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

function AgentCommands({
  tab,
  terminals,
  activePaneId,
}: {
  tab: TerminalTab;
  terminals: TerminalInfo[];
  activePaneId: string | null;
}) {
  const commands = tab.panes.map((id) => terminals.find((t) => t.id === id)).filter((t) => t !== undefined);
  const selected = commands.find((t) => t.id === activePaneId) ?? commands.at(-1);
  const finished = commands.some((t) => t.exitCode !== null);
  return (
    <div className="flex h-full" data-testid="agent-commands">
      <div className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border pr-1 pl-2 text-[11px] text-fg-subtle">
          <span className="flex-1">
            {commands.length} command{commands.length === 1 ? '' : 's'}
          </span>
          {finished && (
            <IconButton
              label="Clear finished commands"
              testId="agent-commands-clear"
              onClick={clearFinishedAgentTerminals}
            >
              <BrushCleaning size={13} />
            </IconButton>
          )}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto py-0.5" aria-label="Agent commands">
          {[...commands].reverse().map((terminal) => (
            <li key={terminal.id}>
              <button
                type="button"
                data-testid="agent-command"
                data-terminal-id={terminal.id}
                aria-current={terminal.id === selected?.id}
                title={`${terminal.title}\n${terminal.thread ? `${terminal.thread} · ` : ''}${exitLabel(terminal)}`}
                onClick={() => activateTerminal(terminal.id)}
                className={clsx(
                  'flex w-full items-start gap-2 px-2 py-1 text-left',
                  terminal.id === selected?.id ? 'bg-bg-muted' : 'hover:bg-bg-muted/60',
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {terminal.exitCode === null ? (
                    <LoaderCircle size={12} className="animate-spin text-accent motion-reduce:animate-none" />
                  ) : terminal.exitCode === 0 ? (
                    <Check size={12} className="text-fg-subtle" />
                  ) : (
                    <X size={12} className="text-danger" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[11px] text-fg">
                    {agentCommandLabel(terminal.title)}
                  </span>
                  <span className="block truncate text-[10px] text-fg-subtle">
                    {terminal.thread ?? 'Agent'}
                    {terminal.exitCode !== null && terminal.exitCode !== 0 && ` · exit ${terminal.exitCode}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 flex-1">{selected && <TerminalPane key={selected.id} terminal={selected} active />}</div>
    </div>
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
  if (tab.id === AGENT_TAB_ID) return <AgentCommands tab={tab} terminals={terminals} activePaneId={activePaneId} />;
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
  const projectPath = useApp((s) => s.project?.path ?? null);
  const loaded = useTerminals((s) => s.loaded && s.loadedFor === projectPath);
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
    if (session && document.activeElement?.closest('[data-testid="panel-right"]')) session.focus();
  }, [activePaneId, activeTabId]);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex h-full flex-col" data-testid="terminal-panel">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-1">
        <span className="min-w-0 flex-1 truncate px-1 text-[11px] text-fg-subtle">
          {activeTab ? tabLabel(activeTab, terminals) : ''}
        </span>
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
