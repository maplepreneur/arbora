import { Globe, X } from 'lucide-react';
import clsx from 'clsx';
import { closeTab, showBrowserTab, tabTitle, useFiles, type EditorTab } from '../files-store';
import { showToast, useApp } from '../store';

async function tabMenu(tab: EditorTab): Promise<void> {
  const { id } = await window.arbora.invoke('contextMenu.show', {
    items: [
      { id: 'close', label: 'Close' },
      { id: 'others', label: 'Close Others' },
      { id: 'all', label: 'Close All' },
      { type: 'separator' },
      { id: 'copyPath', label: 'Copy Path' },
      { id: 'copyRelative', label: 'Copy Relative Path' },
      { id: 'reveal', label: 'Reveal in File Manager' },
    ],
  });
  const project = useApp.getState().project;
  switch (id) {
    case 'close':
      closeTab(tab.id);
      return;
    case 'others':
    case 'all':
      for (const other of useFiles.getState().tabs) {
        if (id === 'all' || other.id !== tab.id) closeTab(other.id);
      }
      return;
    case 'copyPath':
      if (project) await window.arbora.invoke('clipboard.writeText', { text: `${project.path}/${tab.path}` });
      return;
    case 'copyRelative':
      await window.arbora.invoke('clipboard.writeText', { text: tab.path });
      return;
    case 'reveal':
      await window.arbora
        .invoke('files.reveal', { path: tab.path })
        .catch(() => showToast(`Could not reveal ${tab.path}`));
      return;
    default:
      return;
  }
}

function Tab({ tab, active }: { tab: EditorTab; active: boolean }) {
  const status = useFiles((s) => (tab.kind === 'file' ? s.status[tab.path] : undefined));
  const dirty = status?.dirty ?? false;
  const preview = tab.kind === 'file' && tab.preview;
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      data-testid="editor-tab"
      data-path={tab.path}
      data-kind={tab.kind}
      data-dirty={dirty}
      data-preview={preview}
      title={tab.path}
      onClick={() => useFiles.setState({ active: tab.id })}
      onDoubleClick={() => {
        if (tab.kind === 'file' && tab.preview) {
          useFiles.setState((s) => ({ tabs: s.tabs.map((t) => (t.id === tab.id ? { ...tab, preview: false } : t)) }));
        }
      }}
      onAuxClick={(event) => {
        if (event.button === 1) closeTab(tab.id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        void tabMenu(tab);
      }}
      className={clsx(
        'group flex h-full max-w-[200px] shrink-0 cursor-default items-center gap-1.5 border-r border-border pr-1 pl-3 text-xs',
        active ? 'bg-bg text-fg' : 'bg-bg-subtle text-fg-muted hover:text-fg',
      )}
    >
      <span className={clsx('truncate', preview && 'italic')}>{tabTitle(tab)}</span>
      {tab.kind === 'diff' && <span className="shrink-0 text-[10px] text-fg-subtle">diff</span>}
      <button
        type="button"
        aria-label={`Close ${tabTitle(tab)}`}
        data-testid="editor-tab-close"
        onClick={(event) => {
          event.stopPropagation();
          closeTab(tab.id);
        }}
        className={clsx(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-bg-muted',
          dirty ? 'text-fg' : 'text-fg-subtle opacity-0 group-hover:opacity-100',
          active && 'opacity-100',
        )}
      >
        {dirty ? (
          <span className="h-2 w-2 rounded-full bg-fg group-hover:hidden" data-testid="editor-tab-dirty" />
        ) : null}
        <X size={12} className={clsx(dirty && 'hidden group-hover:block')} />
      </button>
    </div>
  );
}

/** Browser plus open files and diffs, above the centre pane. Hidden while nothing is open. */
export function EditorTabs() {
  const tabs = useFiles((s) => s.tabs);
  const active = useFiles((s) => s.active);
  if (tabs.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label="Editor tabs"
      data-testid="editor-tabs"
      className="flex h-8 shrink-0 overflow-x-auto overflow-y-hidden border-b border-border bg-bg-subtle [scrollbar-width:none]"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === null}
        data-testid="editor-tab-browser"
        onClick={showBrowserTab}
        className={clsx(
          'flex h-full shrink-0 items-center gap-1.5 border-r border-border px-3 text-xs',
          active === null ? 'bg-bg text-fg' : 'text-fg-muted hover:text-fg',
        )}
      >
        <Globe size={13} /> Browser
      </button>
      {tabs.map((tab) => (
        <Tab key={tab.id} tab={tab} active={tab.id === active} />
      ))}
    </div>
  );
}
