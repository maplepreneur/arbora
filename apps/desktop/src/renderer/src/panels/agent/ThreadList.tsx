import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import clsx from 'clsx';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  MessageSquarePlus,
  MoreHorizontal,
  Pin,
  Plus,
  Square,
  Trash2,
} from 'lucide-react';
import {
  AGENT_GROUP_COLORS,
  attentionKind,
  threadSections,
  type AgentDefinition,
  type AgentGroup,
  type AttentionKind,
  type ContextMenuItem,
  type ThreadStatus,
  type ThreadSummary,
} from '@arbora/shared';
import {
  createGroup,
  createThread,
  deleteGroup,
  deleteThread,
  isListed,
  isStoppable,
  moveGroup,
  openThread,
  renameThread,
  setThreadGroup,
  setThreadPinned,
  showPicker,
  stopAgent,
  stopGroup,
  updateGroup,
  useAgents,
} from '../../agent-store';
import { shortModelName, useAutoVerify, usePickableAgents } from '../../agent-pickers';
import { useAttention, useThreadAttention } from '../../attention-store';
import { showToast } from '../../store';

export function statusDot(status: ThreadStatus): string {
  switch (status) {
    case 'idle':
      return 'bg-fg-subtle/50';
    case 'starting':
      return 'bg-amber-400 animate-pulse';
    case 'auth_required':
      return 'bg-attention';
    case 'ready':
      return 'bg-emerald-500';
    case 'prompting':
      return 'bg-accent animate-pulse';
    case 'error':
      return 'bg-danger';
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function groupColor(color: AgentGroup['color']): string {
  return `var(--group-${color})`;
}

export function formatWhen(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const ATTENTION_LABEL: Readonly<Record<AttentionKind, string>> = {
  permission: 'Needs you',
  auth: 'Log in',
  finished: 'Done',
  failed: 'Failed',
};

function AttentionChip({ kind }: { kind: AttentionKind }) {
  return (
    <span
      data-testid="thread-attention"
      data-kind={kind}
      className={clsx(
        'shrink-0 rounded px-1 text-[10px] leading-4 font-medium',
        (kind === 'permission' || kind === 'auth') && 'bg-attention-soft text-attention',
        kind === 'finished' && 'bg-accent-soft text-accent',
        kind === 'failed' && 'bg-danger/15 text-danger',
      )}
    >
      {ATTENTION_LABEL[kind]}
    </span>
  );
}

export async function showMenu(items: ContextMenuItem[]): Promise<string | null> {
  const { id } = await window.arbora.invoke('contextMenu.show', { items });
  return id;
}

export function InlineName({
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
  const finish = (commit: boolean): void => {
    const trimmed = value.trim();
    onDone(commit && trimmed ? trimmed : null);
  };
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
      className="h-6 min-w-0 flex-1 rounded border border-accent bg-bg px-1.5 text-[12px] outline-none"
    />
  );
}

function ThreadRow({
  thread,
  agent,
  active,
  groups,
  onCreateGroup,
}: {
  thread: ThreadSummary;
  agent: AgentDefinition | undefined;
  active: boolean;
  groups: readonly AgentGroup[];
  onCreateGroup: (threadId: string) => void;
}) {
  const attention = useThreadAttention(thread.id);
  const [renaming, setRenaming] = useState(false);
  const needsYou = attention === 'permission' || attention === 'auth';

  const onContextMenu = async (event: MouseEvent): Promise<void> => {
    event.preventDefault();
    const items: ContextMenuItem[] = [
      { id: 'pin', label: thread.pinned ? 'Unpin' : 'Pin to top' },
      { id: 'rename', label: 'Rename…' },
      { type: 'separator' },
      ...groups.map((g) => ({
        id: `group:${g.id}`,
        label: `Move to ${g.name}`,
        enabled: thread.groupId !== g.id,
      })),
      ...(thread.groupId !== null ? [{ id: 'ungroup', label: 'Remove from group' }] : []),
      { id: 'new-group', label: 'Move to a new group…' },
      { type: 'separator' },
      { id: 'stop', label: 'Stop agent', enabled: isStoppable(thread.state.status) },
      { id: 'delete', label: 'Delete thread' },
    ];
    const choice = await showMenu(items);
    if (!choice) return;
    try {
      if (choice === 'pin') await setThreadPinned(thread.id, !thread.pinned);
      else if (choice === 'rename') setRenaming(true);
      else if (choice === 'ungroup') await setThreadGroup(thread.id, null);
      else if (choice === 'new-group') onCreateGroup(thread.id);
      else if (choice === 'stop') await stopAgent(thread.id);
      else if (choice === 'delete') await deleteThread(thread.id);
      else if (choice.startsWith('group:')) await setThreadGroup(thread.id, choice.slice('group:'.length));
    } catch (error) {
      showToast((error as Error).message);
    }
  };

  if (renaming) {
    return (
      <li className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <InlineName
          initial={thread.title}
          label="Thread name"
          testId="thread-rename-input"
          onDone={(title) => {
            setRenaming(false);
            if (title && title !== thread.title) void renameThread(thread.id, title);
          }}
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <button
        type="button"
        data-testid="thread-row"
        data-thread-id={thread.id}
        data-group-id={thread.groupId ?? ''}
        data-pinned={thread.pinned || undefined}
        aria-current={active ? 'true' : undefined}
        aria-description={attention ? ATTENTION_LABEL[attention] : undefined}
        onClick={() => void openThread(thread.id)}
        onContextMenu={(event) => void onContextMenu(event)}
        className={clsx(
          'flex w-full flex-col gap-0.5 border-b border-border/60 px-3 py-2 text-left hover:bg-bg-muted',
          active && 'bg-bg-muted',
        )}
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className={clsx(
              'h-2 w-2 shrink-0 rounded-full',
              needsYou ? 'bg-attention' : statusDot(thread.state.status),
            )}
          />
          <span className="min-w-0 flex-1 truncate text-[12.5px]" title={thread.title}>
            {thread.title}
          </span>
          {thread.pinned && <Pin size={10} aria-label="Pinned" className="shrink-0 text-fg-subtle" />}
          {attention ? (
            <AttentionChip kind={attention} />
          ) : (
            <span className="shrink-0 text-[10px] text-fg-subtle tabular-nums">{formatWhen(thread.updatedAt)}</span>
          )}
        </span>
        <span className="pl-4 text-[11px] text-fg-subtle">{agent?.name ?? thread.agentId}</span>
      </button>
      {isStoppable(thread.state.status) && (
        <button
          type="button"
          title="Stop the agent"
          aria-label={`Stop ${thread.title}`}
          data-testid="thread-row-stop"
          onClick={() => void stopAgent(thread.id)}
          className="absolute top-1.5 right-8 flex h-6 w-6 items-center justify-center rounded text-danger hover:bg-bg"
        >
          <Square size={10} fill="currentColor" />
        </button>
      )}
      <button
        type="button"
        title="Delete thread"
        aria-label={`Delete ${thread.title}`}
        data-testid="delete-thread"
        onClick={() => void deleteThread(thread.id)}
        className="absolute top-1.5 right-1.5 hidden h-6 w-6 items-center justify-center rounded text-fg-subtle group-hover:flex group-focus-within:flex hover:bg-bg hover:text-danger"
      >
        <Trash2 size={12} />
      </button>
    </li>
  );
}

/** "2 working · 1 needs you" for a group header, like a Herdr herd. */
function GroupSummary({ threads }: { threads: readonly ThreadSummary[] }) {
  const attention = useAttention((s) => s.threads);
  const working = threads.filter((t) => t.state.status === 'prompting' || t.state.status === 'starting').length;
  const waiting = threads.filter((t) => {
    const kind = attentionKind(attention[t.id]);
    return kind === 'permission' || kind === 'auth';
  }).length;
  const parts = [
    `${threads.length}`,
    ...(working > 0 ? [`${working} working`] : []),
    ...(waiting > 0 ? [`${waiting} need${waiting === 1 ? 's' : ''} you`] : []),
  ];
  return (
    <span
      data-testid="group-summary"
      className={clsx('text-[10px] tabular-nums', waiting > 0 ? 'text-attention' : 'text-fg-subtle')}
    >
      {parts.join(' · ')}
    </span>
  );
}

function GroupHeader({
  group,
  threads,
  onNewThread,
}: {
  group: AgentGroup;
  threads: readonly ThreadSummary[];
  onNewThread: (groupId: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const groups = useAgents((s) => s.groups);
  const index = groups.findIndex((g) => g.id === group.id);

  const openMenu = async (): Promise<void> => {
    const choice = await showMenu([
      { id: 'new', label: 'New thread in group' },
      { id: 'rename', label: 'Rename…' },
      { id: 'up', label: 'Move up', enabled: index > 0 },
      { id: 'down', label: 'Move down', enabled: index < groups.length - 1 },
      { type: 'separator' },
      ...AGENT_GROUP_COLORS.map((color) => ({
        id: `color:${color}`,
        label: `Colour: ${color[0]?.toUpperCase()}${color.slice(1)}`,
        enabled: group.color !== color,
      })),
      { type: 'separator' },
      { id: 'stop', label: 'Stop all agents in group' },
      { id: 'delete', label: 'Delete group (keeps threads)' },
    ]);
    if (!choice) return;
    try {
      if (choice === 'new') onNewThread(group.id);
      else if (choice === 'rename') setRenaming(true);
      else if (choice === 'up') await moveGroup(group.id, -1);
      else if (choice === 'down') await moveGroup(group.id, 1);
      else if (choice === 'stop') {
        const stopped = await stopGroup(group.id);
        showToast(
          stopped > 0 ? `Stopped ${stopped} agent${stopped === 1 ? '' : 's'}` : 'Nothing in this group is working',
        );
      } else if (choice === 'delete') await deleteGroup(group.id);
      else if (choice.startsWith('color:')) {
        const color = AGENT_GROUP_COLORS.find((c) => `color:${c}` === choice);
        if (color) await updateGroup(group.id, { color });
      }
    } catch (error) {
      showToast((error as Error).message);
    }
  };

  return (
    <div
      data-testid="agent-group"
      data-group-id={group.id}
      className="group/header flex h-8 items-center gap-1.5 border-b border-border/60 bg-bg-subtle px-2"
      onContextMenu={(event) => {
        event.preventDefault();
        void openMenu();
      }}
    >
      <button
        type="button"
        aria-expanded={!group.collapsed}
        aria-label={group.collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
        data-testid="agent-group-toggle"
        onClick={() => void updateGroup(group.id, { collapsed: !group.collapsed })}
        className="flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:text-fg"
      >
        {group.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      </button>
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-sm" style={{ background: groupColor(group.color) }} />
      {renaming ? (
        <InlineName
          initial={group.name}
          label="Group name"
          testId="group-rename-input"
          onDone={(name) => {
            setRenaming(false);
            if (name && name !== group.name) void updateGroup(group.id, { name });
          }}
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-wide uppercase"
          onDoubleClick={() => setRenaming(true)}
          data-testid="agent-group-name"
        >
          {group.name}
        </span>
      )}
      {!renaming && <GroupSummary threads={threads} />}
      <button
        type="button"
        aria-label={`New thread in ${group.name}`}
        title={`New thread in ${group.name}`}
        data-testid="agent-group-new-thread"
        onClick={() => onNewThread(group.id)}
        className="flex h-5 w-5 items-center justify-center rounded text-fg-subtle opacity-0 group-hover/header:opacity-100 hover:bg-bg-muted hover:text-fg focus-visible:opacity-100"
      >
        <Plus size={12} />
      </button>
      <button
        type="button"
        aria-label={`${group.name} group actions`}
        data-testid="agent-group-menu"
        onClick={() => void openMenu()}
        className="flex h-5 w-5 items-center justify-center rounded text-fg-subtle opacity-0 group-hover/header:opacity-100 hover:bg-bg-muted hover:text-fg focus-visible:opacity-100"
      >
        <MoreHorizontal size={12} />
      </button>
    </div>
  );
}

export function ThreadList() {
  const allThreads = useAgents((s) => s.threads);
  // Archived threads live in Grove's Recent.
  const threads = useMemo(() => allThreads.filter(isListed), [allThreads]);
  const groups = useAgents((s) => s.groups);
  const agents = useAgents((s) => s.agents);
  const activeThreadId = useAgents((s) => s.activeThreadId);
  const byId = new Map<string, AgentDefinition>(agents.map((a) => [a.id, a]));
  const newGroupFor = useAgents((s) => s.newGroupFor);
  const setNewGroupFor = (value: string | null): void => useAgents.setState({ newGroupFor: value });
  // The global default: the starred agent when it is signed in and shown, else the first that is,
  // on its default model (or its first favourite, or its first model).
  useAutoVerify();
  const fallback = usePickableAgents()[0];
  const defaultAgent = fallback?.agent;
  const defaultModel = fallback?.models[0];
  const startDefault = (groupId?: string): void => {
    if (!defaultAgent) {
      showPicker();
      return;
    }
    createThread(defaultAgent.id, defaultModel?.value, groupId).catch((error: unknown) =>
      showToast((error as Error).message),
    );
  };
  const sections = threadSections(threads, groups);
  const showHeadings = groups.length > 0 || threads.some((t) => t.pinned);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="thread-list">
      <div className="flex gap-1 p-2">
        <div className="flex min-w-0 flex-1">
          <button
            type="button"
            data-testid="new-thread"
            data-agent={defaultAgent?.id}
            data-model={defaultModel?.value}
            title={
              defaultAgent
                ? `New thread with the default: ${defaultAgent.name}${defaultModel ? ` on ${defaultModel.name}` : ''}`
                : 'New thread: choose an agent'
            }
            onClick={() => startDefault()}
            className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-l bg-accent px-2.5 py-1 text-left text-accent-fg hover:opacity-90"
          >
            <MessageSquarePlus size={14} className="shrink-0" />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-[12px] font-medium">New thread</span>
              {defaultAgent && (
                <span className="truncate text-[11px] opacity-80" data-testid="new-thread-default">
                  {defaultAgent.name}
                  {defaultModel && ` · ${shortModelName(defaultModel.name)}`}
                </span>
              )}
            </span>
          </button>
          <button
            type="button"
            data-testid="new-thread-choose"
            title="Choose an agent and model for the new thread"
            aria-label="Choose an agent and model for the new thread"
            onClick={showPicker}
            className="flex w-8 shrink-0 items-center justify-center rounded-r border-l border-accent-fg/25 bg-accent text-accent-fg hover:opacity-90"
          >
            <ChevronDown size={13} />
          </button>
        </div>
        <button
          type="button"
          data-testid="new-agent-group"
          title="New agent group"
          aria-label="New agent group"
          onClick={() => setNewGroupFor('')}
          className="flex w-9 shrink-0 items-center justify-center rounded border border-border text-fg-muted hover:bg-bg-muted hover:text-fg"
        >
          <FolderPlus size={14} />
        </button>
      </div>
      {newGroupFor !== null && (
        <div className="flex items-center gap-2 border-b border-border/60 px-3 pb-2">
          <InlineName
            initial=""
            label="New group name"
            testId="new-group-input"
            onDone={(name) => {
              const threadId = newGroupFor;
              setNewGroupFor(null);
              if (name) {
                createGroup(name, threadId ? [threadId] : []).catch((error: unknown) =>
                  showToast((error as Error).message),
                );
              }
            }}
          />
        </div>
      )}
      {threads.length === 0 && groups.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-fg-subtle">
          <Bot size={24} className="opacity-50" />
          No threads yet. Start one with Claude Code, Codex, Kimi Code, Grok Build, OpenCode or a custom agent.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sections.map((section) => (
            <section key={section.id} aria-label={section.title} data-testid={`thread-section-${section.id}`}>
              {section.group ? (
                <GroupHeader group={section.group} threads={section.threads} onNewThread={startDefault} />
              ) : (
                showHeadings && (
                  <h3 className="flex h-7 items-center gap-1 border-b border-border/60 px-3 text-[10px] font-semibold tracking-wide text-fg-subtle uppercase">
                    {section.id === 'pinned' && <Pin size={10} />}
                    {section.title}
                  </h3>
                )
              )}
              {!section.group?.collapsed && (
                <ul>
                  {section.threads.map((thread) => (
                    <ThreadRow
                      key={thread.id}
                      thread={thread}
                      agent={byId.get(thread.agentId)}
                      active={thread.id === activeThreadId}
                      groups={groups}
                      onCreateGroup={(threadId) => setNewGroupFor(threadId)}
                    />
                  ))}
                  {section.group && section.threads.length === 0 && (
                    <li className="px-3 py-2 text-[11px] text-fg-subtle">
                      Empty. Right-click a thread to move it here, or press +.
                    </li>
                  )}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
