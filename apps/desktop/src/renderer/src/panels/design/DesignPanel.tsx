import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowRight,
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  LoaderCircle,
  MessagesSquare,
  Pencil,
  Pipette,
  Plus,
  Redo2,
  Send,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import {
  activeOps,
  describeOp,
  rgbToHex,
  type AgentModeTarget,
  type AgentModel,
  type DesignCommand,
  type DesignOp,
  type DesignSelection,
} from '@arbora/shared';
import { isListed, useAgents } from '../../agent-store';
import { toggleDefaultModel } from '../../agent-defaults';
import { useAutoVerify, usePickableAgents } from '../../agent-pickers';
import { Picker } from '../../components/Picker';
import { discardDesign, resendDesignSession, saveDesignTo } from '../../commands';
import type { DesignPending } from '../../mode';
import { dispatchMode, openSettings, setDesignTarget, showToast, useApp } from '../../store';

function ipcError(error: unknown): string {
  return (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

async function send(command: DesignCommand): Promise<void> {
  try {
    await window.arbora.invoke('design.command', command);
  } catch (error) {
    showToast(ipcError(error));
  }
}

function setStyle(property: string, value: string): void {
  void send({ type: 'style', property, value });
}

// --- Values ---------------------------------------------------------------------------------------

const NUMBER = /^(-?\d*\.?\d+)([a-z%]*)$/i;

function splitUnit(value: string): { n: number; unit: string } | null {
  const match = NUMBER.exec(value.trim());
  if (!match?.[1]) return null;
  return { n: Number(match[1]), unit: match[2] || 'px' };
}

/** `24px` shows as `24`; anything else (`auto`, `1.5rem`) as typed. */
function shortValue(value: string): string {
  const parts = splitUnit(value);
  return parts && parts.unit === 'px' ? String(Math.round(parts.n * 100) / 100) : value;
}

/** A bare number means pixels, as in Webflow. */
function withUnit(value: string): string {
  const raw = value.trim();
  return /^-?\d*\.?\d+$/.test(raw) ? `${raw}px` : raw;
}

/**
 * Drag a value sideways to change it. A press without movement focuses the input instead.
 * Commits once on release so a drag records one change, not one per pixel.
 */
function useScrub(value: string, onDraft: (draft: string) => void, onCommit: (value: string) => void) {
  const start = useRef<{ x: number; n: number; unit: string; moved: boolean; latest: string } | null>(null);
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || document.activeElement === event.currentTarget) return;
    const parts = splitUnit(value) ?? { n: 0, unit: 'px' };
    start.current = { x: event.clientX, ...parts, moved: false, latest: value };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const scrub = start.current;
    if (!scrub) return;
    const dx = event.clientX - scrub.x;
    if (!scrub.moved && Math.abs(dx) < 3) return;
    scrub.moved = true;
    const step = event.shiftKey ? 10 : 1;
    const next = Math.max(scrub.unit === 'px' ? -9999 : -999, scrub.n + Math.round(dx / 2) * step);
    scrub.latest = `${next}${scrub.unit}`;
    onDraft(scrub.latest);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    const scrub = start.current;
    start.current = null;
    if (!scrub) return;
    if (scrub.moved) onCommit(scrub.latest);
    else if (event.currentTarget instanceof HTMLInputElement) {
      event.currentTarget.focus();
      event.currentTarget.select();
    }
  };
  return { onPointerDown, onPointerMove, onPointerUp };
}

/** Local edit buffer that resets whenever the page reports a new computed value. */
function useDraft(value: string): [string, (next: string) => void] {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  return [draft, setDraft];
}

// --- Controls --------------------------------------------------------------------------------------

