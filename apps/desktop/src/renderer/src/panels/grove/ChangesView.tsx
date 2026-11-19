import { FileText, TriangleAlert } from 'lucide-react';
import type { GroveSession } from '../../grove-model';
import { openFileAtLocation } from '../../commands';

function relativePath(path: string, projectPath: string): string {
  return path.startsWith(projectPath) ? path.slice(projectPath.length + 1) : path;
}

/** The files this session's turns changed on disk, each one opening in the editor. */
export function ChangesView({
  session,
  projectPath,
  files,
  nameOf,
}: {
  session: GroveSession;
  projectPath: string;
  /** Paths the watcher saw change while this session's turn ran. */
  files: readonly string[];
  nameOf: (threadId: string) => string;
}) {
  if (files.length === 0) {
    return (
      <div
        data-testid="grove-changes-empty"
        className="flex flex-1 items-center justify-center p-6 text-center text-xs text-fg-subtle"
      >
        No file changes from this agent yet. They show here while it works.
      </div>
    );
  }
  return (
    <div data-testid="grove-changes" className="min-h-0 flex-1 overflow-y-auto p-2">
      <ul className="flex flex-col gap-1.5">
        {files.map((path) => {
          const shown = relativePath(path, projectPath);
          const others = session.overlaps
            .filter((overlap) => overlap.path === path)
            .map((o) => nameOf(o.otherThreadId));
          return (
            <li key={path} data-testid="grove-change" data-path={shown} className="rounded border border-border bg-bg">
              <button
                type="button"
                onClick={() => openFileAtLocation({ path, line: 1 })}
                title={path}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-bg-muted"
              >
                <FileText size={13} className="shrink-0 text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{shown}</span>
                {others.length > 0 && (
                  <span
                    data-testid="grove-change-overlap"
                    title={`Also edited by ${others.join(', ')}`}
                    className="shrink-0 text-amber-500"
                  >
                    <TriangleAlert size={12} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
