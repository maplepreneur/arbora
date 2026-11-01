import { useEffect, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, FolderOpen, FolderPlus, MoreHorizontal, Pin, Search, Sparkles } from 'lucide-react';
import {
  CommandId,
  PROJECT_GROUP_COLORS,
  projectSections,
  type ContextMenuItem,
  type ProjectEntry,
  type ProjectSection,
} from '@arbora/shared';
import { executeCommand } from '../commands';
import { useChordLabel } from '../keybindings';
import {
  createProjectGroup,
  deleteProjectGroup,
  forgetProject,
  loadLibrary,
  moveProjectGroup,
  openProjectPath,
  updateProjectGroup,
  updateProjectMeta,
  useProjects,
} from '../projects-store';
import { openOverlay, showToast } from '../store';

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer.types.includes('Files');
}

async function menu(items: ContextMenuItem[]): Promise<string | null> {
  return (await window.arbora.invoke('contextMenu.show', { items })).id;
}

export function NameInput({
  initial,
  label,
  testId,
  onDone,
}: {
  initial: string;
  label: string;
  testId: string;
  onDone: (value: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const finish = (commit: boolean): void => onDone(commit && value.trim() ? value.trim() : null);
  return (
    <input
      autoFocus
      aria-label={label}
      data-testid={testId}
      value={value}
      maxLength={100}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(true);
        if (event.key === 'Escape') finish(false);
      }}
      className="h-7 min-w-0 flex-1 rounded border border-accent bg-bg px-2 text-sm outline-none"
    />
  );
}

