import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleX,
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  Paperclip,
  Pencil,
  Play,
  Search,
  ShieldQuestion,
  SquareTerminal,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type {
  ContentBlock,
  PermissionEvent,
  PlanEntry,
  ThreadEvent,
  ToolCallEvent,
  ToolCallStatus,
  ToolKind,
} from '@arbora/shared';
import { Markdown } from './Markdown';
import { UnifiedDiff } from './UnifiedDiff';

const TOOL_ICONS: Readonly<Record<ToolKind, LucideIcon>> = {
  read: FileText,
  edit: Pencil,
  delete: Trash2,
  move: FileText,
  search: Search,
  execute: SquareTerminal,
  think: Brain,
  fetch: Search,
  switch_mode: Play,
  other: Circle,
};

function ToolKindIcon({ kind }: { kind: ToolKind }) {
  const Icon = TOOL_ICONS[kind];
  return <Icon size={13} className="shrink-0 text-fg-muted" />;
}

function StatusIcon({ status }: { status: ToolCallStatus }) {
  switch (status) {
    case 'pending':
      return <CircleDashed size={13} className="text-fg-subtle" data-status="pending" />;
    case 'in_progress':
      return <Loader2 size={13} className="animate-spin text-accent" data-status="in_progress" />;
    case 'completed':
      return <CircleCheck size={13} className="text-emerald-600 dark:text-emerald-400" data-status="completed" />;
    case 'failed':
      return <CircleX size={13} className="text-danger" data-status="failed" />;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

function relativePath(path: string, projectPath: string): string {
  const normalized = path.replace(/\\/g, '/');
  const root = projectPath.replace(/\\/g, '/').replace(/\/$/, '');
  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : path;
}

/** Filesystem path of a `file://` URI (`pathToFileURL` percent-encodes spaces and `~`). */
function fileUriPath(uri: string): string {
  const path = uri.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:\/)/, '$1');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function Blocks({ blocks, projectPath }: { blocks: readonly ContentBlock[]; projectPath: string }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'text':
            return <Markdown key={index} text={block.text} />;
          case 'image':
            return (
              <img
                key={index}
                src={`data:${block.mimeType};base64,${block.data}`}
                alt="attachment"
                className="my-1 max-h-64 max-w-full rounded border border-border"
              />
            );
          case 'audio':
            return (
              <audio key={index} controls src={`data:${block.mimeType};base64,${block.data}`} className="my-1 w-full" />
            );
          case 'resource_link':
            return (
              <span
                key={index}
                className="my-0.5 inline-flex max-w-full items-center gap-1 rounded bg-bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                title={block.uri}
              >
                {block.mimeType?.startsWith('image/') ? <ImageIcon size={11} /> : <Paperclip size={11} />}
                <span className="truncate">{relativePath(fileUriPath(block.uri), projectPath) || block.name}</span>
              </span>
            );
          case 'resource':
            return (
              <pre
                key={index}
                className="my-1 max-h-48 overflow-auto rounded bg-bg-muted p-2 font-mono text-[11px] select-text"
              >
                {'text' in block.resource ? block.resource.text : `[binary ${block.resource.uri}]`}
              </pre>
            );
          default: {
            const unreachable: never = block;
            return unreachable;
          }
        }
      })}
    </>
  );
}

function Thought({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-fg-muted" data-testid="agent-thought">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Brain size={12} />
        Thinking{open ? '' : `… ${text.replace(/\s+/g, ' ').slice(0, 80)}`}
      </button>
      {open && (
        <div className="mt-1 border-l-2 border-border pl-2 text-[12px] whitespace-pre-wrap select-text">{text}</div>
      )}
    </div>
  );
}

