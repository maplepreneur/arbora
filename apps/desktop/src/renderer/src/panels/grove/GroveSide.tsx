import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Plus, SquareTerminal, X } from 'lucide-react';
import {
  groveProjectSections,
  terminalAgentName,
  type AgentGroup,
  type ProjectFramework,
  type TerminalInfo,
} from '@arbora/shared';
import { useAgents } from '../../agent-store';
import {
  claimListFocus,
  closeGroveProject,
  createGroveTerminal,
  focusGroveProject,
  RECENT_LIMIT,
  noteProjectFramework,
  noteProjectTerminals,
  openInboxItem,
  openLauncherFor,
  selectGroveTerminal,
  selectSession,
  startAgentIn,
  useGrove,
  useGroveSidebar,
} from '../../grove-store';
import { updateProjectGroup } from '../../projects-store';
import { useApp } from '../../store';
import { useTerminals } from '../../terminal-store';
import { AgentMark, agentIdForCliName } from './AgentMark';
import { FrameworkMark } from './FrameworkMark';
import { groupProjectTerminals } from './project-terminals';
import { ListFooter, RecentSection, SessionRow } from './SessionList';
import {
  actionNavId,
  agentNavId,
  buildSidebarNav,
  commandNavId,
  inboxNavId,
  moveSidebarFocus,
  projectNavId,
  recentNavId,
  sectionNavId,
  sidebarEnter,
  sidebarHorizontal,
  terminalNavId,
  type SidebarNavRow,
  type SideSectionName,
} from './sidebar-nav';
import { StatusDot } from './StatusDot';
import type { GroveModel } from '../../grove-model';

interface ListedCommand {
  id: string;
  title: string;
  command: string;
  source: string;
  trusted: boolean;
}

/** Takes `listFocusRequest` once: the selected agent row, else the first one. */
function useListFocus(container: RefObject<HTMLElement | null>, onFocus: (id: string | null) => void): void {
  const request = useGrove((s) => s.listFocusRequest);
  useEffect(() => {
    if (!claimListFocus(request)) return;
    const root = container.current;
    const row =
      root?.querySelector<HTMLElement>('[data-testid="grove-row"][aria-current="true"]') ??
      root?.querySelector<HTMLElement>('[data-testid="grove-row"]');
    onFocus(row?.getAttribute('data-nav-id') ?? null);
    (row ?? root)?.focus();
  }, [request, container, onFocus]);
}

