import type { SidebarView } from '../components/ActivityRail';
import { PanelHeader, PanelPlaceholder } from './PanelPlaceholder';

const TITLES: Record<SidebarView, string> = {
  files: 'Explorer',
  git: 'Source Control',
  search: 'Search',
};

export default function SidebarPanel({ view }: { view: SidebarView }) {
  return (
    <section
      data-testid="panel-sidebar"
      data-view={view}
      aria-label={TITLES[view]}
      className="flex h-full flex-col"
    >
      <PanelHeader>{TITLES[view]}</PanelHeader>
      <PanelPlaceholder title={TITLES[view]}>
        <span>Nothing here yet.</span>
      </PanelPlaceholder>
    </section>
  );
}
