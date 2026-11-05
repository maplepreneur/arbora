import { lazy, Suspense } from 'react';
import { Files, GitBranch, PanelRightClose, Search, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { CommandId, type SidebarView } from '@arbora/shared';
import { useChordLabel } from '../../keybindings';
import { updateLayout, useApp } from '../../store';

const FilesPanel = lazy(() => import('../FilesPanel'));
const GitPanel = lazy(() => import('../GitPanel'));
const SearchPanel = lazy(() => import('../SearchPanel'));

const VIEWS: readonly { id: SidebarView; label: string; icon: LucideIcon; command: string }[] = [
  { id: 'files', label: 'Files', icon: Files, command: CommandId.showFiles },
  { id: 'git', label: 'Source Control', icon: GitBranch, command: CommandId.showGitSidebar },
  { id: 'search', label: 'Search', icon: Search, command: CommandId.showSearch },
];

function ViewButton({ view, selected }: { view: (typeof VIEWS)[number]; selected: boolean }) {
  const chord = useChordLabel(view.command);
  const Icon = view.icon;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-label={view.label}
      title={chord ? `${view.label} (${chord})` : view.label}
      data-testid={`side-view-${view.id}`}
      onClick={() => updateLayout({ sidebarView: view.id })}
      className={clsx(
        'flex h-7 w-7 items-center justify-center rounded',
        selected ? 'bg-bg-muted text-fg' : 'text-fg-subtle hover:bg-bg-muted hover:text-fg',
      )}
    >
      <Icon size={15} />
    </button>
  );
}

function SideContent({ view }: { view: SidebarView }) {
  switch (view) {
    case 'files':
      return <FilesPanel />;
    case 'git':
      return <GitPanel variant="sidebar" />;
    case 'search':
      return <SearchPanel />;
    default: {
      const unreachable: never = view;
      return unreachable;
    }
  }
}

/** Files, Source Control and Search for the selected project, on the window's right edge. */
export function SideColumn({ onCollapse }: { onCollapse: () => void }) {
  const view = useApp((s) => s.layout.sidebarView);
  const hasProject = useApp((s) => s.project !== null);
  return (
    <aside
      data-testid="panel-side"
      data-landmark="sidebar"
      aria-label="Files, source control and search"
      className="flex h-full min-w-0 flex-col overflow-hidden bg-bg-subtle"
    >
      <div
        role="tablist"
        aria-label="Side view"
        className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-1.5"
      >
        {VIEWS.map((entry) => (
          <ViewButton key={entry.id} view={entry} selected={view === entry.id} />
        ))}
        <button
          type="button"
          aria-label="Hide files, source control and search"
          title="Hide files, source control and search"
          data-testid="side-hide"
          onClick={onCollapse}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
        >
          <PanelRightClose size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {hasProject && (
          <Suspense fallback={<div className="h-full bg-bg-subtle" />}>
            <SideContent view={view} />
          </Suspense>
        )}
      </div>
    </aside>
  );
}
