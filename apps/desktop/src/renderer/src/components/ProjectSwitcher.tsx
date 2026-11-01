import { useEffect } from 'react';
import { Command } from 'cmdk';
import { FolderOpen, Pin } from 'lucide-react';
import clsx from 'clsx';
import { projectSections } from '@arbora/shared';
import { loadLibrary, openProjectPath, useProjects } from '../projects-store';
import { closeOverlay, useApp } from '../store';

const GROUP_HEADING =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-subtle [&_[cmdk-group-heading]]:uppercase';

/**
 * `Mod+Alt+O`: jump to any project (Cursor's and VS Code's "Open Recent"). Projects that are open
 * in another window come forward instead of opening twice.
 */
export function ProjectSwitcher() {
  const open = useApp((s) => s.overlay === 'switcher');
  const current = useApp((s) => s.project?.path);
  const library = useProjects((s) => s.library);
  useEffect(() => {
    if (open) void loadLibrary();
  }, [open]);
  if (!open) return null;
  const close = (): void => closeOverlay('switcher');
  const sections = projectSections(library);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <Command
        label="Switch project"
        data-testid="project-switcher"
        className="w-[min(560px,90vw)] overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
        }}
      >
        <Command.Input
          autoFocus
          placeholder="Switch to project…"
          className="h-11 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-fg-subtle"
        />
        <Command.List className="max-h-[55vh] overflow-y-auto p-1">
          <Command.Empty className="px-3 py-6 text-center text-fg-subtle">No matching project</Command.Empty>
          {sections.map((section) =>
            section.entries.length === 0 ? null : (
              <Command.Group key={section.id} heading={section.title} className={GROUP_HEADING}>
                {section.entries.map((entry) => (
                  <Command.Item
                    key={entry.path}
                    value={`${entry.name} ${entry.folder} ${entry.path} ${section.title}`}
                    data-testid="switcher-project"
                    data-path={entry.path}
                    onSelect={() => {
                      close();
                      if (entry.path !== current) void openProjectPath(entry.path);
                    }}
                    className="flex cursor-default items-center gap-2.5 rounded px-3 py-1.5 data-[selected=true]:bg-accent-soft"
                  >
                    <span
                      className={clsx('h-2 w-2 shrink-0 rounded-full', entry.open ? 'bg-accent' : 'bg-border')}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate">{entry.name}</span>
                        {entry.pinned && <Pin size={10} className="text-fg-subtle" aria-label="Pinned" />}
                        {entry.path === current && <span className="text-[10px] text-fg-subtle">this window</span>}
                      </span>
                      <span className="block truncate font-mono text-[10.5px] text-fg-subtle">{entry.path}</span>
                    </span>
                    {entry.attention > 0 && (
                      <span className="rounded-full bg-attention-soft px-1.5 text-[10px] font-semibold text-attention">
                        {entry.attention}
                      </span>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            ),
          )}
          <Command.Group heading="Actions" className={GROUP_HEADING}>
            <Command.Item
              value="open folder browse"
              onSelect={() => {
                close();
                void openProjectPath();
              }}
              className="flex cursor-default items-center gap-2.5 rounded px-3 py-1.5 data-[selected=true]:bg-accent-soft"
            >
              <FolderOpen size={13} className="text-accent" /> Open folder…
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