function ToolCard({ event, projectPath }: { event: ToolCallEvent; projectPath: string }) {
  const [open, setOpen] = useState(true);
  const diffs = event.content.filter((c) => c.type === 'diff');
  const texts = event.content.filter((c) => c.type === 'content');
  const terminals = event.content.filter((c) => c.type === 'terminal');
  const hasBody = diffs.length > 0 || texts.length > 0 || terminals.length > 0 || event.rawInput !== undefined;
  return (
    <div
      className="rounded border border-border bg-bg"
      data-testid="tool-call"
      data-tool-kind={event.toolKind}
      data-tool-status={event.status}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px]"
        aria-expanded={open}
      >
        <StatusIcon status={event.status} />
        <ToolKindIcon kind={event.toolKind} />
        <span className="min-w-0 flex-1 truncate" title={event.title}>
          {event.title}
        </span>
        {event.locations.length > 0 && (
          <span className="max-w-[45%] truncate font-mono text-[11px] text-fg-subtle" title={event.locations[0]?.path}>
            {relativePath(event.locations[0]?.path ?? '', projectPath)}
            {event.locations[0]?.line != null ? `:${event.locations[0].line}` : ''}
          </span>
        )}
        {hasBody &&
          (open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />)}
      </button>
      {open && hasBody && (
        <div className="flex flex-col gap-1.5 border-t border-border px-2 py-1.5">
          {diffs.map((diff, index) => (
            <UnifiedDiff
              key={index}
              oldText={diff.oldText}
              newText={diff.newText}
              path={relativePath(diff.path, projectPath)}
            />
          ))}
          {texts.map((item, index) => (
            <div key={index} className="text-[12px]">
              <Blocks blocks={[item.content]} projectPath={projectPath} />
            </div>
          ))}
          {terminals.map((item) => (
            <div key={item.terminalId} className="flex items-center gap-1 text-[11px] text-fg-subtle">
              <SquareTerminal size={12} /> Running in the Terminal panel (agent tab)
            </div>
          ))}
          {diffs.length === 0 && texts.length === 0 && event.rawInput !== undefined && (
            <pre className="max-h-40 overflow-auto rounded bg-bg-muted p-1.5 font-mono text-[11px] select-text">
              {typeof event.rawInput === 'string' ? event.rawInput : JSON.stringify(event.rawInput, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function PermissionCard({
  event,
  projectPath,
  onRespond,
}: {
  event: PermissionEvent;
  projectPath: string;
  onRespond: (optionId: string) => void;
}) {
  const pending = event.outcome === null;
  const chosen = event.outcome !== null && event.outcome !== 'cancelled' ? event.outcome : null;
  return (
    <div
      className={clsx(
        'rounded border px-2 py-1.5 text-[12px]',
        pending ? 'border-amber-500/60 bg-amber-500/5' : 'border-border bg-bg',
      )}
      data-testid="permission-card"
      data-pending={pending}
    >
      <div className="flex items-center gap-2">
        <ShieldQuestion size={13} className={pending ? 'text-amber-500' : 'text-fg-subtle'} />
        <ToolKindIcon kind={event.toolKind} />
        <span className="min-w-0 flex-1 truncate font-medium" title={event.title}>
          {event.title}
        </span>
        <span className="rounded bg-bg-muted px-1 text-[10px] uppercase text-fg-subtle">{event.toolKind}</span>
      </div>
      {event.locations.length > 0 && (
        <ul className="mt-1 font-mono text-[11px] text-fg-muted">
          {event.locations.map((location, index) => (
            <li key={index} className="truncate" title={location.path}>
              {relativePath(location.path, projectPath)}
              {location.line != null ? `:${location.line}` : ''}
            </li>
          ))}
        </ul>
      )}
      {event.rawInput !== undefined && (
        <details className="mt-1 text-[11px]">
          <summary className="cursor-pointer text-fg-subtle">Input</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-bg-muted p-1.5 font-mono select-text">
            {typeof event.rawInput === 'string' ? event.rawInput : JSON.stringify(event.rawInput, null, 2)}
          </pre>
        </details>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {pending ? (
          event.options.map((option) => (
            <button
              key={option.optionId}
              type="button"
              data-testid={`permission-${option.kind}`}
              onClick={() => onRespond(option.optionId)}
              className={clsx(
                'h-6 rounded px-2 text-[11px]',
                option.kind.startsWith('allow')
                  ? 'bg-accent text-accent-fg hover:opacity-90'
                  : 'border border-border text-fg hover:bg-bg-muted',
              )}
            >
              {option.name}
            </button>
          ))
        ) : (
          <span className="flex items-center gap-1 text-[11px] text-fg-subtle" data-testid="permission-outcome">
            {event.outcome === 'cancelled' ? (
              <>
                <CircleX size={12} /> Cancelled
              </>
            ) : (
              <>
                <Check size={12} />
                {event.options.find((o) => o.optionId === chosen?.optionId)?.name ?? chosen?.optionId}
                {chosen?.auto ? ' (automatic)' : ''}
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function PlanCard({ entries }: { entries: readonly PlanEntry[] }) {
  const done = entries.filter((e) => e.status === 'completed').length;
  return (
    <div className="rounded border border-border bg-bg px-2 py-1.5 text-[12px]" data-testid="plan">
      <div className="mb-1 flex items-center justify-between text-[11px] text-fg-subtle">
        <span>Plan</span>
        <span>
          {done}/{entries.length}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {entries.map((entry, index) => (
          <li key={index} className="flex items-start gap-1.5" data-plan-status={entry.status}>
            {entry.status === 'completed' ? (
              <CircleCheck size={13} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : entry.status === 'in_progress' ? (
              <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin text-accent" />
            ) : (
              <Circle size={13} className="mt-0.5 shrink-0 text-fg-subtle" />
            )}
            <span className={clsx(entry.status === 'completed' && 'text-fg-subtle line-through')}>{entry.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EventView({
  event,
  projectPath,
  onRespond,
}: {
  event: ThreadEvent;
  projectPath: string;
  onRespond: (requestId: string, optionId: string) => void;
}) {
  switch (event.kind) {
    case 'user_message':
      return (
        <div className="ml-6 rounded-lg bg-accent-soft px-3 py-2 text-[12.5px]" data-testid="user-message">
          <Blocks blocks={event.blocks} projectPath={projectPath} />
        </div>
      );
    case 'agent_message':
      return (
        <div className="px-1 text-[12.5px]" data-testid="agent-message">
          <Blocks blocks={event.blocks} projectPath={projectPath} />
        </div>
      );
    case 'agent_thought':
      return <Thought text={event.text} />;
    case 'tool_call':
      return <ToolCard event={event} projectPath={projectPath} />;
    case 'permission':
      return (
        <PermissionCard
          event={event}
          projectPath={projectPath}
          onRespond={(optionId) => onRespond(event.requestId, optionId)}
        />
      );
    case 'plan':
      return <PlanCard entries={event.entries} />;
    case 'turn_end':
      return event.stopReason === 'end_turn' ? null : (
        <div className="text-center text-[10px] text-fg-subtle uppercase" data-testid="turn-end">
          {event.stopReason.replace(/_/g, ' ')}
        </div>
      );
    case 'notice':
      return (
        <div
          className={clsx(
            'flex items-start gap-2 rounded border px-2 py-1.5 text-[12px]',
            event.severity === 'error'
              ? 'border-danger/50 text-danger'
              : event.severity === 'warning'
                ? 'border-amber-500/50 text-amber-700 dark:text-amber-300'
                : 'border-border text-fg-muted',
          )}
          data-testid="notice"
        >
          {event.severity === 'info' ? (
            <Info size={13} className="mt-0.5 shrink-0" />
          ) : (
            <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          )}
          <div>
            <div className="font-medium">{event.title}</div>
            {event.description && <div className="text-[11px] opacity-80">{event.description}</div>}
          </div>
        </div>
      );
    case 'error':
      return (
        <div
          className="flex items-start gap-2 rounded border border-danger/50 px-2 py-1.5 text-[12px] text-danger"
          data-testid="thread-error"
        >
          <CircleX size={13} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap select-text">{event.message}</span>
        </div>
      );
    case 'browser_preview':
      return (
        <figure className="rounded border border-border bg-bg px-2 py-1.5 text-[11px]" data-testid="browser-preview">
          <figcaption className="mb-1 flex items-center gap-1.5 text-fg-subtle">
            <ImageIcon size={12} className="shrink-0" />
            <span className="truncate" title={event.path ?? undefined}>
              {event.title}
            </span>
          </figcaption>
          <img
            src={`data:${event.image.mimeType};base64,${event.image.data}`}
            alt={event.title}
            width={event.image.width}
            height={event.image.height}
            className="h-auto max-h-48 max-w-full rounded border border-border"
          />
        </figure>
      );
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

export function Transcript({
  events,
  projectPath,
  busy,
  onRespond,
}: {
  events: readonly ThreadEvent[];
  projectPath: string;
  busy: boolean;
  onRespond: (requestId: string, optionId: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const element = scroller.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [events, busy]);

  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
      data-testid="transcript"
      onScroll={(event) => {
        const el = event.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {events.length === 0 ? (
        <div className="flex h-full items-center justify-center text-center text-xs text-fg-subtle">
          Ask the agent to change something in this project.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((event) => (
            <EventView key={event.id} event={event} projectPath={projectPath} onRespond={onRespond} />
          ))}
          {busy && (
            <div className="flex items-center gap-1.5 px-1 text-[11px] text-fg-subtle" data-testid="agent-busy">
              <Loader2 size={12} className="animate-spin" /> Working…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
