import { useState } from 'react';
import { PanelPlaceholder } from './PanelPlaceholder';

type BottomTab = 'terminal' | 'git' | 'problems';

const TABS: readonly { readonly id: BottomTab; readonly label: string }[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'git', label: 'Git' },
  { id: 'problems', label: 'Problems' },
];

export default function BottomPanel() {
  const [tab, setTab] = useState<BottomTab>('terminal');
  const label = TABS.find((entry) => entry.id === tab)?.label ?? '';
  return (
    <section data-testid="panel-bottom" aria-label="Bottom panel" className="flex h-full flex-col">
      <div role="tablist" className="flex h-8 shrink-0 items-end gap-1 border-b border-border px-2">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={entry.id === tab}
            onClick={() => {
              setTab(entry.id);
            }}
            className={`border-b-2 px-2 pb-1.5 text-[11px] font-semibold tracking-wide uppercase ${
              entry.id === tab
                ? 'border-accent text-fg'
                : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1">
        <PanelPlaceholder title={label}>
          <span>Nothing here yet.</span>
        </PanelPlaceholder>
      </div>
    </section>
  );
}
