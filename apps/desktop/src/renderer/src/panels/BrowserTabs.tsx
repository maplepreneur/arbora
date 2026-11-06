import { useEffect, useRef, useState } from 'react';
import { Plus, Send, X } from 'lucide-react';
import clsx from 'clsx';
import { CommandId, type BrowserTabSnapshot, type ContextMenuItem } from '@arbora/shared';
import { executeCommand, registerSendTabOpener, sendActiveTab } from '../commands';
import { useApp } from '../store';

/**
 * The tab strip above the URL bar. Below 400px the titles collapse to icons. The app tab has no
 * close button.
 */
export function BrowserTabStrip() {
  const tabs = useApp((s) => s.browserTabs);
  const [dragged, setDragged] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [fullPage, setFullPage] = useState(false);
  useEffect(() => registerSendTabOpener(() => setSending(true)), []);
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
          onClick={() => setSending(true)}
          className="mb-0.5 flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] text-fg-subtle hover:bg-bg-muted hover:text-fg"
        >
          <Send size={12} />
          Send
        </button>
      </div>
      {sending && (
        <form
          data-testid="browser-send-tab"
          className="absolute right-1 top-full z-30 mt-1 w-64 rounded border border-border bg-bg-elevated p-2 text-xs shadow-lg"
          onSubmit={(event) => {
            event.preventDefault();
            setSending(false);
            void sendActiveTab(fullPage);
          }}
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              data-testid="browser-send-full-page"
              checked={fullPage}
              onChange={(event) => setFullPage(event.target.checked)}
            />
            Include a full-page screenshot
          </label>
          <div className="mt-2 flex justify-end gap-1">
            <button type="button" className="rounded px-2 py-1 hover:bg-bg-muted" onClick={() => setSending(false)}>
              Cancel
            </button>
            <button
              type="submit"
              data-testid="browser-send-confirm"
              className="rounded bg-accent px-2 py-1 text-accent-fg"
            >
              Send
            </button>
          </div>
        </form>
      )}
    </div>
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
      <span className="min-w-0 flex-1 truncate @max-[400px]:hidden">
        {tab.role === 'app' ? 'App' : tab.title || 'New tab'}
        {tab.loading ? '…' : ''}
      </span>
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
      executeCommand(CommandId.browserSendTab);
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
