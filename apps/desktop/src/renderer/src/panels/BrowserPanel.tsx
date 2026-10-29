import { Globe } from 'lucide-react';
import { CommandId } from '@arbora/shared';
import { useChordLabel } from '../keybindings';
import { useApp } from '../store';

export default function BrowserPanel() {
  const mode = useApp((s) => s.mode);
  const project = useApp((s) => s.project);
  const agentLabel = useChordLabel(CommandId.agentMode);
  const designLabel = useChordLabel(CommandId.designMode);
  const exitLabel = useChordLabel(CommandId.exitMode);

  return (
    <div className="relative flex h-full flex-col bg-bg">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex h-6 flex-1 items-center rounded border border-border bg-bg-subtle px-2 font-mono text-[11px] text-fg-subtle">
          {project?.settings.devUrl ?? 'http://localhost:5173'}
        </div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-fg-subtle">
        <Globe size={28} strokeWidth={1.25} />
        <div className="font-medium text-fg-muted">Browser</div>
        <div className="text-xs">Arrives in Stage 1</div>
        <div className="mt-3 text-xs">
          <kbd className="font-mono">{agentLabel}</kbd> agent mode · <kbd className="font-mono">{designLabel}</kbd> design mode
        </div>
      </div>
      {mode !== 'idle' && (
        <div
          data-testid="mode-banner"
          data-mode={mode}
          className="pointer-events-none absolute inset-x-0 top-9 flex justify-center p-2"
        >
          <div className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg shadow">
            {mode === 'agent' ? 'Agent mode: point at a component (Stage 4)' : 'Design mode: edit visually (Stage 6)'} ·{' '}
            {exitLabel} to exit
          </div>
        </div>
      )}
    </div>
  );
}
