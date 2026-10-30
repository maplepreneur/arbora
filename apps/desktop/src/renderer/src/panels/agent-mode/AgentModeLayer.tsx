import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import clsx from 'clsx';
import { Bot, Camera, Code2, Crosshair, FileCode2, LoaderCircle, MessagesSquare, Send } from 'lucide-react';
import {
  clipRect,
  fitViewport,
  formatSource,
  pageRectToWindow,
  placePopover,
  sourceTier,
  targetComponent,
  type AgentModeInclude,
  type AgentModeSelection,
  type AgentModeTarget,
  type Rect,
  type ResolvedComponent,
  type ViewportPresetId,
} from '@arbora/shared';
import { useAgents } from '../../agent-store';
import { Picker } from '../../components/Picker';
import { showAgentThread } from '../../commands';
import { dispatchMode, useApp } from '../../store';

const POPOVER_WIDTH = 380;
const POPOVER_HEIGHT_ESTIMATE = 300;
const MARGIN = 8;

function componentLabel(component: ResolvedComponent): string {
  if (component.minified) return 'anonymous';
  return component.server ? `${component.name} (server)` : component.name;
}

/** Tracks the element's size; the layer fills the browser viewport area. */
function useSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = (): void => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function parseTarget(key: string): AgentModeTarget | null {
  const [type, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  if (!id) return null;
  if (type === 'thread') return { type: 'thread', threadId: id };
  if (type === 'new') return { type: 'new', agentId: id };
  return null;
}

/** Last thread agent mode used, else the active thread, else a new thread with the project's default agent. */
function useDefaultTarget(): string | null {
  const defaultAgent = useApp((s) => s.project?.settings.defaultAgent);
  return useAgents((s) => {
    for (const id of [s.lastAgentModeThreadId, s.activeThreadId]) {
      if (id && s.threads.some((t) => t.id === id)) return `thread:${id}`;
    }
    const available = new Set(s.availability.filter((a) => a.available).map((a) => a.id));
    const agent =
      s.agents.find((a) => a.id === defaultAgent) ?? s.agents.find((a) => available.has(a.id)) ?? s.agents[0];
    return agent ? `new:${agent.id}` : null;
  });
}

function TargetPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const agents = useAgents((s) => s.agents);
  const threads = useAgents((s) => s.threads);
  const availability = useAgents((s) => s.availability);
  const options = useMemo(() => {
    const agentName = (id: string): string => agents.find((a) => a.id === id)?.name ?? id;
    return [
      ...threads.map((thread) => ({
        value: `thread:${thread.id}`,
        name: thread.title,
        description: agentName(thread.agentId),
        group: 'Threads',
      })),
      ...agents.map((agent) => ({
        value: `new:${agent.id}`,
        name: agent.name,
        description: availability.find((a) => a.id === agent.id)?.available === false ? 'Not found on PATH' : null,
        group: 'New thread',
      })),
    ];
  }, [agents, threads, availability]);
  return (
    <Picker
      label="Send to"
      icon={value.startsWith('thread:') ? MessagesSquare : Bot}
      testId="agent-mode-target"
      menuWidth={300}
      className="flex-1"
      value={value}
      options={options}
      onChange={onChange}
    />
  );
}

function Toggle({
  on,
  onClick,
  icon: Icon,
  label,
  testId,
  title,
}: {
  on: boolean;
  onClick: () => void;
  icon: typeof Camera;
  label: string;
  testId: string;
  title?: string | undefined;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid={testId}
      title={title}
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]',
        on ? 'border-accent bg-accent-soft text-fg' : 'border-border text-fg-subtle line-through',
      )}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

interface PopoverProps {
  readonly selection: AgentModeSelection;
  readonly targetIndex: number;
  readonly onTargetIndex: (index: number) => void;
}

