import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Command } from 'cmdk';
import { ChevronLeft, ChevronRight, Play, Plus, SquareTerminal } from 'lucide-react';
import { terminalAgentName, type ProjectCommand, type SessionStatus, type TerminalInfo } from '@arbora/shared';
import {
  focusGroveProject,
  noteProjectFramework,
  openInboxItem,
  openLauncher,
  openLauncherFor,
  selectGroveTerminal,
  selectSession,
  useGrove,
  useGroveSidebar,
} from '../../grove-store';
import { useApp } from '../../store';
import { AgentMark, agentIdForCliName } from './AgentMark';
import { FrameworkMark } from './FrameworkMark';
import { StatusDot } from './StatusDot';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'projects', label: 'Projects' },
  { id: 'agents', label: 'Agents' },
  { id: 'terminals', label: 'Terminals' },
  { id: 'commands', label: 'Commands' },
] as const;

type GroveSearchTab = (typeof TABS)[number]['id'];
type GroveSearchSection = Exclude<GroveSearchTab, 'all'>;
type RowKind = 'action' | 'inbox' | 'project' | 'agent' | 'terminal' | 'command';

const LIST =
  'max-h-[min(420px,52vh)] overflow-y-auto px-1.5 pt-1 pb-2 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-fg-subtle [&_[cmdk-group]:first-child_[cmdk-group-heading]]:pt-1.5';

const ITEM =
  'flex w-full cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] outline-none data-[selected=true]:bg-fg/15';

/** Grove's Mod+Shift+K. Tabs filter projects, agents, terminals, commands, and the create actions. */
export function GroveSearch() {
  const open = useGrove((s) => s.searchOpen);
  if (!open) return null;
  return <GroveSearchOpen />;
}

