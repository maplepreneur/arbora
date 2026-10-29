import { CommandId, type RecentProject } from '@arbora/shared';
import { useEffect, useState, type DragEvent } from 'react';
import { reportOpenResult } from '../app-commands';
import { useChordLabel } from '../chords';
import { showToast, useServices } from '../context';

export function Welcome() {
  const services = useServices();
  const { bridge, commands, store } = services;
  const [recents, setRecents] = useState<readonly RecentProject[]>([]);
  const [dragging, setDragging] = useState(false);
  const openChord = useChordLabel(CommandId.openProject);
  const paletteChord = useChordLabel(CommandId.commandPalette);
  const agentChord = useChordLabel(CommandId.agentMode);
  const designChord = useChordLabel(CommandId.designMode);

  useEffect(() => {
    let active = true;
    void bridge.invoke.listRecentProjects().then((list) => {
      if (active) setRecents(list);
    });
    return () => {
      active = false;
    };
  }, [bridge]);

  const openPath = async (path: string): Promise<void> => {
    reportOpenResult(services, await bridge.invoke.openProject({ path }));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    let path: string;
    try {
      path = bridge.getPathForFile(file);
    } catch {
      showToast(store, 'Drop a folder from your file manager.', 'error');
      return;
    }
    void openPath(path);
  };

  return (
    <div
      data-testid="welcome"
      className="flex h-full items-center justify-center overflow-auto p-8"
    >
      <div className="w-full max-w-xl space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Arbora</h1>
          <p className="text-muted">
            Build your web app by pointing at it. Open a project to start its dev server, browse it
            and talk to your agent.
          </p>
        </div>

        <div
          data-testid="drop-zone"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setDragging(true);
          }}
          onDragLeave={() => {
            setDragging(false);
          }}
          onDrop={onDrop}
          className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors ${
            dragging ? 'border-accent bg-surface-2' : 'border-border bg-surface'
          }`}
        >
          <button
            type="button"
            data-testid="open-project"
            onClick={() => void commands.run(CommandId.openProject)}
            className="rounded-md bg-accent px-4 py-2 font-medium text-accent-fg hover:opacity-90"
          >
            Open Project…
          </button>
          <span className="text-xs text-muted">
            or drop a folder here{openChord ? ` · ${openChord}` : ''}
          </span>
        </div>

        <section className="space-y-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">Recent</h2>
          {recents.length === 0 ? (
            <p className="text-muted">No recent projects.</p>
          ) : (
            <ul
              data-testid="recent-projects"
              className="divide-y divide-border rounded-md border border-border"
            >
              {recents.map((recent) => (
                <li key={recent.path} className="group flex items-center">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col items-start px-3 py-2 text-left hover:bg-surface-2"
                    onClick={() => void openPath(recent.path)}
                  >
                    <span className="font-medium">{recent.name}</span>
                    <span className="w-full truncate text-xs text-muted">{recent.path}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${recent.name} from recent projects`}
                    className="px-3 py-2 text-muted opacity-0 group-hover:opacity-100 hover:text-fg focus:opacity-100"
                    onClick={() =>
                      void bridge.invoke.removeRecentProject({ path: recent.path }).then(setRecents)
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs text-muted">
          {[
            paletteChord && `${paletteChord} commands`,
            agentChord && `${agentChord} agent mode`,
            designChord && `${designChord} design mode`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
    </div>
  );
}