function AgentModePopover({ selection, targetIndex, onTargetIndex }: PopoverProps) {
  const [text, setText] = useState('');
  const [include, setInclude] = useState<AgentModeInclude>({ screenshot: true, sources: true, context: true });
  const defaultTarget = useDefaultTarget();
  const [chosenTarget, setChosenTarget] = useState<string | null>(null);
  const target = chosenTarget ?? defaultTarget;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const component = targetComponent(selection, targetIndex);
  const tier = sourceTier(component);
  const source = component?.renderedIn ?? component?.definedIn ?? null;
  const sourcesLabel =
    tier === 3
      ? `${selection.candidates.length} candidate file${selection.candidates.length === 1 ? '' : 's'}`
      : 'Source files';

  const submit = async (): Promise<void> => {
    const parsed = target ? parseTarget(target) : null;
    if (!text.trim() || busy) return;
    if (!parsed) {
      setError('Choose an agent');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { threadId } = await window.arbora.invoke('agentMode.submit', {
        selectionId: selection.id,
        targetIndex,
        text: text.trim(),
        include,
        target: parsed,
      });
      useAgents.setState({ lastAgentModeThreadId: threadId });
      dispatchMode({ type: 'submitted' });
      await showAgentThread(threadId);
    } catch (caught) {
      setError((caught as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="flex flex-col gap-2 p-2.5">
      {selection.components.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-0.5 text-[11.5px]"
          data-testid="agent-mode-chain"
          data-chain={selection.components.map(componentLabel).join(' ← ')}
        >
          {selection.components.map((c, index) => (
            <span key={`${c.name}-${String(index)}`} className="flex items-center gap-0.5">
              {index > 0 && <span className="px-0.5 text-fg-subtle">←</span>}
              <button
                type="button"
                data-testid="agent-mode-crumb"
                aria-pressed={index === targetIndex}
                onClick={() => onTargetIndex(index)}
                className={clsx(
                  'rounded px-1.5 py-0.5 font-medium',
                  index === targetIndex ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-muted',
                )}
              >
                {componentLabel(c)}
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="font-mono text-[11.5px] text-fg-muted" data-testid="agent-mode-chain" data-chain="">
          &lt;{selection.element.tag}&gt; (no component information)
        </div>
      )}
      <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <span
          data-testid="agent-mode-tier"
          data-tier={tier}
          title={
            tier === 1
              ? 'Exact file and line from the framework'
              : tier === 2
                ? 'File known, line not known'
                : 'No source location; the agent gets search candidates'
          }
          className="rounded bg-bg-muted px-1 font-medium"
        >
          tier {tier}
        </span>
        <span className="truncate font-mono" data-testid="agent-mode-source" title={source?.path}>
          {source ? formatSource(source) : `${selection.framework.id} · ${selection.element.tag}`}
        </span>
      </div>
      <textarea
        ref={inputRef}
        data-testid="agent-mode-input"
        rows={3}
        value={text}
        disabled={busy}
        placeholder="What should the agent change? (Enter to send, Shift+Enter for a new line)"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        className="w-full resize-none rounded border border-border bg-bg px-2 py-1.5 text-[12.5px] outline-none select-text focus:border-accent"
      />
      <div className="flex flex-wrap gap-1">
        <Toggle
          testId="agent-mode-include-screenshot"
          icon={Camera}
          label="Screenshot"
          on={include.screenshot}
          onClick={() => setInclude((i) => ({ ...i, screenshot: !i.screenshot }))}
        />
        <Toggle
          testId="agent-mode-include-sources"
          icon={FileCode2}
          label={sourcesLabel}
          title={tier === 3 ? selection.candidates.map((c) => c.relative).join('\n') : undefined}
          on={include.sources}
          onClick={() => setInclude((i) => ({ ...i, sources: !i.sources }))}
        />
        <Toggle
          testId="agent-mode-include-context"
          icon={Code2}
          label={
            selection.consoleErrors.length > 0
              ? `HTML, styles, ${String(selection.consoleErrors.length)} console error${selection.consoleErrors.length === 1 ? '' : 's'}`
              : 'HTML and styles'
          }
          on={include.context}
          onClick={() => setInclude((i) => ({ ...i, context: !i.context }))}
        />
      </div>
      {error && (
        <div className="text-[11px] text-danger" data-testid="agent-mode-error">
          {error}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[11px] text-fg-subtle">Send to</span>
        <TargetPicker value={target ?? ''} onChange={setChosenTarget} />
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          data-testid="agent-mode-repick"
          title="Pick another element"
          onClick={() => dispatchMode({ type: 'repick' })}
          className="flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] text-fg-muted hover:bg-bg-muted"
        >
          <Crosshair size={12} />
          Pick again
        </button>
        <button
          type="button"
          data-testid="agent-mode-send"
          disabled={busy || !text.trim()}
          onClick={() => void submit()}
          className="flex h-7 items-center gap-1 rounded bg-accent px-2.5 text-[11px] font-medium text-accent-fg disabled:opacity-40"
        >
          {busy ? <LoaderCircle size={12} className="animate-spin" /> : <Send size={12} />}
          Send
        </button>
      </div>
    </div>
  );
}

/**
 * Agent mode's prompting step, drawn in the browser viewport area. The native view would cover
 * any DOM there, so it is hidden and this layer shows the captured frame in its place, the
 * target outline and the popover anchored to it.
 */
export function AgentModeLayer({ selection, preset }: { selection: AgentModeSelection; preset: ViewportPresetId }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const size = useSize(layerRef);
  const [targetIndex, setTargetIndex] = useState(selection.targetIndex);
  const [popoverHeight, setPopoverHeight] = useState(POPOVER_HEIGHT_ESTIMATE);

  const view: Rect = useMemo(
    () => fitViewport({ x: 0, y: 0, width: size.width, height: size.height }, preset).rect,
    [size.width, size.height, preset],
  );
  const component = targetComponent(selection, targetIndex);
  const outline = clipRect(
    pageRectToWindow(component?.rect ?? selection.element.rect, { viewport: selection.viewport, view }),
    view,
  );
  const width = Math.min(POPOVER_WIDTH, Math.max(0, size.width - 2 * MARGIN));
  const area = { x: MARGIN, y: MARGIN, width: size.width - 2 * MARGIN, height: size.height - 2 * MARGIN };
  const placement = placePopover(outline, { width, height: popoverHeight }, area);

  useLayoutEffect(() => {
    const element = popoverRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setPopoverHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={layerRef} className="absolute inset-0 overflow-hidden" data-testid="agent-mode-layer" data-picker-bounds>
      <img
        data-testid="agent-mode-frame"
        src={selection.screenshot.dataUrl}
        alt="The page when the element was selected"
        draggable={false}
        className="absolute select-none"
        style={{ left: view.x, top: view.y, width: view.width, height: view.height }}
      />
      <div
        data-testid="agent-mode-outline"
        className="pointer-events-none absolute rounded-[2px] outline-2 outline-[#ff3b6b]"
        style={{ left: outline.x, top: outline.y, width: outline.width, height: outline.height }}
      />
      <div
        ref={popoverRef}
        data-testid="agent-mode-popover"
        data-side={placement.side}
        className="absolute rounded-md border border-border bg-bg-elevated shadow-xl"
        style={{ left: placement.x, top: placement.y, width }}
      >
        <AgentModePopover selection={selection} targetIndex={targetIndex} onTargetIndex={setTargetIndex} />
      </div>
    </div>
  );
}