function GroveSearchOpen() {
  const project = useApp((s) => s.project);
  const listed = useApp((s) => s.settings.grove.projects);
  const aliases = useApp((s) => s.settings.projects);
  const sidebar = useGroveSidebar();
  const terminalsByProject = useGrove((s) => s.terminalsByProject);
  const usage = useGrove((s) => s.usage);
  const frameworks = useGrove((s) => s.frameworkByPath);
  const focusPath = useGrove((s) => s.focusPath);
  const active = focusPath ?? project?.path ?? null;
  const [commandsByPath, setCommandsByPath] = useState<Readonly<Record<string, ProjectCommand[]>>>({});
  const [tab, setTab] = useState<GroveSearchTab>('all');
  const [highlighted, setHighlighted] = useState('');
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const close = (): void => useGrove.setState({ searchOpen: false });
  const paths = listed.map((entry) => entry.path);
  const pathKey = paths.join('\0');
  const target = targetPath && paths.includes(targetPath) ? targetPath : (active ?? paths[0] ?? null);

  useEffect(() => {
    if (pathKey === '') return;
    let live = true;
    void Promise.all(
      pathKey.split('\0').map(async (path) => {
        const result = await window.arbora.invoke('grove.commands', { path });
        return [path, result.commands, result.framework] as const;
      }),
    ).then((entries) => {
      if (!live) return;
      setCommandsByPath(Object.fromEntries(entries.map(([path, commands]) => [path, commands])));
      for (const [path, , framework] of entries) noteProjectFramework(path, framework);
    });
    return () => {
      live = false;
    };
  }, [pathKey]);

  const nameOf = (path: string): string =>
    aliases[path]?.alias ?? (path === project?.path ? project.name : folderName(path));
  const show = (section: GroveSearchSection): boolean => tab === 'all' || tab === section;
  const targetName = target ? nameOf(target) : null;
  const agents = searchAgents(sidebar.agents, terminalsByProject, usage, now);
  const plainTerminals = plainTerminalRows(terminalsByProject, usage);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <Command
        label="Grove search"
        data-testid="grove-search"
        className="w-[min(640px,92vw)] overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-2xl"
        onValueChange={setHighlighted}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
          }
          if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          if (highlighted.startsWith('new agent') || highlighted.startsWith('new terminal')) {
            cycleTarget(paths, target, event.key === 'ArrowRight' ? 1 : -1, setTargetPath);
            return;
          }
          setTab((current) => stepTab(current, event.key === 'ArrowRight' ? 1 : -1));
        }}
      >
        <div className="border-b border-border">
          <Command.Input
            autoFocus
            placeholder="Search projects, agents, terminals, and commands…"
            style={{ outline: 'none' }}
            className="h-12 w-full border-0 bg-transparent px-4 text-[15px] shadow-none outline-none focus:outline-none focus-visible:outline-none placeholder:text-fg-subtle"
          />
          <div className="flex items-center gap-2 px-3 pb-2.5">
            <div role="tablist" aria-label="Filter" className="flex min-w-0 flex-1 items-center gap-0.5">
              {TABS.map((entry) => {
                const selected = tab === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setTab(entry.id)}
                    className={clsx(
                      'shrink-0 rounded-full px-2.5 py-1 text-[13px]',
                      selected ? 'bg-fg/15 text-fg' : 'text-fg-muted hover:text-fg',
                    )}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label="Previous tab"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setTab((current) => stepTab(current, -1))}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-fg-subtle hover:bg-fg/10 hover:text-fg"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                aria-label="Next tab"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setTab((current) => stepTab(current, 1))}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-fg-subtle hover:bg-fg/10 hover:text-fg"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
        <Command.List className={LIST}>
          <Command.Empty className="px-3 py-8 text-center text-[12px] text-fg-subtle">Nothing matches.</Command.Empty>
          {tab === 'all' && sidebar.inbox.length > 0 && (
            <Command.Group heading="Inbox" forceMount>
              {sidebar.inbox.map((row) => (
                <Item
                  key={`${row.projectPath}:${row.threadId}`}
                  kind="inbox"
                  forceMount
                  reason={row.reason}
                  value={`inbox ${row.name} ${row.projectName} ${row.threadId}`}
                  mark={
                    <span className="flex items-center gap-1.5">
                      <AgentMark name={row.name} agentId={row.agentId} />
                      <StatusDot status={row.status} />
                    </span>
                  }
                  title={row.name}
                  titleClass={clsx(
                    row.reason === 'needsInput' && 'text-attention',
                    row.reason === 'failed' && 'text-danger',
                  )}
                  meta={row.projectName}
                  onSelect={() => {
                    close();
                    openInboxItem(row);
                  }}
                />
              ))}
            </Command.Group>
          )}
          {tab === 'all' && (
            <Command.Group heading="Actions">
              <Item
                kind="action"
                value="new agent"
                mark={<Plus size={14} />}
                title="New agent…"
                meta={targetName}
                onSelect={() => {
                  close();
                  if (target) void openLauncherFor(target);
                  else openLauncher();
                }}
              />
              <Item
                kind="action"
                value="new terminal"
                mark={<Plus size={14} />}
                title="New terminal"
                meta={targetName}
                onSelect={() => {
                  close();
                  if (!target) return;
                  void focusThen(target, project?.path ?? null).then(() =>
                    window.arbora
                      .invoke('terminal.create', { cols: 100, rows: 24 })
                      .then((info) => selectGroveTerminal(info.id)),
                  );
                }}
              />
              <Item
                kind="action"
                value="add project"
                mark={<Plus size={14} />}
                title="Add project…"
                onSelect={() => {
                  close();
                  void window.arbora.invoke('grove.addProject', {});
                }}
              />
            </Command.Group>
          )}
          {show('projects') && paths.length > 0 && (
            <Command.Group heading="Projects">
              {paths.map((path) => (
                <Item
                  key={path}
                  kind="project"
                  value={`project ${nameOf(path)} ${folderName(path)} ${path}`}
                  mark={<FrameworkMark framework={frameworks[path] ?? 'arbora'} />}
                  title={nameOf(path)}
                  meta={folderName(path)}
                  onSelect={() => {
                    close();
                    void focusGroveProject(path === project?.path ? null : path);
                  }}
                />
              ))}
            </Command.Group>
          )}
          {tab === 'all' && agents.length > 0 && (
            <Command.Group heading="Agents">
              {agents.map((row) => (
                <AgentItem key={row.key} row={row} meta={rowMeta(nameOf(row.projectPath), row.age)} close={close} />
              ))}
            </Command.Group>
          )}
          {tab === 'agents' &&
            paths.map((path) => {
              const rows = agents.filter((row) => row.projectPath === path);
              if (rows.length === 0) return null;
              return (
                <Command.Group key={path} heading={nameOf(path)}>
                  {rows.map((row) => (
                    <AgentItem key={row.key} row={row} meta={row.age} close={close} />
                  ))}
                </Command.Group>
              );
            })}
          {tab === 'all' && plainTerminals.length > 0 && (
            <Command.Group heading="Terminals">
              {plainTerminals.map((terminal) => (
                <TerminalItem key={terminal.id} terminal={terminal} meta={nameOf(terminal.projectPath)} close={close} />
              ))}
            </Command.Group>
          )}
          {tab === 'terminals' &&
            paths.map((path) => {
              const rows = plainTerminals.filter((terminal) => terminal.projectPath === path);
              if (rows.length === 0) return null;
              return (
                <Command.Group key={path} heading={nameOf(path)}>
                  {rows.map((terminal) => (
                    <TerminalItem key={terminal.id} terminal={terminal} meta={null} close={close} />
                  ))}
                </Command.Group>
              );
            })}
          {tab === 'all' && paths.some((path) => (commandsByPath[path]?.length ?? 0) > 0) && (
            <Command.Group heading="Commands">
              {paths.flatMap((path) =>
                (commandsByPath[path] ?? []).map((command) => (
                  <CommandItem
                    key={`${path}:${command.id}`}
                    path={path}
                    command={command}
                    meta={commandMeta(nameOf(path), command.command)}
                    close={close}
                  />
                )),
              )}
            </Command.Group>
          )}
          {tab === 'commands' &&
            paths.map((path) => {
              const rows = commandsByPath[path] ?? [];
              if (rows.length === 0) return null;
              return (
                <Command.Group key={path} heading={nameOf(path)}>
                  {rows.map((command) => (
                    <CommandItem key={command.id} path={path} command={command} meta={command.command} close={close} />
                  ))}
                </Command.Group>
              );
            })}
        </Command.List>
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11.5px] text-fg-subtle">
          <span>
            <kbd className="font-mono">Esc</kbd> to close
          </span>
          <span>
            <kbd className="font-mono">Enter</kbd> to open
          </span>
        </div>
      </Command>
    </div>
  );
}