function Section({ title, children, open: initial = true }: { title: string; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-8 w-full items-center gap-1 px-3 text-[11px] font-semibold tracking-wide text-fg-muted uppercase hover:text-fg"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {open && <div className="flex flex-col gap-2 px-3 pb-3">{children}</div>}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_1fr] items-center gap-2">
      <span className="truncate text-[11px] text-fg-subtle">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

interface Choice {
  readonly value: string;
  readonly label: string;
  readonly icon?: LucideIcon;
}

function Segmented({
  property,
  value,
  choices,
  testId,
}: {
  property: string;
  value: string;
  choices: readonly Choice[];
  testId?: string;
}) {
  return (
    <div role="radiogroup" data-testid={testId} className="flex rounded-md border border-border bg-bg-muted p-0.5">
      {choices.map((choice) => {
        const active = choice.value === value;
        const Icon = choice.icon;
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={choice.label}
            data-value={choice.value}
            onClick={() => {
              if (!active) setStyle(property, choice.value);
            }}
            className={clsx(
              'flex h-6 min-w-0 flex-1 items-center justify-center rounded px-1 text-[11px]',
              active ? 'bg-bg text-fg shadow-sm ring-1 ring-accent/40' : 'text-fg-subtle hover:text-fg',
            )}
          >
            {Icon ? <Icon size={12} /> : <span className="truncate">{choice.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

function ValueInput({
  property,
  value,
  testId,
  className,
  placeholder,
}: {
  property: string;
  value: string;
  testId?: string;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useDraft(shortValue(value));
  const commit = (next: string): void => {
    const authored = withUnit(next);
    if (authored && authored !== value && next !== shortValue(value)) setStyle(property, authored);
  };
  const scrub = useScrub(
    value,
    (next) => setDraft(shortValue(next)),
    (next) => setStyle(property, next),
  );
  const numeric = splitUnit(value) !== null;
  return (
    <input
      data-testid={testId}
      aria-label={property}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          const parts = splitUnit(value);
          if (!parts) return;
          event.preventDefault();
          const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
          setStyle(property, `${parts.n + step}${parts.unit}`);
        }
      }}
      {...(numeric ? scrub : {})}
      className={clsx(
        'h-6 min-w-0 rounded border border-border bg-bg px-1.5 font-mono text-[11px] text-fg focus:border-accent focus:outline-none',
        numeric && 'cursor-ew-resize focus:cursor-text',
        className ?? 'w-full',
      )}
    />
  );
}

function ColorInput({ property, value, testId }: { property: string; value: string; testId?: string }) {
  const [draft, setDraft] = useDraft(value);
  const hex = rgbToHex(value) ?? (/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000');
  const commit = (): void => {
    if (draft.trim() && draft !== value) setStyle(property, draft.trim());
  };
  const eyedropper = 'EyeDropper' in window;
  return (
    <div className="flex items-center gap-1">
      <label
        className="relative h-6 w-6 shrink-0 overflow-hidden rounded border border-border"
        style={{ background: value }}
        title="Pick a colour"
      >
        <input
          type="color"
          aria-label={`${property} swatch`}
          value={hex}
          onChange={(event) => setStyle(property, event.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <input
        data-testid={testId}
        aria-label={property}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className="h-6 min-w-0 flex-1 rounded border border-border bg-bg px-1.5 font-mono text-[11px] text-fg focus:border-accent focus:outline-none"
      />
      {eyedropper && (
        <button
          type="button"
          aria-label="Pick a colour from the screen"
          title="Pick a colour from the screen"
          onClick={() => {
            const Dropper = (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } })
              .EyeDropper;
            void new Dropper()
              .open()
              .then((result) => setStyle(property, result.sRGBHex))
              .catch(() => undefined);
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border text-fg-subtle hover:text-fg"
        >
          <Pipette size={11} />
        </button>
      )}
    </div>
  );
}

/** Webflow-style spacing box: margin ring outside, padding ring inside, draggable values. */
function BoxModel({ styles }: { styles: Readonly<Record<string, string>> }) {
  const cell = (property: string): ReactNode => (
    <ValueInput
      property={property}
      value={styles[property] ?? ''}
      testId={`design-${property}`}
      className="w-10 border-transparent bg-transparent text-center hover:border-border"
    />
  );
  return (
    <div className="rounded-md border border-dashed border-accent/50 bg-accent-soft/40 p-1 text-[10px]">
      <div className="flex items-center justify-between px-1 text-fg-subtle">
        <span className="font-semibold tracking-wide uppercase">Margin</span>
        {cell('margin-top')}
        <span className="w-12" />
      </div>
      <div className="flex items-center gap-1">
        {cell('margin-left')}
        <div className="flex-1 rounded border border-accent/60 bg-bg p-1">
          <div className="flex items-center justify-between px-1 text-fg-subtle">
            <span className="font-semibold tracking-wide uppercase">Padding</span>
            {cell('padding-top')}
            <span className="w-12" />
          </div>
          <div className="flex items-center gap-1">
            {cell('padding-left')}
            <div className="h-5 flex-1 rounded-sm bg-accent-soft" />
            {cell('padding-right')}
          </div>
          <div className="flex justify-center">{cell('padding-bottom')}</div>
        </div>
        {cell('margin-right')}
      </div>
      <div className="flex justify-center">{cell('margin-bottom')}</div>
    </div>
  );
}

// --- Style panel -----------------------------------------------------------------------------------

const DISPLAY: readonly Choice[] = [
  { value: 'block', label: 'Block' },
  { value: 'flex', label: 'Flex' },
  { value: 'grid', label: 'Grid' },
  { value: 'inline-block', label: 'Inline' },
  { value: 'none', label: 'None' },
];
const DIRECTION: readonly Choice[] = [
  { value: 'row', label: 'Horizontal', icon: ArrowRight },
  { value: 'column', label: 'Vertical', icon: ArrowDown },
];
const ALIGN: readonly Choice[] = [
  { value: 'flex-start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'flex-end', label: 'End' },
  { value: 'stretch', label: 'Stretch' },
];
const JUSTIFY: readonly Choice[] = [
  { value: 'flex-start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'flex-end', label: 'End' },
  { value: 'space-between', label: 'Between' },
];
const WRAP: readonly Choice[] = [
  { value: 'nowrap', label: "Don't wrap" },
  { value: 'wrap', label: 'Wrap' },
];
const POSITION: readonly Choice[] = [
  { value: 'static', label: 'Static' },
  { value: 'relative', label: 'Relative' },
  { value: 'absolute', label: 'Absolute' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'sticky', label: 'Sticky' },
];
const TEXT_ALIGN: readonly Choice[] = [
  { value: 'left', label: 'Left', icon: AlignLeft },
  { value: 'center', label: 'Center', icon: AlignCenter },
  { value: 'right', label: 'Right', icon: AlignRight },
  { value: 'justify', label: 'Justify', icon: AlignJustify },
];
const WEIGHT: readonly Choice[] = [
  { value: '400', label: '400' },
  { value: '500', label: '500' },
  { value: '600', label: '600' },
  { value: '700', label: '700' },
];
const BORDER_STYLE: readonly Choice[] = [
  { value: 'none', label: 'None' },
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
];
const VISIBILITY: readonly Choice[] = [
  { value: 'visible', label: 'Visible' },
  { value: 'hidden', label: 'Hidden' },
];

function TextContent({ value }: { value: string }) {
  const [draft, setDraft] = useDraft(value);
  return (
    <textarea
      data-testid="design-text"
      aria-label="Text"
      value={draft}
      rows={2}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) void send({ type: 'text', value: draft });
      }}
      className="w-full resize-none rounded border border-border bg-bg px-1.5 py-1 text-xs text-fg focus:border-accent focus:outline-none"
    />
  );
}

function StylePanel({ selection, structureWarning }: { selection: DesignSelection; structureWarning: boolean }) {
  const s = selection.styles;
  const v = (property: string): string => s[property] ?? '';
  const flex = v('display').includes('flex');
  const grid = v('display').includes('grid');
  return (
    <div data-testid="design-selection" data-selector={selection.selector}>
      {selection.text && (
        <Section title="Content">
          <TextContent value={selection.text} />
        </Section>
      )}
      <Section title="Layout">
        <Row label="Display">
          <Segmented property="display" value={v('display')} choices={DISPLAY} testId="design-display" />
        </Row>
        {flex && (
          <>
            <Row label="Direction">
              <Segmented property="flex-direction" value={v('flex-direction')} choices={DIRECTION} />
            </Row>
            <Row label="Align">
              <Segmented property="align-items" value={v('align-items')} choices={ALIGN} />
            </Row>
            <Row label="Justify">
              <Segmented property="justify-content" value={v('justify-content')} choices={JUSTIFY} />
            </Row>
            <Row label="Wrap">
              <Segmented property="flex-wrap" value={v('flex-wrap')} choices={WRAP} />
            </Row>
          </>
        )}
        {grid && (
          <>
            <Row label="Columns">
              <ValueInput property="grid-template-columns" value={v('grid-template-columns')} />
            </Row>
            <Row label="Rows">
              <ValueInput property="grid-template-rows" value={v('grid-template-rows')} />
            </Row>
          </>
        )}
        {(flex || grid) && (
          <Row label="Gap">
            <ValueInput property="gap" value={v('gap')} testId="design-gap" />
          </Row>
        )}
      </Section>
      <Section title="Spacing">
        {!selection.handles && (
          <p className="text-[11px] text-fg-subtle">This element is transformed, so the on-page handles are hidden.</p>
        )}
        <BoxModel styles={s} />
      </Section>
      <Section title="Size">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {(['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height'] as const).map((property) => (
            <label key={property} className="flex flex-col gap-0.5 text-[11px] text-fg-subtle">
              {property.replace('-', ' ')}
              <ValueInput property={property} value={v(property)} />
            </label>
          ))}
        </div>
      </Section>
      <Section title="Position" open={v('position') !== 'static'}>
        <Row label="Position">
          <Segmented property="position" value={v('position')} choices={POSITION} />
        </Row>
        {v('position') !== 'static' && (
          <div className="grid grid-cols-4 gap-1">
            {(['top', 'right', 'bottom', 'left'] as const).map((property) => (
              <label key={property} className="flex flex-col gap-0.5 text-[10px] text-fg-subtle">
                {property}
                <ValueInput property={property} value={v(property)} />
              </label>
            ))}
          </div>
        )}
      </Section>
      <Section title="Typography">
        <Row label="Font">
          <ValueInput property="font-family" value={v('font-family')} />
        </Row>
        <Row label="Weight">
          <Segmented property="font-weight" value={v('font-weight')} choices={WEIGHT} />
        </Row>
        <div className="grid grid-cols-3 gap-1">
          {(
            [
              ['font-size', 'Size'],
              ['line-height', 'Height'],
              ['letter-spacing', 'Spacing'],
            ] as const
          ).map(([property, label]) => (
            <label key={property} className="flex flex-col gap-0.5 text-[10px] text-fg-subtle">
              {label}
              <ValueInput property={property} value={v(property)} testId={`design-${property}`} />
            </label>
          ))}
        </div>
        <Row label="Color">
          <ColorInput property="color" value={v('color')} testId="design-color" />
        </Row>
        <Row label="Align">
          <Segmented property="text-align" value={v('text-align')} choices={TEXT_ALIGN} />
        </Row>
      </Section>
      <Section title="Backgrounds">
        <Row label="Color">
          <ColorInput property="background-color" value={v('background-color')} testId="design-background" />
        </Row>
      </Section>
      <Section title="Borders">
        <Row label="Radius">
          <ValueInput property="border-radius" value={v('border-radius')} testId="design-border-radius" />
        </Row>
        <Row label="Style">
          <Segmented property="border-style" value={v('border-style')} choices={BORDER_STYLE} />
        </Row>
        <Row label="Width">
          <ValueInput property="border-width" value={v('border-width')} />
        </Row>
        <Row label="Color">
          <ColorInput property="border-color" value={v('border-color')} />
        </Row>
      </Section>
      <Section title="Effects" open={false}>
        <Row label="Opacity">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              aria-label="opacity"
              defaultValue={Number(v('opacity') || 1)}
              key={v('opacity')}
              onPointerUp={(event) => setStyle('opacity', event.currentTarget.value)}
              onKeyUp={(event) => setStyle('opacity', event.currentTarget.value)}
              className="min-w-0 flex-1 accent-[var(--accent)]"
            />
            <span className="w-8 text-right font-mono text-[11px]">{v('opacity') || '1'}</span>
          </div>
        </Row>
        <Row label="Shadow">
          <ValueInput property="box-shadow" value={v('box-shadow')} placeholder="none" />
        </Row>
        <Row label="Visibility">
          <Segmented property="visibility" value={v('visibility')} choices={VISIBILITY} />
        </Row>
      </Section>
      <Section title="Structure" open={false}>
        {structureWarning && (
          <p className="text-[11px] text-fg-subtle">
            Moves, inserts and deletes are a preview. A re-render can reset them; the agent makes the real change.
          </p>
        )}
        <div className="flex flex-wrap gap-1">
          {(['div', 'text', 'image', 'button'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              data-testid={`design-insert-${kind}`}
              onClick={() => void send({ type: 'insert', elementKind: kind })}
              className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] capitalize hover:border-accent hover:text-accent"
            >
              <Plus size={11} />
              {kind}
            </button>
          ))}
          <button
            type="button"
            data-testid="design-duplicate"
            onClick={() => void send({ type: 'duplicate' })}
            className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] hover:border-accent hover:text-accent"
          >
            <Copy size={11} />
            Duplicate
          </button>
          <button
            type="button"
            data-testid="design-delete"
            onClick={() => void send({ type: 'delete' })}
            className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-red-600 hover:border-red-500 dark:text-red-400"
          >
            <Trash2 size={11} />
            Delete
          </button>
        </div>
      </Section>
    </div>
  );
}

// --- Changes ---------------------------------------------------------------------------------------

function RowButton({
  icon: Icon,
  label,
  testId,
  pressed,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  testId: string;
  pressed?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      aria-pressed={pressed}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={clsx(
        'flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted',
        danger ? 'hover:text-red-600 dark:hover:text-red-400' : 'hover:text-fg',
        pressed && 'bg-bg-muted text-fg',
      )}
    >
      <Icon size={13} />
    </button>
  );
}

function ChangeRow({ op, index, onEdit }: { op: DesignOp; index: number; onEdit: () => void }) {
  const original = useApp((s) => s.design.showingOriginal);
  const { title, before, after } = describeOp(op);
  const muted = op.muted === true;
  const edit = (): void => {
    if (original) return;
    void send({ type: 'selectOp', id: op.id });
    onEdit();
  };
  return (
    <li
      data-testid="design-change"
      data-op={op.id}
      data-stale={op.stale || undefined}
      data-muted={muted || undefined}
      role="button"
      tabIndex={0}
      title="Select this element and edit it"
      onClick={edit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          edit();
        }
      }}
      onMouseEnter={() => void send({ type: 'highlightOp', id: op.id })}
      onMouseLeave={() => void send({ type: 'highlightOp', id: null })}
      className={clsx(
        'group flex cursor-pointer items-center gap-2 border-b border-border px-3 py-1.5 hover:bg-accent-soft/50 focus:bg-accent-soft/50 focus:outline-none',
        muted && 'opacity-60',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-fg-subtle tabular-nums">{index + 1}</span>
          <span className={clsx('font-medium', muted && 'line-through')}>{title}</span>
          <span className="min-w-0 truncate text-fg-subtle">{op.target.componentChain[0] ?? op.target.selector}</span>
          {muted && <span className="rounded bg-bg-muted px-1 text-[10px] text-fg-subtle">off</span>}
          {op.stale && <span className="rounded bg-bg-muted px-1 text-[10px] text-fg-subtle">not on page</span>}
        </div>
        <div className="flex items-center gap-1 font-mono text-[11px]">
          <span className="min-w-0 truncate text-fg-subtle line-through">{before}</span>
          <span className="text-fg-subtle">→</span>
          <span className={clsx('min-w-0 truncate', muted ? 'text-fg-subtle' : 'text-accent')}>{after}</span>
        </div>
      </div>
      <div
        className={clsx(
          'flex shrink-0 items-center gap-0.5',
          !muted && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
        )}
      >
        <RowButton icon={Pencil} label="Edit this change" testId="design-change-edit" onClick={edit} />
        <RowButton
          icon={muted ? EyeOff : Eye}
          label={muted ? 'Turn this change back on' : 'Preview the page without this change'}
          testId="design-change-toggle"
          pressed={muted}
          onClick={() => void send({ type: 'muteOp', id: op.id, muted: !muted })}
        />
        <RowButton
          icon={Trash2}
          label="Delete this change"
          testId="design-change-delete"
          danger
          onClick={() => void send({ type: 'removeOp', id: op.id })}
        />
      </div>
    </li>
  );
}

function ChangesPanel({ target, onEdit }: { target: AgentModeTarget | null; onEdit: () => void }) {
  const ops = useApp((s) => s.design.ops);
  const cursor = useApp((s) => s.design.cursor);
  const sessions = useApp((s) => s.design.sessions);
  const applied = ops.slice(0, cursor);
  return (
    <div className="flex flex-col" onMouseLeave={() => void send({ type: 'highlightOp', id: null })}>
      {applied.length === 0 ? (
        <p className="px-3 py-4 text-xs text-fg-muted">
          No changes yet. Edits show on the page as you make them; they are listed here before you send them.
        </p>
      ) : (
        <ol className="flex flex-col">
          {applied.map((op, index) => (
            <ChangeRow key={op.id} op={op} index={index} onEdit={onEdit} />
          ))}
        </ol>
      )}
      {sessions.length > 0 && (
        <section className="flex flex-col gap-1 px-3 py-3" data-testid="design-sessions">
          <h3 className="text-[11px] font-semibold tracking-wide text-fg-muted uppercase">Earlier sessions</h3>
          {sessions.slice(0, 8).map((session) => (
            <div key={session.id} className="flex items-center gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate text-fg-muted" title={session.url}>
                {new Date(session.createdAt).toLocaleString()} · {session.opCount} change
                {session.opCount === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                data-testid="design-resend"
                className="shrink-0 text-accent hover:underline"
                onClick={() => void resendDesignSession(session.id, target)}
              >
                Resend
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// --- Send ------------------------------------------------------------------------------------------

interface DesignTarget {
  readonly key: string;
  readonly target: AgentModeTarget;
  readonly agentName: string;
  /** Models offered for a new thread; empty when continuing a thread or the agent has none. */
  readonly models: readonly AgentModel[];
  readonly model: string | undefined;
  readonly detail: string;
}

/**
 * Where the send bar sends: the user's pick if it is still signed in, else a new thread with the
 * design task's agent and model (Settings → Agents), else the default agent and its default model. Only signed-in, visible agents (and their threads) count.
 */
function useDesignTarget(): DesignTarget | null {
  const pickable = usePickableAgents();
  const threads = useAgents((s) => s.threads);
  const chosen = useApp((s) => s.design.target);
  const chosenModel = useApp((s) => s.design.model);
  const task = useApp((s) => s.settings.tasks.design);
  return useMemo(() => {
    const byId = new Map(pickable.map((entry) => [entry.agent.id, entry]));
    const thread = chosen?.startsWith('thread:')
      ? threads.find((t) => `thread:${t.id}` === chosen && byId.has(t.agentId) && isListed(t))
      : undefined;
    if (thread) {
      return {
        key: `thread:${thread.id}`,
        target: { type: 'thread', threadId: thread.id },
        agentName: byId.get(thread.agentId)?.agent.name ?? thread.agentId,
        models: [],
        model: undefined,
        detail: `Continues “${thread.title}” with its current model`,
      };
    }
    const entry =
      (chosen?.startsWith('new:') ? byId.get(chosen.slice('new:'.length)) : undefined) ??
      (task.agentId !== null ? byId.get(task.agentId) : undefined) ??
      pickable[0];
    if (!entry) return null;
    const taskModel = task.agentId === entry.agent.id ? task.model : null;
    const model =
      entry.models.find((m) => m.value === chosenModel)?.value ??
      entry.models.find((m) => m.value === taskModel)?.value ??
      entry.models[0]?.value;
    return {
      key: `new:${entry.agent.id}`,
      target: { type: 'new', agentId: entry.agent.id, ...(model ? { model } : {}) },
      agentName: entry.agent.name,
      models: entry.models,
      model,
      detail: 'Starts a new thread',
    };
  }, [pickable, threads, chosen, chosenModel, task]);
}

function AgentPicker({ value }: { value: string }) {
  const pickable = usePickableAgents();
  const threads = useAgents((s) => s.threads);
  const options = useMemo(() => {
    const byId = new Map(pickable.map((entry) => [entry.agent.id, entry]));
    return [
      ...pickable.map((entry) => ({
        value: `new:${entry.agent.id}`,
        name: entry.agent.name,
        description: entry.isDefault ? 'Default · new thread' : 'New thread',
        group: 'Start a new thread',
      })),
      ...threads
        .filter((thread) => byId.has(thread.agentId) && isListed(thread))
        .map((thread) => ({
          value: `thread:${thread.id}`,
          name: thread.title,
          description: byId.get(thread.agentId)?.agent.name ?? thread.agentId,
          group: 'Continue a thread',
        })),
    ];
  }, [pickable, threads]);
  return (
    <Picker
      label="Agent"
      icon={value.startsWith('thread:') ? MessagesSquare : Bot}
      testId="design-target"
      menuWidth={280}
      className="min-w-0 flex-1"
      value={value}
      options={options}
      onChange={(next) => setDesignTarget(next, null)}
    />
  );
}

function ModelPicker({ target }: { target: DesignTarget }) {
  const agentId = target.target.type === 'new' ? target.target.agentId : '';
  const defaults = useApp((s) => s.settings.agents.defaultModels);
  if (target.models.length === 0 || !target.model) return null;
  return (
    <Picker
      label="Model"
      icon={Cpu}
      testId="design-model"
      menuWidth={260}
      className="min-w-0 flex-1"
      value={target.model}
      options={target.models.map((model) => ({ value: model.value, name: model.name }))}
      onChange={(value) => setDesignTarget(target.key, value)}
      defaultValue={defaults[agentId]}
      onSetDefault={(value) => toggleDefaultModel(agentId, value)}
      defaultHint={`Use for new ${target.agentName} threads`}
    />
  );
}

/** Shown instead of the pickers when no agent is signed in yet. */
function NoAgents() {
  const checking = useApp((s) => s.checkingAgents.length > 0);
  return (
    <div data-testid="design-no-agents" className="rounded-md border border-border bg-bg px-2 py-1.5 text-[11px]">
      {checking ? (
        <p className="flex items-center gap-1 text-fg-muted">
          <LoaderCircle size={11} className="animate-spin" /> Checking which agents are signed in…
        </p>
      ) : (
        <p className="text-fg-muted">No signed-in agent is shown. Sign in to one, or show it, in Settings.</p>
      )}
      <button type="button" onClick={() => openSettings('agents')} className="mt-1 text-accent hover:underline">
        Open Settings
      </button>
    </div>
  );
}

/** Always-visible send bar: how many changes, which agent and model get them, one obvious button. */
const CONFIRM_TEXT: Readonly<Record<DesignPending, string>> = {
  idle: 'Send them to an agent, or discard them to put the page back.',
  agent: 'Send them to an agent, or discard them, before switching to agent mode.',
  grove: 'Send them to an agent, or discard them, before opening Grove.',
};

function SendBar({ confirm, target }: { confirm: DesignPending | null; target: DesignTarget | null }) {
  const cursor = useApp((s) => activeOps(s.design.ops, s.design.cursor).length);
  const off = useApp((s) => s.design.cursor - activeOps(s.design.ops, s.design.cursor).length);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    await saveDesignTo(target?.target ?? null);
    setBusy(false);
  };
  return (
    <footer className="flex flex-col gap-2 border-t border-border bg-bg-subtle px-3 py-2.5" data-testid="design-send">
      {confirm && (
        <div data-testid="design-confirm" className="rounded-md border border-accent/40 bg-accent-soft px-2 py-1.5">
          <p className="text-xs font-medium">
            You have {cursor} unsent change{cursor === 1 ? '' : 's'}.
          </p>
          <p className="text-[11px] text-fg-muted">{CONFIRM_TEXT[confirm]}</p>
          <button
            type="button"
            data-testid="design-stay"
            onClick={() => dispatchMode({ type: 'designCancelConfirm' })}
            className="mt-1 text-[11px] text-accent hover:underline"
          >
            Keep editing
          </button>
        </div>
      )}
      {target ? (
        <div className="flex items-center gap-2">
          <AgentPicker value={target.key} />
          <ModelPicker target={target} />
        </div>
      ) : (
        <NoAgents />
      )}
      <button
        type="button"
        data-testid="design-save"
        disabled={cursor === 0 || busy || !target}
        onClick={() => void submit()}
        className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
      >
        <Send size={13} />
        {cursor === 0
          ? 'Make a change to send it'
          : `Send ${cursor} change${cursor === 1 ? '' : 's'} to ${target?.agentName ?? 'an agent'}`}
      </button>
      <div className="flex items-center justify-between text-[11px] text-fg-subtle">
        <span>
          {target?.detail ?? ''}
          {off > 0 ? ` · ${off} switched off, not sent` : ''}
        </span>
        <button
          type="button"
          data-testid="design-discard"
          onClick={() => void discardDesign()}
          className="hover:text-fg hover:underline"
        >
          Discard
        </button>
      </div>
    </footer>
  );
}

// --- Panel -----------------------------------------------------------------------------------------

function Breadcrumb({ selection }: { selection: DesignSelection }) {
  const trail = [...selection.ancestors].reverse();
  return (
    <nav
      aria-label="Element path"
      className="flex items-center gap-0.5 overflow-x-auto border-b border-border px-2 py-1 text-[11px] whitespace-nowrap"
    >
      {trail.map((entry, index) => {
        const depth = trail.length - index;
        return (
          <span key={`${depth}-${entry.label}`} className="flex items-center gap-0.5">
            <button
              type="button"
              data-testid="design-crumb"
              onClick={() => void send({ type: 'selectAncestor', depth })}
              className="rounded px-1 text-fg-subtle hover:bg-bg-muted hover:text-fg"
            >
              {entry.label}
            </button>
            <ChevronRight size={10} className="text-fg-subtle" />
          </span>
        );
      })}
      <span className="rounded bg-accent-soft px-1 font-medium text-accent">
        {selection.componentChain[0] ? `${selection.componentChain[0]} · ` : ''}
        {selection.tag}
      </span>
    </nav>
  );
}

export default function DesignPanel() {
  const mode = useApp((s) => s.mode);
  const design = useApp((s) => s.design);
  const [tab, setTab] = useState<'style' | 'changes'>('style');
  const selection = design.selection;
  const confirm = mode.kind === 'design' && mode.phase === 'confirm' ? mode.pending : null;
  const changes = design.cursor;
  const activeTab = confirm ? 'changes' : tab;
  const target = useDesignTarget();
  useAutoVerify();

  useEffect(() => {
    void window.arbora.invoke('design.listSessions').then((sessions) => {
      useApp.setState((s) => ({ design: { ...s.design, sessions } }));
    });
  }, []);

  return (
    <div
      data-testid="design-panel"
      data-phase={confirm ? 'confirm' : 'editing'}
      className="flex h-full flex-col bg-bg text-fg"
    >
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          Design{design.selectionCount > 1 ? ` · ${design.selectionCount} selected` : ''}
        </span>
        <button
          type="button"
          aria-label="Undo"
          title="Undo"
          data-testid="design-undo"
          disabled={changes === 0 || design.showingOriginal}
          onClick={() => void send({ type: 'undo' })}
          className="rounded p-1 text-fg-subtle enabled:hover:bg-bg-muted enabled:hover:text-fg disabled:opacity-40"
        >
          <Undo2 size={14} />
        </button>
        <button
          type="button"
          aria-label="Redo"
          title="Redo"
          data-testid="design-redo"
          disabled={changes >= design.ops.length || design.showingOriginal}
          onClick={() => void send({ type: 'redo' })}
          className="rounded p-1 text-fg-subtle enabled:hover:bg-bg-muted enabled:hover:text-fg disabled:opacity-40"
        >
          <Redo2 size={14} />
        </button>
        <button
          type="button"
          aria-pressed={design.showingOriginal}
          title={design.showingOriginal ? 'Show my changes' : 'Show the page before my changes'}
          data-testid="design-compare"
          disabled={changes === 0}
          onClick={() => void send({ type: 'showOriginal', on: !design.showingOriginal })}
          className={clsx(
            'flex items-center gap-1 rounded px-1.5 py-1 text-[11px] disabled:opacity-40',
            design.showingOriginal ? 'bg-accent text-accent-fg' : 'text-fg-subtle enabled:hover:bg-bg-muted',
          )}
        >
          {design.showingOriginal ? <EyeOff size={13} /> : <Eye size={13} />}
          {design.showingOriginal ? 'Original' : 'Compare'}
        </button>
      </header>
      <div role="tablist" className="flex shrink-0 border-b border-border text-[11px]">
        {(
          [
            ['style', 'Style'],
            ['changes', `Changes${changes > 0 ? ` (${changes})` : ''}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            data-testid={`design-tab-${id}`}
            onClick={() => setTab(id)}
            className={clsx(
              'flex-1 border-b-2 py-1.5 font-medium',
              activeTab === id ? 'border-accent text-fg' : 'border-transparent text-fg-subtle hover:text-fg',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {design.showingOriginal && (
        <p className="shrink-0 bg-accent-soft px-3 py-1 text-[11px] text-fg-muted" data-testid="design-original-note">
          Showing the page before your changes. Press Compare again to keep editing.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === 'changes' ? (
          <ChangesPanel
            target={target?.target ?? null}
            onEdit={() => {
              if (confirm) dispatchMode({ type: 'designCancelConfirm' });
              setTab('style');
            }}
          />
        ) : selection ? (
          <>
            <Breadcrumb selection={selection} />
            <StylePanel selection={selection} structureWarning={design.structureWarning} />
          </>
        ) : (
          <div className="flex flex-col gap-2 px-3 py-4 text-xs text-fg-muted" data-testid="design-empty">
            <p className="font-medium text-fg">Select an element on the page</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>Click to select, Shift-click to add to the selection.</li>
              <li>Double-click text to edit it in place.</li>
              <li>Drag the green edges to change padding and margin.</li>
              <li>Drag a number sideways in this panel to scrub it.</li>
            </ul>
          </div>
        )}
      </div>
      <SendBar confirm={confirm} target={target} />
    </div>
  );
}
