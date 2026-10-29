import { useState, type DragEvent } from 'react';
import { FolderOpen, X } from 'lucide-react';
import { CommandId, type RecentProject } from '@arbora/shared';
import { useChordLabel } from '../keybindings';
import { showToast, useApp } from '../store';

async function openProject(path?: string): Promise<void> {
  const result = await window.arbora.invoke('project.open', path === undefined ? {} : { path });
  if (result.error) showToast(result.error);
}

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer.types.includes('Files');
}

export function Welcome() {
  const recents = useApp((s) => s.settings.recentProjects);
  const openLabel = useChordLabel(CommandId.openProject);
  const paletteLabel = useChordLabel(CommandId.commandPalette);
  const agentLabel = useChordLabel(CommandId.agentMode);
  const designLabel = useChordLabel(CommandId.designMode);
  const [dragging, setDragging] = useState(false);

  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const path = window.arbora.getPathForFile(file);
    if (path) void openProject(path);
    else showToast('Drop a folder from your file manager');
  };

  const removeRecent = (recent: RecentProject): void => {
    void window.arbora.invoke('project.removeRecent', { path: recent.path });
  };

  return (
    <main
      data-testid="welcome"
      className="relative flex flex-1 items-center justify-center overflow-auto bg-bg"
      onDragEnter={(e) => {
        if (hasFiles(e)) setDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className="w-full max-w-lg px-8 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Arbora</h1>
        <p className="mt-1 text-fg-muted">Point at your running app and describe the change.</p>

        <button
          type="button"
          data-testid="open-folder"
          onClick={() => void openProject()}
          className="mt-8 flex w-full items-center gap-3 rounded-lg border border-border bg-bg-elevated px-4 py-3 text-left hover:border-accent"
        >
          <FolderOpen size={18} className="text-accent" />
          <span className="flex-1 font-medium">Open project folder…</span>
          {openLabel && <kbd className="font-mono text-[11px] text-fg-subtle">{openLabel}</kbd>}
        </button>
        <p className="mt-2 text-xs text-fg-subtle">Or drop a folder anywhere in this window, or run `arbora &lt;path&gt;`.</p>

        <section className="mt-10">
          <h2 className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">Recent</h2>
          {recents.length === 0 ? (
            <p className="mt-2 text-fg-muted">No recent projects.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border" data-testid="recent-projects">
              {recents.map((recent) => (
                <li key={recent.path} className="group flex items-center">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col px-3 py-2 text-left hover:bg-bg-subtle"
                    onClick={() => void openProject(recent.path)}
                  >
                    <span className="truncate font-medium">{recent.name}</span>
                    <span className="truncate font-mono text-[11px] text-fg-subtle">{recent.path}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${recent.name} from recent projects`}
                    className="mr-2 rounded p-1 text-fg-subtle opacity-0 group-hover:opacity-100 hover:bg-bg-muted hover:text-fg focus-visible:opacity-100"
                    onClick={() => removeRecent(recent)}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-10 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-fg-muted">
          <kbd className="font-mono text-[11px]">{agentLabel}</kbd>
          <span>Agent mode: point at a component and prompt</span>
          <kbd className="font-mono text-[11px]">{designLabel}</kbd>
          <span>Design mode: edit visually, hand the diff to the agent</span>
          <kbd className="font-mono text-[11px]">{paletteLabel}</kbd>
          <span>Command palette</span>
        </section>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent-soft/80">
          <span className="text-base font-medium text-accent">Drop a folder to open it</span>
        </div>
      )}
    </main>
  );
}
