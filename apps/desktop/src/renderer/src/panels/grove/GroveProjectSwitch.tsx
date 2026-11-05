import { useEffect } from 'react';
import clsx from 'clsx';
import { cancelProjectSwitch, confirmProjectSwitch, useGrove } from '../../grove-store';
import { useApp } from '../../store';
import { FrameworkMark } from './FrameworkMark';

/** Ctrl+Tab / Cmd+Tab while Grove is showing. Releasing Mod, or Enter, focuses the highlighted project. */
export function GroveProjectSwitch() {
  const open = useGrove((s) => s.projectSwitch);
  const frameworks = useGrove((s) => s.frameworkByPath);
  const aliases = useApp((s) => s.settings.projects);
  const project = useApp((s) => s.project);
  useEffect(() => {
    if (!open) return;
    const down = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelProjectSwitch();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        confirmProjectSwitch();
      }
    };
    const up = (event: KeyboardEvent): void => {
      if (event.key === 'Control' || event.key === 'Meta') confirmProjectSwitch();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    document.querySelector('[data-switch-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open]);
  if (!open) return null;
  const nameOf = (path: string): string =>
    aliases[path]?.alias ?? (path === project?.path ? project.name : folderName(path));
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      data-testid="grove-project-switch"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) cancelProjectSwitch();
      }}
    >
      <div className="max-h-[min(420px,70vh)] w-[min(380px,92vw)] overflow-y-auto rounded-lg border border-border bg-bg-elevated py-1 shadow-2xl">
        <ul aria-label="Switch project">
          {open.paths.map((path, index) => {
            const active = index === open.index;
            return (
              <li key={path}>
                <button
                  type="button"
                  data-switch-active={active || undefined}
                  data-path={path}
                  onClick={() => {
                    useGrove.setState({ projectSwitch: { paths: open.paths, index } });
                    confirmProjectSwitch();
                  }}
                  className={clsx(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left',
                    active ? 'bg-accent-soft text-accent' : 'hover:bg-bg-muted',
                  )}
                >
                  <FrameworkMark framework={frameworks[path] ?? 'arbora'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{nameOf(path)}</span>
                    <span className="block truncate text-[11px] text-fg-subtle">{path}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function folderName(path: string): string {
  const parts = path.split(/[/\\]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
}
