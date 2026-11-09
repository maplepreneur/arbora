import { useRef, useState } from 'react';
import { AppWindow, Globe, Plus, X } from 'lucide-react';
import clsx from 'clsx';
import { CommandId, type BrowserTabSnapshot, type BrowserTabsSnapshot, type ContextMenuItem } from '@arbora/shared';
import { setDraft, useAgents } from '../../agent-store';
import { executeCommand } from '../../commands';
import { showToast } from '../../store';

async function grantTab(tab: BrowserTabSnapshot, tabs: readonly BrowserTabSnapshot[]): Promise<void> {
  const threadId = useAgents.getState().activeThreadId;
  if (!threadId) {
    showToast('Open an agent thread first');
    return;
  }
  await window.arbora.invoke('browser.tabs.grant', { id: tab.id, threadId });
  const app = tabs.find((item) => item.role === 'app');
  const note = [
    `Review browser tab ${tab.id} (${tab.title || tab.url || 'empty'}).`,
    app
      ? `Implement it in the app tab ${app.id}${app.url ? ` (${app.url})` : ''}.`
      : 'This project has no app tab yet.',
  ].join(' ');
  const draft = useAgents.getState().drafts[threadId] ?? '';
  setDraft(threadId, draft.trim() ? `${note}\n\n${draft}` : note);
  showToast('Tab granted to the open thread');
}

function tabLabel(tab: BrowserTabSnapshot): string {
  if (tab.title.trim()) return tab.title;
  if (tab.url) {
    try {
      return new URL(tab.url).hostname;
    } catch {
      return tab.url;
    }
  }
  return tab.role === 'app' ? 'App' : 'New tab';
}

async function tabMenu(tab: BrowserTabSnapshot, tabs: readonly BrowserTabSnapshot[]): Promise<void> {
  const items: ContextMenuItem[] = [
    { id: 'role', label: tab.role === 'app' ? 'Make reference tab' : 'Make app tab' },
    { id: 'duplicate', label: 'Duplicate' },
  ];
  if (tab.role === 'reference') {
    items.push({
      id: 'session',
      label: tab.projectSession ? 'Use shared session' : 'Use project session',
    });
  }
  items.push({ id: 'grant', label: 'Send tab to agent' }, { type: 'separator' }, { id: 'close', label: 'Close' });
  if (tabs.length > 1) items.push({ id: 'others', label: 'Close others' });
  const { id } = await window.arbora.invoke('contextMenu.show', { items });
  if (id === 'role') {
    await window.arbora.invoke('browser.tabs.setRole', { id: tab.id, role: tab.role === 'app' ? 'reference' : 'app' });
  } else if (id === 'duplicate') {
    await window.arbora.invoke('browser.tabs.duplicate', { id: tab.id });
  } else if (id === 'session') {
    await window.arbora.invoke('browser.tabs.setProjectSession', { id: tab.id, projectSession: !tab.projectSession });
  } else if (id === 'grant') {
    await grantTab(tab, tabs);
  } else if (id === 'close') {
    await window.arbora.invoke('browser.tabs.close', { id: tab.id });
  } else if (id === 'others') {
    await window.arbora.invoke('browser.tabs.closeOthers', { id: tab.id });
  }
}

function TabButton({
  tab,
  tabs,
  onDrop,
}: {
  tab: BrowserTabSnapshot;
  tabs: readonly BrowserTabSnapshot[];
  onDrop: (id: string, beforeId: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      role="tab"
      aria-selected={tab.active}
      data-testid="browser-tab"
      data-tab-id={tab.id}
      data-role={tab.role}
      data-active={tab.active ? 'true' : 'false'}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', tab.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const id = event.dataTransfer.getData('text/plain');
        if (id) onDrop(id, tab.id);
      }}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        void window.arbora.invoke('browser.tabs.close', { id: tab.id });
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        void tabMenu(tab, tabs);
      }}
      className={clsx(
        'group flex h-7 min-w-0 max-w-48 shrink-0 items-center gap-1 rounded-t border border-b-0 px-2 text-[11px]',
        tab.active ? 'border-border bg-bg text-fg' : 'border-transparent text-fg-muted hover:bg-bg-muted hover:text-fg',
        over && 'border-accent',
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1"
        onClick={() => void window.arbora.invoke('browser.tabs.activate', { id: tab.id })}
      >
        {tab.role === 'app' ? (
          <AppWindow size={12} className="shrink-0 text-accent" />
        ) : (
          <Globe size={12} className="shrink-0" />
        )}
        {tab.favicon && <img src={tab.favicon} alt="" className="h-3 w-3 shrink-0" />}
        <span className="truncate">{tabLabel(tab)}</span>
        {tab.loading && (
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" data-testid="browser-tab-loading" />
        )}
      </button>
      <button
        type="button"
        aria-label={`Close ${tabLabel(tab)}`}
        data-testid="browser-tab-close"
        className="shrink-0 rounded p-0.5 text-fg-subtle opacity-0 hover:bg-bg-muted hover:text-fg group-hover:opacity-100"
        onClick={() => void window.arbora.invoke('browser.tabs.close', { id: tab.id })}
      >
        <X size={12} />
      </button>
    </div>
  );
}

/** The browser's pages. Empty is allowed: the plus button opens a reference tab. */
export function TabStrip({ tabs }: { tabs: BrowserTabsSnapshot | null }) {
  const scroller = useRef<HTMLDivElement>(null);
  const list = tabs?.tabs ?? [];
  const drop = (id: string, beforeId: string): void => {
    if (!tabs || id === beforeId) return;
    const without = list.filter((tab) => tab.id !== id);
    const index = without.findIndex((tab) => tab.id === beforeId);
    if (index < 0) return;
    void window.arbora.invoke('browser.tabs.move', { id, toIndex: index });
  };
  return (
    <div
      data-testid="browser-tab-strip"
      className="@container flex h-8 shrink-0 items-end gap-0.5 overflow-hidden border-b border-border bg-bg-subtle px-1"
    >
      <div
        ref={scroller}
        role="tablist"
        aria-label="Browser tabs"
        className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto"
      >
        {list.map((tab) => (
          <TabButton key={tab.id} tab={tab} tabs={list} onDrop={drop} />
        ))}
      </div>
      <button
        type="button"
        data-testid="browser-new-tab"
        aria-label="New tab"
        title="New tab"
        className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg"
        onClick={() => executeCommand(CommandId.browserNewTab)}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
