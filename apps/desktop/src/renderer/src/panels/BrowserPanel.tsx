import { useAppState } from '../context';
import { PanelPlaceholder } from './PanelPlaceholder';

export default function BrowserPanel() {
  const devUrl = useAppState((state) => state.project?.settings.devUrl);
  return (
    <section
      data-testid="panel-browser"
      aria-label="Browser"
      className="flex h-full flex-col bg-bg"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex-1 truncate rounded bg-surface-2 px-2 py-1 font-mono text-[11px] text-muted">
          {devUrl ?? 'No dev server yet'}
        </div>
      </div>
      <PanelPlaceholder title="Browser">
        <span>Your running app will appear here.</span>
      </PanelPlaceholder>
    </section>
  );
}
