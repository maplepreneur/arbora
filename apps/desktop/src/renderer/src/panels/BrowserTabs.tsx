import { useEffect, useMemo, useRef, useState } from 'react';
import { AppWindow, Globe, LoaderCircle, Plus, Send, X } from 'lucide-react';
import clsx from 'clsx';
import { CommandId, type AgentModeTarget, type BrowserTabSnapshot, type ContextMenuItem } from '@arbora/shared';
import { defaultAgentModeTarget, isListed, useAgents } from '../agent-store';
import { useDefaultAgentId } from '../agent-defaults';
import { executeCommand, registerSendTabOpener, sendActiveTab } from '../commands';
import { useApp } from '../store';

/**
 * The tab strip above the URL bar. Each tab shows its page title and a role icon. Below 400px the
 * titles collapse and the role icon stays. The app tab has no close button.
 */
export function BrowserTabStrip() {
  const tabs = useApp((s) => s.browserTabs);
  const [dragged, setDragged] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [fullPage, setFullPage] = useState(false);
  useEffect(() => {
    openSendForTab = setSendingId;
    const unregister = registerSendTabOpener(() => {
      const active = useApp.getState().browserTabs.find((tab) => tab.active);
      if (active) setSendingId(active.id);
    });
    return () => {
      if (openSendForTab === setSendingId) openSendForTab = null;
      unregister();
    };
  }, []);
  if (tabs.length === 0) return null;
  return (
    <div className="relative shrink-0">
      <div
        className="@container flex h-8 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-border bg-bg-subtle px-1"
        data-testid="browser-tabs"
      >
        {tabs.map((tab, index) => (
          <TabButton
            key={tab.id}
            tab={tab}
            index={index}
            dragged={dragged === tab.id}
            onDragStart={() => setDragged(tab.id)}
            onDrop={() => {
              if (!dragged || dragged === tab.id) return;
              void window.arbora.invoke('browser.tabs.move', { id: dragged, index }).then(() => setDragged(null));
            }}
          />
        ))}
        <button
          type="button"
          aria-label="New tab"
          data-testid="browser-tab-new"
          title="New tab"
          onClick={() => executeCommand(CommandId.browserNewTab)}
          className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          aria-label="Send tab to agent"
          data-testid="browser-tab-send"
          title="Send tab to agent"
          onClick={() => {
            const active = useApp.getState().browserTabs.find((tab) => tab.active);
            if (active) setSendingId(active.id);
          }}
          className="mb-0.5 flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] text-fg-subtle hover:bg-bg-muted hover:text-fg"
        >
          <Send size={12} />
          Send
        </button>
      </div>
      {sendingId && (
        <SendTabForm
          tabId={sendingId}
          fullPage={fullPage}
          onFullPage={setFullPage}
          onClose={() => setSendingId(null)}
        />
      )}
    </div>
  );
}

function parseSendTarget(key: string): AgentModeTarget | null {
  const split = key.indexOf(':');
  if (split <= 0) return null;
  const type = key.slice(0, split);
  const id = key.slice(split + 1);
  if (!id) return null;
  if (type === 'thread') return { type: 'thread', threadId: id };
  if (type === 'new') return { type: 'new', agentId: id };
  return null;
}