function ProjectRow({ entry, onNewGroup }: { entry: ProjectEntry; onNewGroup: (path: string) => void }) {
  const groups = useProjects((s) => s.library.groups);
  const [renaming, setRenaming] = useState(false);

  const onMenu = async (event: MouseEvent): Promise<void> => {
    event.preventDefault();
    event.stopPropagation();
    const choice = await menu([
      { id: 'open', label: 'Open' },
      { id: 'pin', label: entry.pinned ? 'Unpin' : 'Pin to top' },
      { id: 'rename', label: 'Rename…' },
      ...(entry.alias ? [{ id: 'unalias', label: `Use folder name (${entry.folder})` }] : []),
      { type: 'separator' },
      ...groups.map((g) => ({ id: `group:${g.id}`, label: `Move to ${g.name}`, enabled: entry.groupId !== g.id })),
      ...(entry.groupId ? [{ id: 'ungroup', label: 'Remove from group' }] : []),
      { id: 'new-group', label: 'Move to a new group…' },
      { type: 'separator' },
      { id: 'reveal', label: 'Reveal in file manager' },
      { id: 'forget', label: 'Remove from list' },
    ]);
    if (!choice) return;
    if (choice === 'open') await openProjectPath(entry.path);
    else if (choice === 'pin') await updateProjectMeta(entry.path, { pinned: !entry.pinned });
    else if (choice === 'rename') setRenaming(true);
    else if (choice === 'unalias') await updateProjectMeta(entry.path, { alias: null });
    else if (choice === 'ungroup') await updateProjectMeta(entry.path, { groupId: null });
    else if (choice === 'new-group') onNewGroup(entry.path);
    else if (choice === 'reveal') await window.arbora.invoke('projects.reveal', { path: entry.path });
    else if (choice === 'forget') await forgetProject(entry.path);
    else if (choice.startsWith('group:')) await updateProjectMeta(entry.path, { groupId: choice.slice(6) });
  };

  if (renaming) {
    return (
      <li className="flex items-center px-3 py-2">
        <NameInput
          initial={entry.name}
          label="Project name"
          testId="project-rename-input"
          onDone={(alias) => {
            setRenaming(false);
            if (alias && alias !== entry.name) void updateProjectMeta(entry.path, { alias });
          }}
        />
      </li>
    );
  }

  return (
    <li className="group flex items-center" data-testid="project-row" data-path={entry.path}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left hover:bg-bg-subtle"
        onClick={() => void openProjectPath(entry.path)}
        onContextMenu={(event) => void onMenu(event)}
      >
        <span
          aria-label={entry.open ? 'Open in a window' : undefined}
          className={clsx('h-2 w-2 shrink-0 rounded-full', entry.open ? 'bg-accent' : 'bg-transparent')}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium">{entry.name}</span>
            {entry.pinned && <Pin size={11} aria-label="Pinned" className="shrink-0 text-fg-subtle" />}
          </span>
          <span className="truncate font-mono text-[11px] text-fg-subtle">{entry.path}</span>
        </span>
        {entry.attention > 0 && (
          <span
            data-testid="project-attention"
            title={`${entry.attention} agent thread${entry.attention === 1 ? '' : 's'} need you`}
            className="rounded-full bg-attention-soft px-1.5 text-[10px] leading-4 font-semibold text-attention tabular-nums"
          >
            {entry.attention}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={`${entry.name} actions`}
        data-testid="project-row-menu"
        className="mr-2 rounded p-1 text-fg-subtle opacity-0 group-hover:opacity-100 hover:bg-bg-muted hover:text-fg focus-visible:opacity-100"
        onClick={(event) => void onMenu(event)}
      >
        <MoreHorizontal size={14} />
      </button>
    </li>
  );
}

function SectionHeader({ section }: { section: ProjectSection }) {
  const [renaming, setRenaming] = useState(false);
  const groups = useProjects((s) => s.library.groups);
  const group = section.group;
  if (!group) {
    return (
      <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
        {section.id === 'pinned' && <Pin size={11} />}
        {section.title}
      </h2>
    );
  }
  const index = groups.findIndex((g) => g.id === group.id);
  const openMenu = async (): Promise<void> => {
    const choice = await menu([
      { id: 'rename', label: 'Rename…' },
      { id: 'up', label: 'Move up', enabled: index > 0 },
      { id: 'down', label: 'Move down', enabled: index < groups.length - 1 },
      { type: 'separator' },
      ...PROJECT_GROUP_COLORS.map((color) => ({
        id: `color:${color}`,
        label: `Colour: ${color[0]?.toUpperCase()}${color.slice(1)}`,
        enabled: group.color !== color,
      })),
      { type: 'separator' },
      { id: 'delete', label: 'Delete group (keeps projects)' },
    ]);
    if (choice === 'rename') setRenaming(true);
    else if (choice === 'up') await moveProjectGroup(group.id, -1);
    else if (choice === 'down') await moveProjectGroup(group.id, 1);
    else if (choice === 'delete') await deleteProjectGroup(group.id);
    else if (choice?.startsWith('color:')) {
      const color = PROJECT_GROUP_COLORS.find((c) => `color:${c}` === choice);
      if (color) await updateProjectGroup(group.id, { color });
    }
  };
  return (
    <div
      className="group/section flex items-center gap-1.5"
      onContextMenu={(event) => {
        event.preventDefault();
        void openMenu();
      }}
    >
      <button
        type="button"
        aria-expanded={!group.collapsed}
        aria-label={group.collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
        data-testid="project-group-toggle"
        onClick={() => void updateProjectGroup(group.id, { collapsed: !group.collapsed })}
        className="rounded text-fg-subtle hover:text-fg"
      >
        {group.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
      </button>
      <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: `var(--group-${group.color})` }} />
      {renaming ? (
        <NameInput
          initial={group.name}
          label="Group name"
          testId="project-group-rename-input"
          onDone={(name) => {
            setRenaming(false);
            if (name && name !== group.name) void updateProjectGroup(group.id, { name });
          }}
        />
      ) : (
        <h2
          className="flex-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase"
          onDoubleClick={() => setRenaming(true)}
        >
          {group.name}
          <span className="ml-2 font-normal tabular-nums normal-case">{section.entries.length}</span>
        </h2>
      )}
      <button
        type="button"
        aria-label={`${group.name} group actions`}
        data-testid="project-group-menu"
        className="rounded p-0.5 text-fg-subtle opacity-0 group-hover/section:opacity-100 hover:text-fg focus-visible:opacity-100"
        onClick={() => void openMenu()}
      >
        <MoreHorizontal size={13} />
      </button>
    </div>
  );
}

const SECTION_TEST_IDS: Readonly<Record<string, string>> = { pinned: 'pinned-projects', recent: 'recent-projects' };

/**
 * The window without a project: open a folder, or pick one from Pinned, your groups and Recent.
 * Open projects show a dot, and a count when their agents need you (Solo's and Herdr's overview of
 * every project at once).
 */
export function ProjectsHome() {
  const library = useProjects((s) => s.library);
  const openLabel = useChordLabel(CommandId.openProject);
  const switchLabel = useChordLabel(CommandId.switchProject);
  const paletteLabel = useChordLabel(CommandId.commandPalette);
  const agentLabel = useChordLabel(CommandId.agentMode);
  const designLabel = useChordLabel(CommandId.designMode);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState('');
  /** `''` while naming an empty group, or the project to move into it. */
  const [newGroupFor, setNewGroupFor] = useState<string | null>(null);

  useEffect(() => {
    void loadLibrary();
  }, []);

  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const path = window.arbora.getPathForFile(file);
    if (path) void openProjectPath(path);
    else showToast('Drop a folder from your file manager');
  };

  const sections = projectSections(library, query);
  const empty = library.entries.length === 0 && library.groups.length === 0;

  return (
    <main
      data-testid="welcome"
      className="relative flex flex-1 justify-center overflow-auto bg-bg"
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
      <div className="w-full max-w-2xl px-8 py-12">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Arbora</h1>
            <p className="mt-1 text-fg-muted">Point at your running app and describe the change.</p>
          </div>
          <button
            type="button"
            data-testid="welcome-onboarding"
            onClick={() => openOverlay('onboarding')}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg"
          >
            <Sparkles size={12} className="text-accent" /> Getting started
          </button>
        </div>

        <button
          type="button"
          data-testid="open-folder"
          onClick={() => void openProjectPath()}
          className="mt-8 flex w-full items-center gap-3 rounded-lg border border-border bg-bg-elevated px-4 py-3 text-left hover:border-accent"
        >
          <FolderOpen size={18} className="text-accent" />
          <span className="flex-1 font-medium">Open project folder…</span>
          {openLabel && <kbd className="font-mono text-[11px] text-fg-subtle">{openLabel}</kbd>}
        </button>
        <p className="mt-2 text-xs text-fg-subtle">
          Or drop a folder anywhere in this window, or run <code className="font-mono">arbora &lt;path&gt;</code>.
          {switchLabel && (
            <>
              {' '}
              <kbd className="font-mono">{switchLabel}</kbd> switches projects from anywhere.
            </>
          )}
        </p>

        <div className="mt-10 flex items-center gap-2">
          <h2 className="flex-1 text-sm font-semibold">Projects</h2>
          {!empty && (
            <label className="flex h-7 w-56 items-center gap-1.5 rounded border border-border bg-bg px-2 focus-within:border-accent">
              <Search size={12} className="text-fg-subtle" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter projects"
                aria-label="Filter projects"
                data-testid="projects-filter"
                className="min-w-0 flex-1 bg-transparent text-xs outline-none"
              />
            </label>
          )}
          <button
            type="button"
            data-testid="new-project-group"
            onClick={() => setNewGroupFor('')}
            className="flex h-7 items-center gap-1.5 rounded border border-border px-2 text-xs text-fg-muted hover:bg-bg-muted hover:text-fg"
          >
            <FolderPlus size={12} /> New group
          </button>
        </div>
        {newGroupFor !== null && (
          <div className="mt-3 flex">
            <NameInput
              initial=""
              label="New group name"
              testId="new-project-group-input"
              onDone={(name) => {
                const path = newGroupFor;
                setNewGroupFor(null);
                if (name) void createProjectGroup(name, path || undefined);
              }}
            />
          </div>
        )}

        {empty ? (
          <p className="mt-3 text-fg-muted">No recent projects.</p>
        ) : sections.length === 0 ? (
          <p className="mt-3 text-fg-muted">No project matches “{query}”.</p>
        ) : (
          sections.map((section) => (
            <section
              key={section.id}
              className="mt-5"
              aria-label={section.title}
              data-testid={section.group ? `project-group-${section.group.id}` : `${section.id}-section`}
            >
              <SectionHeader section={section} />
              {!section.group?.collapsed &&
                (section.entries.length === 0 ? (
                  <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-fg-subtle">
                    Empty. Use a project’s ⋯ menu to move it here.
                  </p>
                ) : (
                  <ul
                    className="mt-2 divide-y divide-border rounded-lg border border-border"
                    data-testid={
                      SECTION_TEST_IDS[section.id] ?? `project-group-list-${section.group?.id ?? section.id}`
                    }
                  >
                    {section.entries.map((entry) => (
                      <ProjectRow key={entry.path} entry={entry} onNewGroup={(path) => setNewGroupFor(path)} />
                    ))}
                  </ul>
                ))}
            </section>
          ))
        )}

        <section className="mt-10 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-fg-muted">
          <kbd className="font-mono text-[11px]">{agentLabel}</kbd>
          <span>Agent mode: point at a component and prompt</span>
          <kbd className="font-mono text-[11px]">{designLabel}</kbd>
          <span>Design mode: edit visually, hand the diff to the agent</span>
          <kbd className="font-mono text-[11px]">{paletteLabel}</kbd>
          <span>
            Command palette{' '}
            <button
              type="button"
              className="ml-1 text-accent hover:underline"
              onClick={() => executeCommand(CommandId.commandPalette)}
            >
              Open
            </button>
          </span>
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
