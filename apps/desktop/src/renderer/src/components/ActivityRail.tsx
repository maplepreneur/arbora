import type { ReactNode } from 'react';

export type SidebarView = 'files' | 'git' | 'search';

const ICONS: Record<SidebarView, ReactNode> = {
  files: <path d="M4 3h7l5 5v13H4zM11 3v5h5" />,
  git: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="9" r="2" />
      <path d="M6 7v10M18 11c0 4-6 3-12 6" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
};

const LABELS: Record<SidebarView, string> = {
  files: 'Files',
  git: 'Source Control',
  search: 'Search',
};

const VIEWS: readonly SidebarView[] = ['files', 'git', 'search'];

export function ActivityRail({
  active,
  onSelect,
}: {
  active: SidebarView;
  onSelect: (view: SidebarView) => void;
}) {
  return (
    <nav
      data-testid="activity-rail"
      aria-label="Activity rail"
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface py-2"
    >
      {VIEWS.map((view) => (
        <button
          key={view}
          type="button"
          title={LABELS[view]}
          aria-label={LABELS[view]}
          aria-pressed={view === active}
          onClick={() => {
            onSelect(view);
          }}
          className={`flex h-9 w-9 items-center justify-center rounded-md ${
            view === active ? 'text-fg' : 'text-muted hover:text-fg'
          }`}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            {ICONS[view]}
          </svg>
        </button>
      ))}
    </nav>
  );
}
