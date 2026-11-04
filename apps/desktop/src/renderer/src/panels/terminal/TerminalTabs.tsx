import { Fragment, useState, type MouseEvent } from 'react';
import { Bot, Columns2, LoaderCircle, SquareTerminal, X } from 'lucide-react';
import clsx from 'clsx';
import type { ContextMenuItem, TerminalInfo } from '@arbora/shared';
import { showRightView } from '../../store';
import {
  AGENT_TAB_ID,
  clearFinishedAgentTerminals,
  focusActiveTerminal,
  useTerminals,
  type TerminalTab,
} from '../../terminal-store';

async function showMenu(items: ContextMenuItem[]): Promise<string | null> {
  return (await window.arbora.invoke('contextMenu.show', { items })).id;
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
    focusActiveTerminal();
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

export function exitLabel(terminal: TerminalInfo): string {
  if (terminal.exitCode === null) return 'Running';
  return terminal.exitCode === 0 ? 'Finished' : `Exited with code ${terminal.exitCode}`;
}

function selectTab(tab: TerminalTab, paneId: string): void {
  useTerminals.setState({ activeTabId: tab.id, activePaneId: paneId });
  showRightView('terminal');
  focusActiveTerminal();
}

function AgentTab({ tab, terminals, active }: { tab: TerminalTab; terminals: TerminalInfo[]; active: boolean }) {
  const members = terminals.filter((t) => tab.panes.includes(t.id));
  const running = members.filter((t) => t.exitCode === null).length;
  const finished = members.length - running;
  const onContextMenu = async (event: MouseEvent): Promise<void> => {
    event.preventDefault();
    const choice = await showMenu([
      { id: 'clear', label: 'Clear Finished Commands', enabled: finished > 0 },
      { id: 'kill', label: 'Stop Running Commands', enabled: running > 0 },
    ]);
    if (choice === 'clear') clearFinishedAgentTerminals();
    if (choice === 'kill') {
      for (const t of members) if (t.exitCode === null) void window.arbora.invoke('terminal.kill', { id: t.id });
    }
  };
  return (
    <div
      role="tab"
      aria-selected={active}
      data-testid="terminal-tab"
      data-kind="agent"
      data-tab-id={tab.id}
      title={`Commands run by agents: ${running} running, ${finished} finished`}
      onClick={() => selectTab(tab, useTerminals.getState().activePaneId ?? tab.panes.at(-1) ?? tab.panes[0] ?? '')}
      onContextMenu={(e) => void onContextMenu(e)}
      className={clsx(
        'flex h-6 shrink-0 cursor-default items-center gap-1.5 rounded px-2 text-xs',
        active ? 'bg-bg-muted text-fg' : 'text-fg-subtle hover:text-fg',
      )}
    >
      {running > 0 ? (
        <LoaderCircle size={13} className="shrink-0 animate-spin text-accent motion-reduce:animate-none" />
      ) : (
        <Bot size={13} className="shrink-0" />
      )}
      <span>Agent</span>
      <span className="rounded-full bg-bg-subtle px-1.5 text-[10px] leading-4 text-fg-muted tabular-nums">
        {members.length}
      </span>
    </div>
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
      data-tab-id={tab.id}
      title={`${members.map((t) => t.title).join(' | ')}${exited ? ` (${exitLabel(first).toLowerCase()})` : ''}`}
      onClick={() => selectTab(tab, first.id)}
      onDoubleClick={() => useTerminals.setState({ renamingId: first.id })}
      onAuxClick={(e) => e.button === 1 && close()}
      onContextMenu={(e) => void onContextMenu(e)}
      className={clsx(
        'group flex h-6 max-w-44 shrink-0 cursor-default items-center gap-1.5 rounded pr-1 pl-2 text-xs',
        active ? 'bg-bg-muted text-fg' : 'text-fg-subtle hover:text-fg',
        exited && 'opacity-60',
      )}
    >
      {members.length > 1 ? (
        <Columns2 size={13} className="shrink-0" />
      ) : (
        <SquareTerminal size={13} className="shrink-0" />
      )}
      {members.map((t, index) => (
        <Fragment key={t.id}>
          {index > 0 && <span className="text-fg-subtle">|</span>}
          <TabTitle terminal={t} />
        </Fragment>
      ))}
      {first.kind === 'dev' && (
        <span className="rounded bg-accent-soft px-1 text-[10px] font-medium text-accent">dev</span>
      )}
      <button
        type="button"
        aria-label={`Close ${first.title}`}
        data-testid="terminal-tab-close"
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100 hover:bg-bg-subtle focus-visible:opacity-100"
      >
        <X size={11} />
      </button>
    </div>
  );
}

/** The agent tab: every command an agent ran, newest last, beside the selected command's output. */
/** The terminal tabs, drawn in the right column's tab strip beside the browser and the editors. */
export function TerminalTabButtons({ showing }: { showing: boolean }) {
  const terminals = useTerminals((s) => s.terminals);
  const tabs = useTerminals((s) => s.tabs);
  const activeTabId = useTerminals((s) => s.activeTabId);
  return (
    <>
      {tabs.map((tab) =>
        tab.id === AGENT_TAB_ID ? (
          <AgentTab key={tab.id} tab={tab} terminals={terminals} active={showing && tab.id === activeTabId} />
        ) : (
          <Tab key={tab.id} tab={tab} terminals={terminals} active={showing && tab.id === activeTabId} />
        ),
      )}
    </>
  );
}