function Item({
  kind,
  value,
  mark,
  title,
  titleClass,
  meta,
  reason,
  forceMount,
  onSelect,
}: {
  kind: RowKind;
  value: string;
  mark: ReactNode;
  title: string;
  titleClass?: string;
  meta?: string | null;
  reason?: string;
  forceMount?: boolean;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      data-kind={kind}
      className={ITEM}
      {...(reason !== undefined ? { 'data-reason': reason } : {})}
      {...(forceMount === true ? { forceMount: true } : {})}
    >
      <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center text-fg-subtle">
        {mark}
      </span>
      <span className={clsx('min-w-0 flex-1 truncate', titleClass)}>{title}</span>
      {meta ? (
        <span title={meta} className="max-w-[50%] shrink-0 truncate text-[12px] text-fg-subtle tabular-nums">
          {meta}
        </span>
      ) : null}
    </Command.Item>
  );
}

function stepTab(current: GroveSearchTab, delta: 1 | -1): GroveSearchTab {
  const index = TABS.findIndex((entry) => entry.id === current);
  const next = (index + delta + TABS.length) % TABS.length;
  return TABS[next]?.id ?? 'all';
}

function folderName(path: string): string {
  const parts = path.split(/[/\\]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
}

/** `1m`, `2h`, `1d`. Under a minute is `<1m`. Missing timestamps show nothing. */
function relativeAge(timestamp: number, now: number): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const elapsed = now - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return '<1m';
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h`;
  return `${Math.floor(elapsed / day)}d`;
}

/** Project name, then the shell command, so a command is not the same row as a terminal. */
function commandMeta(projectName: string | null, command: string): string {
  return projectName ? `${projectName} · ${command}` : command;
}

function rowMeta(projectName: string, age: string | null): string {
  return age ? `${projectName} · ${age}` : projectName;
}

interface SearchAgent {
  readonly key: string;
  readonly projectPath: string;
  readonly name: string;
  readonly agentId: string | undefined;
  readonly status: SessionStatus;
  readonly age: string | null;
  readonly select: () => void;
}

function searchAgents(
  agents: ReturnType<typeof useGroveSidebar>['agents'],
  terminalsByProject: Readonly<Record<string, readonly TerminalInfo[]>>,
  usage: ReturnType<typeof useGrove.getState>['usage'],
  now: number,
): SearchAgent[] {
  const rows: SearchAgent[] = agents.map((row) => ({
    key: `${row.projectPath}:${row.id}`,
    projectPath: row.projectPath,
    name: row.session.name,
    agentId: row.session.agentId,
    status: row.session.status,
    age: relativeAge(row.session.updatedAt, now),
    select: () => {
      selectGroveTerminal(null);
      selectSession(row.id);
    },
  }));
  for (const [path, terminals] of Object.entries(terminalsByProject)) {
    for (const terminal of terminals) {
      const cli =
        usage.find((entry) => entry.kind === 'terminal' && entry.id === terminal.id)?.agentCli ??
        terminalAgentName(terminal.command);
      if (!cli) continue;
      rows.push({
        key: `cli:${path}:${terminal.id}`,
        projectPath: path,
        name: cli,
        agentId: agentIdForCliName(cli),
        status: 'working',
        age: null,
        select: () => {
          void focusThen(path, useApp.getState().project?.path ?? null).then(() => selectGroveTerminal(terminal.id));
        },
      });
    }
  }
  return rows;
}

function plainTerminalRows(
  terminalsByProject: Readonly<Record<string, readonly TerminalInfo[]>>,
  usage: ReturnType<typeof useGrove.getState>['usage'],
): { id: string; projectPath: string; title: string }[] {
  const rows: { id: string; projectPath: string; title: string }[] = [];
  for (const [path, terminals] of Object.entries(terminalsByProject)) {
    for (const terminal of terminals) {
      const cli =
        usage.find((entry) => entry.kind === 'terminal' && entry.id === terminal.id)?.agentCli ??
        terminalAgentName(terminal.command);
      if (cli) continue;
      rows.push({ id: terminal.id, projectPath: path, title: terminal.title });
    }
  }
  return rows;
}

function AgentItem({ row, meta, close }: { row: SearchAgent; meta: string | null; close: () => void }) {
  return (
    <Item
      kind="agent"
      value={`agent ${row.name} ${row.projectPath} ${row.key}`}
      mark={
        <span className="flex items-center gap-1.5">
          <AgentMark name={row.name} agentId={row.agentId} />
          <StatusDot status={row.status} />
        </span>
      }
      title={row.name}
      meta={meta}
      onSelect={() => {
        close();
        row.select();
      }}
    />
  );
}

function TerminalItem({
  terminal,
  meta,
  close,
}: {
  terminal: { id: string; projectPath: string; title: string };
  meta: string | null;
  close: () => void;
}) {
  return (
    <Item
      kind="terminal"
      value={`terminal ${terminal.title} ${terminal.id} ${terminal.projectPath}`}
      mark={<SquareTerminal size={14} />}
      title={terminal.title}
      meta={meta}
      onSelect={() => {
        close();
        void focusThen(terminal.projectPath, useApp.getState().project?.path ?? null).then(() =>
          selectGroveTerminal(terminal.id),
        );
      }}
    />
  );
}

function CommandItem({
  path,
  command,
  meta,
  close,
}: {
  path: string;
  command: ProjectCommand;
  meta: string;
  close: () => void;
}) {
  return (
    <Item
      kind="command"
      value={`command ${command.title} ${command.command} ${path} ${command.id}`}
      mark={<Play size={12} />}
      title={command.title}
      meta={meta}
      onSelect={() => {
        close();
        void focusThen(path, useApp.getState().project?.path ?? null).then(() =>
          window.arbora
            .invoke('grove.trustCommand', { path, command: command.command })
            .then(() =>
              window.arbora.invoke('grove.runCommand', {
                path,
                command: command.command,
                title: command.title,
                cols: 100,
                rows: 24,
              }),
            )
            .then((info) => selectGroveTerminal(info.id)),
        );
      }}
    />
  );
}

function cycleTarget(
  paths: readonly string[],
  target: string | null,
  delta: 1 | -1,
  setTarget: (path: string) => void,
): void {
  if (paths.length === 0) return;
  const index = target ? paths.indexOf(target) : 0;
  const start = index < 0 ? 0 : index;
  const next = paths[(start + delta + paths.length) % paths.length];
  if (next) setTarget(next);
}

async function focusThen(path: string, openPath: string | null): Promise<void> {
  const showing = useGrove.getState().focusPath ?? openPath;
  if (showing !== path) await focusGroveProject(path === openPath ? null : path);
}
