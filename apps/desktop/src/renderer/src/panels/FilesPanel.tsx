import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  ListCollapse,
  RefreshCw,
} from 'lucide-react';
import clsx from 'clsx';
import { baseName, joinPath, parentPath, type FileEntry, type FileKind } from '@arbora/shared';
import {
  applyRename,
  closeTab,
  editorController,
  loadDir,
  omitKey,
  openFile,
  refreshTree,
  revealInTree,
  toggleDir,
  useFiles,
} from '../files-store';
import { showToast, useApp } from '../store';
import { dropFolder, validateName, visibleRows, type TreeRow } from './files/tree';

const ROW = 22;
const OVERSCAN = 12;
const DRAG_TYPE = 'application/x-arbora-path';

function ipcError(error: unknown): string {
  return (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

async function moveEntry(from: string, to: string): Promise<boolean> {
  if (from === to) return false;
  try {
    await window.arbora.invoke('files.rename', { from, to });
  } catch (error) {
    showToast(ipcError(error));
    return false;
  }
  applyRename(from, to);
  editorController()?.rename(from, to);
  void loadDir(parentPath(from));
  void loadDir(parentPath(to));
  useFiles.setState({ selected: to });
  return true;
}

async function deleteEntry(entry: FileEntry): Promise<void> {
  try {
    await window.arbora.invoke('files.delete', { path: entry.path });
  } catch (error) {
    showToast(`Could not delete ${entry.name}: ${ipcError(error)}`);
    return;
  }
  // Close tabs of the file, or of everything inside the folder, without asking about edits.
  for (const tab of useFiles.getState().tabs) {
    if (tab.path === entry.path || tab.path.startsWith(`${entry.path}/`)) {
      useFiles.setState((s) => ({ status: omitKey(s.status, tab.path) }));
      closeTab(tab.id);
    }
  }
  void loadDir(parentPath(entry.path));
  showToast(`Moved ${entry.name} to the trash`);
}

async function createEntry(dir: string, name: string, kind: FileKind): Promise<void> {
  const path = joinPath(dir, name.trim().replace(/\/+$/, ''));
  try {
    await window.arbora.invoke('files.create', { path, kind });
  } catch (error) {
    showToast(ipcError(error));
    return;
  }
  // Shows the new entry, expanding folders the name created (`notes/todo.md`).
  await revealInTree(path, { refresh: true, focus: kind === 'directory' });
  if (kind === 'file') openFile(path, { pinned: true });
}

function startCreate(entry: FileEntry | null, kind: FileKind): void {
  const dir = dropFolder(entry);
  if (dir !== '') toggleDir(dir, true);
  useFiles.setState({ creating: { dir, kind } });
}

async function showEntryMenu(entry: FileEntry | null): Promise<void> {
  const project = useApp.getState().project;
  const items = [
    { id: 'newFile', label: 'New File…' },
    { id: 'newFolder', label: 'New Folder…' },
    ...(entry
      ? [
          { type: 'separator' as const },
          { id: 'rename', label: 'Rename…', accelerator: 'F2' },
          { id: 'delete', label: 'Delete', accelerator: 'Delete' },
          { type: 'separator' as const },
          { id: 'reveal', label: 'Reveal in File Manager' },
          { id: 'copyPath', label: 'Copy Path' },
          { id: 'copyRelative', label: 'Copy Relative Path' },
        ]
      : []),
  ];
  const { id } = await window.arbora.invoke('contextMenu.show', { items });
  switch (id) {
    case 'newFile':
      startCreate(entry, 'file');
      return;
    case 'newFolder':
      startCreate(entry, 'directory');
      return;
    case 'rename':
      if (entry) useFiles.setState({ renaming: entry.path });
      return;
    case 'delete':
      if (entry) await deleteEntry(entry);
      return;
    case 'reveal':
      if (entry) await window.arbora.invoke('files.reveal', { path: entry.path });
      return;
    case 'copyPath':
      if (entry && project)
        await window.arbora.invoke('clipboard.writeText', { text: `${project.path}/${entry.path}` });
      return;
    case 'copyRelative':
      if (entry) await window.arbora.invoke('clipboard.writeText', { text: entry.path });
      return;
    default:
      return;
  }
}

function NameInput({
  initial,
  depth,
  kind,
  onCommit,
  onCancel,
}: {
  initial: string;
  depth: number;
  kind: FileKind;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.focus();
    // Select the name without its extension, as file managers do.
    const dot = kind === 'file' ? initial.lastIndexOf('.') : -1;
    element.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial, kind]);
  const commit = (): void => {
    if (done.current) return;
    const value = input.current?.value ?? '';
    if (value.trim() === '' || value === initial) {
      done.current = true;
      onCancel();
      return;
    }
    const problem = validateName(value);
    if (problem) {
      setError(problem);
      return;
    }
    done.current = true;
    onCommit(value.trim());
  };
  return (
    <div className="relative flex h-[22px] items-center pr-2" style={{ paddingLeft: 8 + depth * 12 + 16 }}>
      {kind === 'directory' ? (
        <Folder size={14} className="mr-1.5 shrink-0 text-fg-subtle" />
      ) : (
        <File size={14} className="mr-1.5 shrink-0 text-fg-subtle" />
      )}
      <input
        ref={input}
        defaultValue={initial}
        data-testid="explorer-name-input"
        spellCheck={false}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            done.current = true;
            onCancel();
          }
        }}
        onChange={() => setError(null)}
        onBlur={commit}
        className={clsx(
          'h-5 min-w-0 flex-1 rounded border bg-bg px-1 text-xs outline-none',
          error ? 'border-danger' : 'border-accent',
        )}
      />
      {error && (
        <div className="absolute top-full right-2 left-6 z-10 rounded bg-danger px-2 py-1 text-[11px] text-white">
          {error}
        </div>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  depth,
  selected,
  expanded,
  renaming,
  dropTarget,
  decoration,
  onDragTarget,
}: {
  entry: FileEntry;
  depth: number;
  selected: boolean;
  expanded: boolean;
  renaming: boolean;
  dropTarget: boolean;
  decoration: { letter: string; tone: string } | undefined;
  onDragTarget: (dir: string | null) => void;
}) {
  if (renaming) {
    return (
      <NameInput
        initial={entry.name}
        depth={depth}
        kind={entry.kind}
        onCancel={() => useFiles.setState({ renaming: null })}
        onCommit={(name) => {
          useFiles.setState({ renaming: null });
          void moveEntry(entry.path, joinPath(parentPath(entry.path), name));
        }}
      />
    );
  }
  const isDir = entry.kind === 'directory';
  const Icon = isDir ? (expanded ? FolderOpen : Folder) : File;
  const onDrop = (event: DragEvent): void => {
    const from = event.dataTransfer.getData(DRAG_TYPE);
    onDragTarget(null);
    if (!from) return;
    event.preventDefault();
    event.stopPropagation();
    const dir = dropFolder(entry);
    if (dir === parentPath(from) || dir === from || dir.startsWith(`${from}/`)) return;
    void moveEntry(from, joinPath(dir, baseName(from)));
  };
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={isDir ? expanded : undefined}
      data-testid="explorer-row"
      data-path={entry.path}
      data-kind={entry.kind}
      data-git-status={decoration?.letter}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, entry.path);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        onDragTarget(dropFolder(entry));
      }}
      onDrop={onDrop}
      onClick={() => {
        useFiles.setState({ selected: entry.path });
        if (isDir) toggleDir(entry.path);
        else openFile(entry.path);
      }}
      onDoubleClick={() => {
        if (!isDir) openFile(entry.path, { pinned: true });
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        useFiles.setState({ selected: entry.path });
        void showEntryMenu(entry);
      }}
      className={clsx(
        'flex h-[22px] cursor-default items-center pr-2 text-[13px] leading-[22px]',
        selected ? 'bg-accent-soft text-fg' : 'hover:bg-bg-muted',
        dropTarget && 'bg-accent-soft outline outline-1 -outline-offset-1 outline-accent',
        entry.ignored && 'text-fg-subtle',
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      <span className="flex w-4 shrink-0 items-center justify-center text-fg-subtle">
        {isDir && (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
      </span>
      <Icon size={14} className={clsx('mr-1.5 shrink-0', isDir ? 'text-accent' : 'text-fg-subtle')} />
      <span className={clsx('min-w-0 flex-1 truncate', entry.symlink && 'italic')}>{entry.name}</span>
      {decoration && <span className="ml-1 shrink-0 font-mono text-[11px] text-fg-muted">{decoration.letter}</span>}
    </div>
  );
}

function HeaderButton({
  label,
  onClick,
  children,
  testId,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-testid={testId}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
    >
      {children}
    </button>
  );
}

/** PLAN F-FILES-01: lazy, virtualised project tree. */
export default function FilesPanel() {
  const projectName = useApp((s) => s.project?.name ?? '');
  const children = useFiles((s) => s.children);
  const expanded = useFiles((s) => s.expanded);
  const selected = useFiles((s) => s.selected);
  const renaming = useFiles((s) => s.renaming);
  const creating = useFiles((s) => s.creating);
  const decorations = useFiles((s) => s.decorations);
  const revealRequest = useFiles((s) => s.revealRequest);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const rows = useMemo(() => visibleRows(children, expanded, creating), [children, expanded, creating]);
  const rootLoaded = '' in children;

  useEffect(() => {
    if (!rootLoaded) void loadDir('');
  }, [rootLoaded]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  // Keep the selected row in view after reveal or keyboard moves.
  useEffect(() => {
    const element = scroller.current;
    if (!element || selected === null) return;
    const index = rows.findIndex((r) => r.kind === 'entry' && r.entry.path === selected);
    if (index === -1) return;
    const top = index * ROW;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW - element.clientHeight;
    // Only on reveal requests and selection changes, not every listing refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, revealRequest]);

  useEffect(() => {
    if (revealRequest > 0) scroller.current?.focus();
  }, [revealRequest]);

  const start = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + OVERSCAN);

  const onKeyDown = (event: KeyboardEvent): void => {
    const entries = rows.filter((r): r is Extract<TreeRow, { kind: 'entry' }> => r.kind === 'entry');
    const index = entries.findIndex((r) => r.entry.path === selected);
    const current = entries[index]?.entry;
    const select = (row: (typeof entries)[number] | undefined): void => {
      if (row) useFiles.setState({ selected: row.entry.path });
    };
    switch (event.key) {
      case 'ArrowDown':
        select(entries[Math.min(entries.length - 1, index + 1)]);
        break;
      case 'ArrowUp':
        select(entries[Math.max(0, index - 1)]);
        break;
      case 'ArrowRight':
        if (current?.kind === 'directory') toggleDir(current.path, true);
        break;
      case 'ArrowLeft':
        if (current?.kind === 'directory' && current.path in expanded) toggleDir(current.path, false);
        else if (current) useFiles.setState({ selected: parentPath(current.path) || current.path });
        break;
      case 'Enter':
        if (current?.kind === 'directory') toggleDir(current.path);
        else if (current) openFile(current.path, { pinned: true });
        break;
      case 'F2':
        if (current) useFiles.setState({ renaming: current.path });
        break;
      case 'Delete':
        if (current) void deleteEntry(current);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className="flex h-full flex-col" data-testid="files-panel">
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
          {projectName}
        </span>
        <HeaderButton
          label="New File"
          testId="explorer-new-file"
          onClick={() => startCreate(currentEntry(selected), 'file')}
        >
          <FilePlus size={14} />
        </HeaderButton>
        <HeaderButton
          label="New Folder"
          testId="explorer-new-folder"
          onClick={() => startCreate(currentEntry(selected), 'directory')}
        >
          <FolderPlus size={14} />
        </HeaderButton>
        <HeaderButton label="Refresh" testId="explorer-refresh" onClick={() => void refreshTree()}>
          <RefreshCw size={13} />
        </HeaderButton>
        <HeaderButton
          label="Collapse Folders"
          testId="explorer-collapse"
          onClick={() => useFiles.setState({ expanded: {} })}
        >
          <ListCollapse size={14} />
        </HeaderButton>
      </div>
      <div
        ref={scroller}
        role="tree"
        aria-label="Files"
        tabIndex={0}
        data-panel-focus
        data-testid="explorer-tree"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => {
          event.preventDefault();
          void showEntryMenu(null);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
          event.preventDefault();
          setDropTarget('');
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
        }}
        onDrop={(event) => {
          const from = event.dataTransfer.getData(DRAG_TYPE);
          setDropTarget(null);
          if (!from || parentPath(from) === '') return;
          event.preventDefault();
          void moveEntry(from, baseName(from));
        }}
        className={clsx('relative min-h-0 flex-1 overflow-auto outline-none', dropTarget === '' && 'bg-accent-soft/40')}
      >
        {!rootLoaded ? (
          <div className="px-3 py-2 text-xs text-fg-subtle">Loading…</div>
        ) : (
          <div style={{ height: rows.length * ROW }} className="relative">
            <div style={{ transform: `translateY(${start * ROW}px)` }}>
              {rows.slice(start, end).map((row) =>
                row.kind === 'create' ? (
                  <NameInput
                    key={`create:${row.dir}`}
                    initial=""
                    depth={row.depth}
                    kind={row.entryKind}
                    onCancel={() => useFiles.setState({ creating: null })}
                    onCommit={(name) => {
                      useFiles.setState({ creating: null });
                      void createEntry(row.dir, name, row.entryKind);
                    }}
                  />
                ) : (
                  <EntryRow
                    key={row.entry.path}
                    entry={row.entry}
                    depth={row.depth}
                    selected={row.entry.path === selected}
                    expanded={row.entry.path in expanded}
                    renaming={row.entry.path === renaming}
                    dropTarget={dropTarget !== null && dropTarget !== '' && dropTarget === row.entry.path}
                    decoration={decorations[row.entry.path]}
                    onDragTarget={setDropTarget}
                  />
                ),
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function currentEntry(path: string | null): FileEntry | null {
  if (path === null) return null;
  return useFiles.getState().children[parentPath(path)]?.find((e) => e.path === path) ?? null;
}