/** The projects Grove remembers. Each one expands to its agents, then terminals, then commands. */
export function GroveSide() {
  const open = useApp((s) => s.project);
  const listed = useApp((s) => s.settings.grove.projects);
  const projectGroups = useApp((s) => s.settings.projectGroups);
  const states = useApp((s) => s.settings.projects);
  const aliases = useApp((s) => s.settings.projects);
  const focusPath = useGrove((s) => s.focusPath);
  const terminalId = useGrove((s) => s.terminalId);
  const recentOpen = useGrove((s) => s.recentOpen);
  const showAllRecent = useGrove((s) => s.showAllRecent);
  const sidebar = useGroveSidebar();
  const selectedId = useApp((s) => s.layout.groveThreadId);
  const agentGroups = useAgents((s) => s.groups);
  const scroller = useRef<HTMLDivElement>(null);
  const [navFocus, setNavFocus] = useState<string | null>(null);
  const rememberNav = useCallback((id: string | null) => setNavFocus(id), []);
  useListFocus(scroller, rememberNav);
  const usage = useGrove((s) => s.usage);
  const frameworks = useGrove((s) => s.frameworkByPath);
  const terminalsByProject = useGrove((s) => s.terminalsByProject);
  const terminals = useTerminals((s) => s.terminals);
  const active = focusPath ?? open?.path ?? null;
  const [commandsByPath, setCommandsByPath] = useState<Readonly<Record<string, ListedCommand[]>>>({});
  const [sectionOpen, setSectionOpen] = useState<Readonly<Record<string, boolean>>>({});
  const paths = sidebar.paths;
  const pathKey = paths.join('\0');
  const sectionExpanded = (path: string, section: SideSectionName): boolean =>
    sectionOpen[`${path}:${section}`] !== false;
  const setSection = (path: string, section: SideSectionName, expanded: boolean): void => {
    setSectionOpen((current) => ({ ...current, [`${path}:${section}`]: expanded }));
  };

  useEffect(() => {
    const current = pathKey === '' ? [] : pathKey.split('\0');
    let live = true;
    void window.arbora.invoke('grove.terminals').then((result) => {
      if (!live) return;
      for (const project of result.projects) noteProjectTerminals(project.path, project.terminals);
    });
    if (current.length === 0)
      return () => {
        live = false;
      };
    void Promise.all(
      current.map(async (path) => {
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
    aliases[path]?.alias ?? (path === open?.path ? open.name : path.split(/[/\\]/).pop()) ?? path;
  const sections = groveProjectSections(paths, projectGroups, states);
  const remembered = new Set(listed.map((entry) => entry.path));
  const tabId = sidebar.order.some((row) => row.id === selectedId) ? selectedId : (sidebar.order[0]?.id ?? null);
  const navRows = useMemo(
    () =>
      buildSidebarNav({
        inbox: sidebar.inbox.map((row) => ({ threadId: row.threadId, path: row.projectPath })),
        projects: sections.flatMap((section) =>
          section.collapsed
            ? []
            : section.paths.map((path) => {
                const collapsed = listed.find((entry) => entry.path === path)?.collapsed === true;
                const parts = classifyProject(
                  terminalsFor(path, active, terminals, terminalsByProject),
                  commandsByPath[path] ?? [],
                  sidebar.byPath.get(path),
                  usage,
                  terminalId,
                );
                const recent = recentEntries(sidebar.byPath.get(path), recentOpen, showAllRecent);
                return {
                  path,
                  expanded: !collapsed,
                  sections: collapsed
                    ? []
                    : [
                        {
                          section: 'agents' as const,
                          expanded: sectionOpen[`${path}:agents`] !== false,
                          leaves: [
                            ...parts.agentRows.map((row) => ({ kind: 'agent' as const, id: row.thread.id })),
                            ...parts.agentTerminals.map((terminal) => ({ kind: 'terminal' as const, id: terminal.id })),
                            { kind: 'action' as const, id: 'new-agent', action: 'new-agent' as const },
                          ],
                          ...(recent ? { recent } : {}),
                        },
                        {
                          section: 'terminals' as const,
                          expanded: sectionOpen[`${path}:terminals`] !== false,
                          leaves: [
                            ...parts.plainTerminals.map((terminal) => ({ kind: 'terminal' as const, id: terminal.id })),
                            { kind: 'action' as const, id: 'new-terminal', action: 'new-terminal' as const },
                          ],
                        },
                        ...(parts.commands.length > 0
                          ? [
                              {
                                section: 'commands' as const,
                                expanded: sectionOpen[`${path}:commands`] !== false,
                                leaves: parts.commands.map((command) => ({ kind: 'command' as const, id: command.id })),
                              },
                            ]
                          : []),
                      ],
                };
              }),
        ),
      }),
    [
      sidebar.inbox,
      sidebar.byPath,
      sections,
      listed,
      active,
      terminals,
      terminalsByProject,
      commandsByPath,
      usage,
      terminalId,
      sectionOpen,
      recentOpen,
      showAllRecent,
    ],
  );

  const focusNav = (id: string | null): void => {
    setNavFocus(id);
    if (!id) return;
    scroller.current?.querySelector<HTMLElement>(`[data-nav-id="${CSS.escape(id)}"]`)?.focus();
  };

  const applyHorizontal = (direction: 'left' | 'right', id: string | null): void => {
    const move = sidebarHorizontal(navRows, id, direction);
    if (move.type === 'focus') focusNav(move.id);
    if (move.type !== 'expand' && move.type !== 'collapse') return;
    const row = navRows.find((item) => item.id === move.id);
    const expanded = move.type === 'expand';
    if (row?.kind === 'project')
      void window.arbora.invoke('grove.setCollapsed', { path: row.path, collapsed: !expanded });
    if (row?.kind === 'section') setSection(row.path, row.section, expanded);
    if (row?.kind === 'recent') useGrove.setState({ recentOpen: expanded });
  };

  const activate = (row: SidebarNavRow): void => {
    const action = sidebarEnter(row);
    switch (action.type) {
      case 'focus-project':
        void focusGroveProject(action.path === open?.path ? null : action.path);
        return;
      case 'toggle-section':
        setSection(action.path, action.section, !sectionExpanded(action.path, action.section));
        return;
      case 'toggle-recent':
        useGrove.setState((state) => ({ recentOpen: !state.recentOpen }));
        return;
      case 'focus-agent':
        selectSession(action.threadId);
        return;
      case 'focus-terminal':
        void showProjectTerminal(action.path, action.terminalId, true);
        return;
      case 'run-command': {
        const command = (commandsByPath[action.path] ?? []).find((item) => item.id === action.commandId);
        if (!command) return;
        const parts = classifyProject(
          terminalsFor(action.path, active, terminals, terminalsByProject),
          commandsByPath[action.path] ?? [],
          sidebar.byPath.get(action.path),
          usage,
          terminalId,
        );
        void runCommand(
          action.path,
          command,
          parts.running[command.id],
          () =>
            setCommandsByPath((current) => ({
              ...current,
              [action.path]: (current[action.path] ?? []).map((item) =>
                item.id === command.id ? { ...item, trusted: true } : item,
              ),
            })),
          { focus: true },
        );
        return;
      }
      case 'new-agent':
        void startAgentIn(action.path);
        return;
      case 'new-terminal':
        void createGroveTerminal(action.path);
        return;
      case 'show-all-recent':
        useGrove.setState({ showAllRecent: true });
        return;
      case 'open-inbox':
        openInboxItem({ threadId: action.threadId, projectPath: action.path });
        return;
      default: {
        const unreachable: never = action;
        return unreachable;
      }
    }
  };

  const onSideKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = event.key;
    if (
      key !== 'ArrowDown' &&
      key !== 'ArrowUp' &&
      key !== 'ArrowLeft' &&
      key !== 'ArrowRight' &&
      key !== 'Enter' &&
      key !== 'Home' &&
      key !== 'End'
    ) {
      return;
    }
    const rowEl = target.closest<HTMLElement>('[data-nav-id]');
    if (target !== event.currentTarget && !rowEl) return;
    const currentId = rowEl?.getAttribute('data-nav-id') ?? navFocus;
    event.preventDefault();
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      focusNav(moveSidebarFocus(navRows, currentId, key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (key === 'Home') {
      focusNav(navRows[0]?.id ?? null);
      return;
    }
    if (key === 'End') {
      focusNav(navRows[navRows.length - 1]?.id ?? null);
      return;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      applyHorizontal(key === 'ArrowLeft' ? 'left' : 'right', currentId);
      return;
    }
    const row = navRows.find((item) => item.id === currentId);
    if (row) {
      setNavFocus(row.id);
      activate(row);
    }
  };

  return (
    <div data-testid="grove-projects" className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        tabIndex={-1}
        data-testid="grove-sessions"
        className="min-h-0 flex-1 overflow-y-auto outline-none"
        onKeyDown={onSideKeyDown}
      >
        {sidebar.inbox.length > 0 && (
          <div data-testid="grove-inbox" className="border-b border-border px-1 pt-1 pb-1">
            <div className="flex h-6 items-center gap-2 px-1.5">
              <span className="text-[10px] font-semibold tracking-wide text-fg-subtle uppercase">Inbox</span>
              <span className="ml-auto shrink-0 pl-3 text-[10px] text-fg-muted tabular-nums">
                {sidebar.inbox.length}
              </span>
            </div>
            {sidebar.inbox.map((row) => (
              <button
                key={`${row.projectPath}:${row.threadId}`}
                type="button"
                data-testid="grove-inbox-row"
                data-thread-id={row.threadId}
                data-project={row.projectPath}
                data-reason={row.reason}
                data-nav-id={inboxNavId(row.projectPath, row.threadId)}
                data-kbd={navFocus === inboxNavId(row.projectPath, row.threadId) || undefined}
                title={`${row.name} · ${row.projectName}`}
                onClick={() => {
                  setNavFocus(inboxNavId(row.projectPath, row.threadId));
                  openInboxItem(row);
                }}
                className={clsx(
                  'flex h-7 w-full items-center gap-2 rounded px-1.5 text-left hover:bg-bg-muted',
                  navFocus === inboxNavId(row.projectPath, row.threadId) && 'ring-1 ring-inset ring-accent',
                )}
              >
                <AgentMark name={row.name} />
                <StatusDot status={row.status} />
                <span
                  className={clsx(
                    'min-w-0 flex-1 truncate text-[12.5px]',
                    row.reason === 'needsInput' && 'text-attention',
                    row.reason === 'failed' && 'text-danger',
                  )}
                >
                  {row.name}
                </span>
                <span className="max-w-[46%] shrink-0 truncate pl-2 text-[10px] text-fg-subtle">{row.projectName}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1 px-2 pt-2">
          <span className="flex-1 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">Projects</span>
          <button
            type="button"
            data-testid="grove-add-project"
            title="Add a project to Grove"
            onClick={() => void window.arbora.invoke('grove.addProject', {})}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
          >
            <Plus size={14} />
          </button>
        </div>
        {paths.length === 0 && (
          <p className="px-3 py-2 text-[12px] text-fg-subtle">Add a project. It stays until you close it.</p>
        )}
        {sections.map((section) => (
          <div key={section.id}>
            {section.title && (
              <button
                type="button"
                data-testid="grove-group"
                data-group={section.id}
                aria-expanded={section.id === 'ungrouped' ? undefined : !section.collapsed}
                onClick={() => {
                  if (section.id === 'ungrouped') return;
                  void updateProjectGroup(section.id, { collapsed: !section.collapsed });
                }}
                className="flex h-7 w-full items-center gap-1 px-2 text-left text-[11px] font-semibold tracking-wide text-fg-subtle uppercase hover:text-fg"
              >
                {section.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                {section.color && (
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-sm"
                    style={{ background: `var(--group-${section.color})` }}
                  />
                )}
                <span className="truncate">{section.title}</span>
              </button>
            )}
            {!section.collapsed && (
              <ul className="flex flex-col gap-2 px-1 pb-2">
                {section.paths.map((path) => {
                  const selected = path === active;
                  const collapsed = listed.find((entry) => entry.path === path)?.collapsed === true;
                  const parent = listed.find((entry) => entry.path === path)?.parentPath;
                  const projectTerminals = terminalsFor(path, active, terminals, terminalsByProject);
                  const projectId = projectNavId(path);
                  const framework: ProjectFramework = frameworks[path] ?? 'arbora';
                  return (
                    <li key={path} className="min-w-0">
                      <div
                        className={clsx(
                          'flex min-h-10 items-center gap-0.5 rounded-md pr-0.5',
                          selected ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-bg-muted',
                          navFocus === projectId && 'ring-1 ring-inset ring-accent',
                        )}
                      >
                        <button
                          type="button"
                          title={collapsed ? 'Expand project' : 'Collapse project'}
                          aria-label={collapsed ? 'Expand project' : 'Collapse project'}
                          onClick={() => {
                            setNavFocus(projectId);
                            void window.arbora.invoke('grove.setCollapsed', { path, collapsed: !collapsed });
                          }}
                          className="flex h-10 w-6 items-center justify-center rounded text-current hover:bg-bg-muted/60"
                        >
                          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <button
                          type="button"
                          data-testid={remembered.has(path) ? 'grove-project' : undefined}
                          data-path={path}
                          data-parent={parent}
                          data-nav-id={projectId}
                          data-framework={framework}
                          aria-current={selected || undefined}
                          onClick={() => {
                            setNavFocus(projectId);
                            void focusGroveProject(path === open?.path ? null : path);
                          }}
                          className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1.5 text-left"
                        >
                          <FrameworkMark framework={framework} />
                          <span className="truncate text-[14px] font-semibold">{nameOf(path)}</span>
                          {parent && (
                            <span
                              className="ml-1 shrink-0 text-[10px] font-normal text-fg-subtle"
                              title={`Worktree of ${nameOf(parent)}`}
                            >
                              worktree
                            </span>
                          )}
                        </button>
                        {remembered.has(path) && (
                          <button
                            type="button"
                            data-testid="grove-close-project"
                            data-path={path}
                            title="Close project"
                            aria-label={`Close ${nameOf(path)}`}
                            onClick={() => void closeGroveProject(path, nameOf(path))}
                            className="flex h-8 w-6 items-center justify-center rounded text-current/70 hover:bg-bg-muted hover:text-fg"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      {!collapsed && (
                        <div className="mt-0.5 mb-0.5 ml-3 border-l border-border pl-1.5">
                          <ProjectBody
                            path={path}
                            terminals={projectTerminals}
                            terminalId={terminalId}
                            usage={usage}
                            commands={commandsByPath[path] ?? []}
                            navFocus={navFocus}
                            onNavFocus={setNavFocus}
                            agentsExpanded={sectionExpanded(path, 'agents')}
                            terminalsExpanded={sectionExpanded(path, 'terminals')}
                            commandsExpanded={sectionExpanded(path, 'commands')}
                            onToggleSection={(section) => setSection(path, section, !sectionExpanded(path, section))}
                            onTrusted={(id) =>
                              setCommandsByPath((current) => ({
                                ...current,
                                [path]: (current[path] ?? []).map((item) =>
                                  item.id === id ? { ...item, trusted: true } : item,
                                ),
                              }))
                            }
                            model={sidebar.byPath.get(path)}
                            groups={path === active ? agentGroups : []}
                            selectedId={selectedId}
                            tabId={tabId}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
      <ListFooter />
    </div>
  );
}

function classifyProject(
  terminals: readonly TerminalInfo[],
  commands: readonly ListedCommand[],
  model: GroveModel | undefined,
  usage: readonly { kind: string; id: string; agentCli: string | null }[],
  terminalId: string | null,
) {
  const agentTerminals = terminals.filter((terminal) => {
    const sample = usage.find((entry) => entry.kind === 'terminal' && entry.id === terminal.id);
    return sample?.agentCli != null || terminalAgentName(terminal.command) != null;
  });
  const grouped = groupProjectTerminals(terminals, commands, {
    selectedId: terminalId,
    agentIds: new Set(agentTerminals.map((terminal) => terminal.id)),
  });
  const agentRows = model ? model.sections.flatMap((section) => (section.group?.collapsed ? [] : section.rows)) : [];
  return { agentTerminals, plainTerminals: grouped.terminals, running: grouped.running, agentRows, commands };
}

function recentEntries(model: GroveModel | undefined, open: boolean, showAll: boolean) {
  const recent = model?.recent ?? [];
  if (recent.length === 0) return undefined;
  const visible = showAll ? recent : recent.slice(0, RECENT_LIMIT);
  return {
    present: true,
    expanded: open,
    visibleIds: open ? visible.map((session) => session.id) : [],
    showAll: open && !showAll && recent.length > RECENT_LIMIT,
  };
}

function terminalsFor(
  path: string,
  active: string | null,
  focused: readonly TerminalInfo[],
  byProject: Readonly<Record<string, readonly TerminalInfo[]>>,
): readonly TerminalInfo[] {
  if (path === active && focused.length > 0) return focused;
  return byProject[path] ?? (path === active ? focused : []);
}

function ProjectBody({
  path,
  terminals,
  terminalId,
  usage,
  commands,
  navFocus,
  onNavFocus,
  agentsExpanded,
  terminalsExpanded,
  commandsExpanded,
  onToggleSection,
  onTrusted,
  model,
  groups,
  selectedId,
  tabId,
}: {
  path: string;
  terminals: readonly TerminalInfo[];
  terminalId: string | null;
  usage: readonly { kind: string; id: string; agentCli: string | null }[];
  commands: readonly ListedCommand[];
  navFocus: string | null;
  onNavFocus: (id: string) => void;
  agentsExpanded: boolean;
  terminalsExpanded: boolean;
  commandsExpanded: boolean;
  onToggleSection: (section: SideSectionName) => void;
  onTrusted: (id: string) => void;
  model: GroveModel | undefined;
  groups: readonly AgentGroup[];
  selectedId: string | null;
  tabId: string | null;
}) {
  const agentTerminals = terminals.filter((terminal) => {
    const sample = usage.find((entry) => entry.kind === 'terminal' && entry.id === terminal.id);
    return sample?.agentCli != null || terminalAgentName(terminal.command) != null;
  });
  const grouped = groupProjectTerminals(terminals, commands, {
    selectedId: terminalId,
    agentIds: new Set(agentTerminals.map((terminal) => terminal.id)),
  });
  const plainTerminals = grouped.terminals;
  const runningCount = Object.keys(grouped.running).length;

  const agentRows = model ? model.sections.flatMap((section) => (section.group?.collapsed ? [] : section.rows)) : [];
  const nameOfThread = (threadId: string): string => model?.byId.get(threadId)?.name ?? 'another agent';

  const kbd = (id: string): boolean => navFocus === id;
  return (
    <div className="pb-0.5">
      <Section
        label="Agents"
        count={agentRows.length + agentTerminals.length}
        expanded={agentsExpanded}
        navId={sectionNavId(path, 'agents')}
        kbd={kbd(sectionNavId(path, 'agents'))}
        onToggle={() => onToggleSection('agents')}
        onFocus={() => onNavFocus(sectionNavId(path, 'agents'))}
      >
        {agentsExpanded && agentRows.length > 0 && (
          <ul>
            {agentRows.map((row) => (
              <SessionRow
                key={row.thread.id}
                session={row.thread}
                helper={row.helper}
                selected={row.thread.id === selectedId}
                tabStop={row.thread.id === tabId}
                groups={groups}
                nameOf={nameOfThread}
                navId={agentNavId(row.thread.id)}
                kbd={kbd(agentNavId(row.thread.id))}
                onNavigate={() => onNavFocus(agentNavId(row.thread.id))}
              />
            ))}
          </ul>
        )}
        {agentsExpanded &&
          agentTerminals.map((terminal) => {
            const label = usage.find((entry) => entry.id === terminal.id)?.agentCli ?? terminal.title;
            const id = terminalNavId(terminal.id);
            return (
              <Row
                key={terminal.id}
                testId="grove-terminal-agent"
                navId={id}
                kbd={kbd(id)}
                selected={terminalId === terminal.id}
                label={label}
                mark={<AgentMark name={label} agentId={agentIdForCliName(label)} />}
                onClick={() => {
                  onNavFocus(id);
                  void showProjectTerminal(path, terminal.id);
                }}
                onClose={() => void closeGroveTerminal(path, terminal.id)}
              />
            );
          })}
        {agentsExpanded && (
          <>
            <div className="flex">
              <button
                type="button"
                data-testid="grove-new"
                data-nav-id={actionNavId(path, 'new-agent')}
                data-kbd={kbd(actionNavId(path, 'new-agent')) || undefined}
                onClick={() => {
                  onNavFocus(actionNavId(path, 'new-agent'));
                  void startAgentIn(path);
                }}
                className={clsx(
                  'flex h-6 min-w-0 flex-1 items-center gap-1 px-1.5 text-[12px] text-fg-subtle hover:text-fg',
                  kbd(actionNavId(path, 'new-agent')) && 'ring-1 ring-inset ring-accent',
                )}
              >
                <Plus size={12} /> New agent
              </button>
              <button
                type="button"
                data-testid="grove-new-choose"
                aria-label="New agent with a task"
                title="New agent with a task"
                onClick={() => void openLauncherFor(path)}
                className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:text-fg"
              >
                <ChevronDown size={12} />
              </button>
            </div>
            {model && (
              <RecentSection
                recent={model.recent}
                selectedId={selectedId}
                navId={recentNavId(path)}
                kbd={kbd(recentNavId(path))}
                onNavigate={onNavFocus}
                rowNavId={agentNavId}
                rowKbd={(threadId) => kbd(agentNavId(threadId))}
                showAllNavId={actionNavId(path, 'show-all-recent')}
                showAllKbd={kbd(actionNavId(path, 'show-all-recent'))}
              />
            )}
          </>
        )}
      </Section>
      <Section
        label="Terminals"
        count={plainTerminals.length}
        expanded={terminalsExpanded}
        navId={sectionNavId(path, 'terminals')}
        kbd={kbd(sectionNavId(path, 'terminals'))}
        onToggle={() => onToggleSection('terminals')}
        onFocus={() => onNavFocus(sectionNavId(path, 'terminals'))}
      >
        {terminalsExpanded &&
          plainTerminals.map((terminal) => {
            const id = terminalNavId(terminal.id);
            return (
              <Row
                key={terminal.id}
                testId="grove-terminal"
                navId={id}
                kbd={kbd(id)}
                selected={terminalId === terminal.id}
                label={terminal.recovered === 'gone' ? `${terminal.title} · gone` : terminal.title}
                onClick={() => {
                  onNavFocus(id);
                  void showProjectTerminal(path, terminal.id);
                }}
                onClose={() => void closeGroveTerminal(path, terminal.id)}
              />
            );
          })}
        {terminalsExpanded && (
          <button
            type="button"
            data-testid="grove-new-terminal"
            data-nav-id={actionNavId(path, 'new-terminal')}
            data-kbd={kbd(actionNavId(path, 'new-terminal')) || undefined}
            onClick={() => {
              onNavFocus(actionNavId(path, 'new-terminal'));
              void createGroveTerminal(path);
            }}
            className={clsx(
              'flex h-6 items-center gap-1 px-1.5 text-[12px] text-fg-subtle hover:text-fg',
              kbd(actionNavId(path, 'new-terminal')) && 'ring-1 ring-inset ring-accent',
            )}
          >
            <SquareTerminal size={12} /> New terminal
          </button>
        )}
      </Section>
      {commands.length > 0 && (
        <Section
          label="Commands"
          count={`${runningCount}/${commands.length}`}
          expanded={commandsExpanded}
          navId={sectionNavId(path, 'commands')}
          kbd={kbd(sectionNavId(path, 'commands'))}
          testId="grove-commands"
          countAttr={`${runningCount}/${commands.length}`}
          onToggle={() => onToggleSection('commands')}
          onFocus={() => onNavFocus(sectionNavId(path, 'commands'))}
        >
          {commandsExpanded &&
            commands.map((command) => {
              const running = grouped.running[command.id];
              const id = commandNavId(path, command.id);
              return (
                <Row
                  key={command.id}
                  testId="grove-command"
                  navId={id}
                  kbd={kbd(id)}
                  selected={running !== undefined && terminalId === running.id}
                  label={command.title}
                  title={command.command}
                  bullet
                  trust={!command.trusted}
                  running={running !== undefined}
                  trusted={command.trusted}
                  onClick={() => {
                    onNavFocus(id);
                    void runCommand(path, command, running, () => onTrusted(command.id));
                  }}
                  onClose={running ? () => void closeGroveTerminal(path, running.id) : undefined}
                />
              );
            })}
        </Section>
      )}
    </div>
  );
}

function Section({
  label,
  count,
  expanded,
  navId,
  kbd,
  testId,
  countAttr,
  onToggle,
  onFocus,
  children,
}: {
  label: string;
  count?: number | string;
  expanded: boolean;
  navId: string;
  kbd: boolean;
  testId?: string;
  countAttr?: string;
  onToggle: () => void;
  onFocus: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mt-1">
      <button
        type="button"
        data-testid={testId}
        data-count={countAttr}
        data-nav-id={navId}
        data-kbd={kbd || undefined}
        aria-expanded={expanded}
        onClick={() => {
          onFocus();
          onToggle();
        }}
        className={clsx('flex h-6 w-full items-center gap-1 px-1.5 text-left', kbd && 'ring-1 ring-inset ring-accent')}
      >
        {expanded ? (
          <ChevronDown size={11} className="shrink-0 text-fg-subtle" />
        ) : (
          <ChevronRight size={11} className="shrink-0 text-fg-subtle" />
        )}
        <span className="text-[10px] font-semibold tracking-wide text-fg-subtle uppercase">{label}</span>
        {count !== undefined && (
          <span className="ml-auto shrink-0 pl-3 text-[10px] text-fg-muted tabular-nums">{count}</span>
        )}
      </button>
      {children}
    </div>
  );
}

function Row({
  label,
  selected,
  testId,
  title,
  navId,
  kbd = false,
  mark,
  bullet = false,
  trust = false,
  running = false,
  trusted,
  onClick,
  onClose,
}: {
  label: string;
  selected: boolean;
  testId: string;
  title?: string;
  navId?: string;
  kbd?: boolean;
  mark?: ReactNode;
  bullet?: boolean;
  trust?: boolean;
  running?: boolean;
  trusted?: boolean;
  onClick: () => void;
  onClose?: (() => void) | undefined;
}) {
  return (
    <div
      className={clsx(
        'group flex h-6 w-full items-center gap-1 rounded px-1.5 hover:bg-bg-muted data-[current=true]:bg-accent-soft data-[current=true]:text-accent data-[current=true]:hover:bg-accent-soft',
        kbd && 'ring-1 ring-inset ring-accent',
      )}
      data-current={selected || undefined}
      data-testid={testId}
      data-trusted={trusted || undefined}
    >
      <button
        type="button"
        title={title}
        data-nav-id={navId}
        data-kbd={kbd || undefined}
        aria-current={selected || undefined}
        onClick={onClick}
        className="flex h-6 min-w-0 flex-1 items-center gap-2 text-left text-[12px]"
      >
        {mark}
        {bullet && (
          <span aria-hidden className="w-3 shrink-0 text-center text-[10px] text-fg-subtle">
            •
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {running && (
          <span className="flex shrink-0 items-center" title="Running">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="sr-only">Running</span>
          </span>
        )}
        {trust && <span className="shrink-0 pl-3 text-[10px] text-fg-subtle">Trust</span>}
      </button>
      {onClose && (
        <button
          type="button"
          data-testid="grove-close-terminal"
          aria-label={`Close ${label}`}
          title={`Close ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-fg-subtle opacity-0 group-hover:opacity-100 group-data-[current=true]:text-accent group-data-[current=true]:opacity-100 hover:bg-bg-subtle hover:text-fg focus-visible:opacity-100"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

/** Focuses `path` when it is not the project Grove is showing, so the next terminal or agent call hits its runtime. */
async function ensureProject(path: string): Promise<void> {
  const open = useApp.getState().project?.path ?? null;
  const showing = useGrove.getState().focusPath ?? open;
  if (showing !== path) await focusGroveProject(path === open ? null : path);
}

async function showProjectTerminal(path: string, id: string, focus = false): Promise<void> {
  await ensureProject(path);
  selectGroveTerminal(id, { focus });
}

/** Stops one terminal. `terminal.close` kills a process that is still running; one terminal has no confirm. */
async function closeGroveTerminal(path: string, id: string): Promise<void> {
  const open = useApp.getState().project?.path ?? null;
  const showing = useGrove.getState().focusPath ?? open;
  if (showing !== path) await focusGroveProject(path === open ? null : path);
  await window.arbora.invoke('terminal.close', { id });
  if (useGrove.getState().terminalId === id) selectGroveTerminal(null);
}

async function runCommand(
  path: string,
  command: ListedCommand,
  running: TerminalInfo | undefined,
  onTrusted: () => void,
  options: { focus?: boolean } = {},
): Promise<void> {
  if (!command.trusted) {
    await window.arbora.invoke('grove.trustCommand', { path, command: command.command });
    onTrusted();
    return;
  }
  const open = useApp.getState().project?.path ?? null;
  const showing = useGrove.getState().focusPath ?? open;
  if (showing !== path) await focusGroveProject(path === open ? null : path);
  if (running && running.exitCode === null) {
    selectGroveTerminal(running.id, { focus: options.focus === true });
    return;
  }
  const info = await window.arbora.invoke('grove.runCommand', {
    path,
    command: command.command,
    title: command.title,
    cols: 100,
    rows: 24,
  });
  selectGroveTerminal(info.id, { focus: options.focus === true });
}