/** Prompt and thread for one tab. The text defaults to the design-match ask. */
function SendTabForm({
  tabId,
  fullPage,
  onFullPage,
  onClose,
}: {
  tabId: string;
  fullPage: boolean;
  onFullPage: (fullPage: boolean) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('Implement this design');
  const [chosen, setChosen] = useState<string | null>(null);
  const threads = useAgents((s) => s.threads);
  const agents = useAgents((s) => s.agents);
  const availability = useAgents((s) => s.availability);
  const defaultAgent = useDefaultAgentId();
  const chatThread = useApp((s) => s.layout.groveThreadId);
  const fallback = useMemo(
    () => defaultAgentModeTarget({ threads, agents, availability }, chatThread, defaultAgent),
    [threads, agents, availability, chatThread, defaultAgent],
  );
  const target = chosen ?? fallback ?? '';
  const options = [
    ...threads.filter(isListed).map((thread) => ({ value: `thread:${thread.id}`, label: thread.title })),
    ...agents.map((agent) => ({ value: `new:${agent.id}`, label: `New ${agent.name} thread` })),
  ];
  const selected = options.some((option) => option.value === target) ? target : (options[0]?.value ?? '');
  return (
    <form
      data-testid="browser-send-tab"
      data-tab-id={tabId}
      className="absolute right-1 top-full z-30 mt-1 flex w-72 flex-col gap-2 rounded border border-border bg-bg-elevated p-2 text-xs shadow-lg"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = parseSendTarget(selected);
        onClose();
        void sendActiveTab(fullPage, tabId, text, parsed ?? undefined);
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-fg-subtle">Ask</span>
        <textarea
          data-testid="browser-send-text"
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="w-full resize-none rounded border border-border bg-bg px-1.5 py-1 text-fg outline-none focus:border-accent"
        />
      </label>
      {options.length > 0 && (
        <label className="flex items-center gap-1.5 text-fg-subtle">
          Thread
          <select
            data-testid="browser-send-target"
            value={selected}
            onChange={(event) => setChosen(event.target.value)}
            className="min-w-0 flex-1 rounded border border-border bg-bg px-1 py-0.5 text-fg"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          data-testid="browser-send-full-page"
          checked={fullPage}
          onChange={(event) => onFullPage(event.target.checked)}
        />
        Include a full-page screenshot
      </label>
      <div className="flex justify-end gap-1">
        <button type="button" className="rounded px-2 py-1 hover:bg-bg-muted" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" data-testid="browser-send-confirm" className="rounded bg-accent px-2 py-1 text-accent-fg">
          Send
        </button>
      </div>
    </form>
  );
}

function TabButton({
  tab,
  index,
  dragged,
  onDragStart,
  onDrop,
}: {
  tab: BrowserTabSnapshot;
  index: number;
  dragged: boolean;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const hovering = useRef(false);
  const [stats, setStats] = useState<{ top: number; left: number; text: string } | null>(null);
  return (
    <div
      role="tab"
      aria-selected={tab.active}
      draggable={tab.role !== 'app'}
      data-testid="browser-tab"
      data-tab-id={tab.id}
      data-tab-role={tab.role}
      data-active={tab.active ? 'true' : 'false'}
      title={tab.url || tab.title}
      onClick={() => void window.arbora.invoke('browser.tabs.activate', { id: tab.id })}
      onAuxClick={(event) => {
        if (event.button === 1 && tab.role !== 'app') void window.arbora.invoke('browser.tabs.close', { id: tab.id });
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        void showTabMenu(tab);
      }}
      onMouseEnter={(event) => {
        hovering.current = true;
        const rect = event.currentTarget.getBoundingClientRect();
        void window.arbora.invoke('browser.tabs.stats', { id: tab.id }).then((result) => {
          if (!hovering.current) return;
          const memory = result.memoryKb / 1024;
          const size = memory >= 10 ? `${Math.round(memory)} MB` : `${memory.toFixed(1)} MB`;
          const cpu = `${Math.round(result.cpuPercent)}%`;
          setStats({
            top: rect.bottom + 4,
            left: rect.left,
            text: result.live ? `${size} · ${cpu} CPU` : 'Not loaded',
          });
        });
      }}
      onMouseLeave={() => {
        hovering.current = false;
        setStats(null);
      }}
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className={clsx(
        'group mb-0.5 flex h-6 max-w-44 min-w-8 shrink-0 items-center gap-1 rounded px-1.5 text-[11px]',
        '@max-[400px]:w-8 @max-[400px]:max-w-8',
        tab.active ? 'bg-bg text-fg' : 'text-fg-muted hover:bg-bg-muted',
        dragged && 'opacity-50',
      )}
    >
      {tab.favicon ? (
        <img src={tab.favicon} alt="" className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <span className="h-3.5 w-3.5 shrink-0 rounded-sm bg-bg-muted" />
      )}
      <span data-testid="browser-tab-role" data-role={tab.role} className="shrink-0 text-fg-subtle">
        <RoleIcon role={tab.role} />
      </span>
      <span className="min-w-0 flex-1 truncate @max-[400px]:hidden" data-testid="browser-tab-title">
        {tab.title || (tab.role === 'app' ? 'App' : 'New tab')}
      </span>
      {tab.loading && (
        <LoaderCircle
          size={11}
          className="shrink-0 animate-spin"
          aria-label="Loading"
          data-testid="browser-tab-loading"
        />
      )}
      {tab.role !== 'app' && (
        <button
          type="button"
          aria-label={`Close ${tab.title || 'tab'}`}
          data-testid="browser-tab-close"
          onClick={(event) => {
            event.stopPropagation();
            void window.arbora.invoke('browser.tabs.close', { id: tab.id });
          }}
          className="hidden h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-bg-muted group-hover:flex"
        >
          <X size={11} />
        </button>
      )}
      <span className="sr-only">{index}</span>
      {stats && (
        <div
          data-testid="browser-tab-stats"
          className="fixed z-50 rounded border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg shadow-lg"
          style={{ top: stats.top, left: stats.left }}
        >
          {stats.text}
        </div>
      )}
    </div>
  );
}

let openSendForTab: ((tabId: string) => void) | null = null;

/** Opens the send popover for this tab, including one that is not active. */
function openSendFor(tabId: string): void {
  openSendForTab?.(tabId);
}

function RoleIcon({ role }: { role: BrowserTabSnapshot['role'] }) {
  switch (role) {
    case 'app':
      return <AppWindow size={11} aria-label="App tab" />;
    case 'reference':
      return <Globe size={11} aria-label="Reference tab" />;
    default: {
      const unreachable: never = role;
      return unreachable;
    }
  }
}

async function showTabMenu(tab: BrowserTabSnapshot): Promise<void> {
  const items: ContextMenuItem[] = [
    { id: 'app', label: 'Make app tab', enabled: tab.role !== 'app' },
    { id: 'duplicate', label: 'Duplicate' },
    {
      id: 'session',
      label: tab.useProjectSession ? 'Use shared session' : 'Use project session',
      enabled: tab.role !== 'app',
    },
    { id: 'discard', label: 'Discard', enabled: tab.role !== 'app' && !tab.active },
    { id: 'others', label: 'Close others' },
    { type: 'separator' },
    { id: 'send', label: 'Send tab to agent' },
    { id: 'pin', label: tab.pinned ? 'Unpin' : 'Pin', enabled: tab.role !== 'app' },
  ];
  const { id } = await window.arbora.invoke('contextMenu.show', { items });
  switch (id) {
    case 'app':
      await window.arbora.invoke('browser.tabs.setRole', { id: tab.id, role: 'app' });
      return;
    case 'duplicate':
      await window.arbora.invoke('browser.tabs.duplicate', { id: tab.id });
      return;
    case 'session':
      await window.arbora.invoke('browser.tabs.setSession', { id: tab.id, project: !tab.useProjectSession });
      return;
    case 'discard':
      await window.arbora.invoke('browser.tabs.discard', { id: tab.id });
      return;
    case 'others':
      await window.arbora.invoke('browser.tabs.closeOthers', { id: tab.id });
      return;
    case 'send':
      openSendFor(tab.id);
      return;
    case 'pin':
      await window.arbora.invoke('browser.tabs.pin', { id: tab.id, pinned: !tab.pinned });
      return;
    case null:
      return;
    default:
      return;
  }
}
