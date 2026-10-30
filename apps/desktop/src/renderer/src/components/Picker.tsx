import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Check, ChevronDown, Search, type LucideIcon } from 'lucide-react';
import { filterOptions, groupOptions, withProviderGroups, type PickerOption } from './picker-options';

export type { PickerOption } from './picker-options';

/** Lists longer than this get a search field. */
const SEARCH_THRESHOLD = 8;
const MAX_LIST_HEIGHT = 360;
const GAP = 4;
const EDGE = 6;

interface Placement {
  readonly left: number;
  readonly width: number;
  readonly top?: number;
  readonly bottom?: number;
  readonly maxHeight: number;
}

/**
 * The popover must stay inside the trigger's panel: the browser's native view paints over any
 * DOM that strays onto it. `data-picker-bounds` marks that panel; the window is the fallback.
 */
function place(trigger: HTMLElement, preferredWidth: number): Placement {
  const box = trigger.getBoundingClientRect();
  const boundsEl = trigger.closest('[data-picker-bounds]');
  const bounds = boundsEl
    ? boundsEl.getBoundingClientRect()
    : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const room = Math.max(120, bounds.right - bounds.left - 2 * EDGE);
  const width = Math.min(Math.max(preferredWidth, box.width), room);
  const left = Math.min(Math.max(box.left, bounds.left + EDGE), bounds.right - EDGE - width);
  const below = bounds.bottom - box.bottom - GAP - EDGE;
  const above = box.top - bounds.top - GAP - EDGE;
  if (below >= Math.min(MAX_LIST_HEIGHT, 220) || below >= above) {
    return { left, width, top: box.bottom + GAP, maxHeight: Math.min(MAX_LIST_HEIGHT, below) };
  }
  return { left, width, bottom: window.innerHeight - box.top + GAP, maxHeight: Math.min(MAX_LIST_HEIGHT, above) };
}

export interface PickerProps {
  /** Accessible name; also shown before the value when `showLabel` is set. */
  readonly label: string;
  readonly value: string;
  readonly options: readonly PickerOption[];
  readonly onChange: (value: string) => void;
  readonly testId: string;
  readonly icon?: LucideIcon;
  readonly showLabel?: boolean;
  readonly disabled?: boolean;
  /** Width of the open list in px (it never gets narrower than the trigger). */
  readonly menuWidth?: number;
  readonly className?: string;
}

/**
 * A themed dropdown for agent pickers (mode, model, config options, send-to target). Native
 * `<select>` popups ignore the app theme on Linux and are unusable for OpenCode's 50+ models.
 * Long lists get a search field; `provider/Model` names are grouped by provider. Keyboard:
 * arrows, Home/End, Enter, Escape; typing filters.
 */
export function Picker({
  label,
  value,
  options,
  onChange,
  testId,
  icon: Icon,
  showLabel = false,
  disabled = false,
  menuWidth = 280,
  className,
}: PickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const prepared = useMemo(() => withProviderGroups(options), [options]);
  const selected = prepared.find((o) => o.value === value);
  const searchable = prepared.length > SEARCH_THRESHOLD;
  const filtered = useMemo(() => filterOptions(prepared, query), [prepared, query]);
  const groups = useMemo(() => groupOptions(filtered), [filtered]);
  const flat = useMemo(() => groups.flatMap((g) => g.options), [groups]);
  const indexOf = useMemo(() => new Map(flat.map((o, i) => [o.value, i])), [flat]);

  const close = (refocus: boolean): void => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerRef.current?.focus();
  };

  const openMenu = (): void => {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    setActive(
      Math.max(
        0,
        withProviderGroups(options).findIndex((o) => o.value === value),
      ),
    );
  };

  const choose = (option: PickerOption): void => {
    close(true);
    if (option.value !== value) onChange(option.value);
  };

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = (): void => {
      if (triggerRef.current) setPlacement(place(triggerRef.current, menuWidth));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, menuWidth]);

  const placed = placement !== null;
  useEffect(() => {
    if (open && placed) (searchable ? searchRef.current : menuRef.current)?.focus();
  }, [open, placed, searchable]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false);
    };
    const onBlur = (): void => close(false);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-index="${String(active)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, placement]);

  const onKeyDown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((i) => Math.min(flat.length - 1, i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        if (!searchable) {
          event.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (!searchable) {
          event.preventDefault();
          setActive(flat.length - 1);
        }
        break;
      case 'Enter': {
        event.preventDefault();
        const option = flat[active];
        if (option) choose(option);
        break;
      }
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
      default:
        break;
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId}
        data-value={value}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title={selected ? `${label}: ${selected.group ? `${selected.group}/` : ''}${selected.name}` : label}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(event) => {
          if (open) onKeyDown(event);
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu();
          }
        }}
        className={clsx(
          'flex h-6 min-w-0 items-center gap-1 rounded-md border border-border bg-bg-subtle pr-1 pl-1.5 text-[11px] text-fg hover:border-fg-subtle/60 hover:bg-bg-muted focus-visible:border-accent focus-visible:outline-none disabled:opacity-50',
          open && 'border-accent bg-bg-muted',
          className,
        )}
      >
        {Icon && <Icon size={12} className="shrink-0 text-fg-subtle" />}
        {showLabel && <span className="shrink-0 text-fg-subtle">{label}</span>}
        <span className="min-w-0 truncate">{selected?.name ?? value}</span>
        <ChevronDown size={12} className={clsx('shrink-0 text-fg-subtle transition-transform', open && 'rotate-180')} />
      </button>
      {open &&
        placement &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            data-testid={`${testId}-menu`}
            onKeyDown={onKeyDown}
            className="fixed z-50 flex flex-col overflow-hidden rounded-md border border-border bg-bg-elevated text-[12px] text-fg shadow-xl outline-none"
            style={{
              outline: 'none',
              left: placement.left,
              width: placement.width,
              maxHeight: placement.maxHeight,
              ...(placement.top !== undefined ? { top: placement.top } : { bottom: placement.bottom }),
            }}
          >
            {searchable && (
              <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
                <Search size={12} className="shrink-0 text-fg-subtle" />
                <input
                  ref={searchRef}
                  data-testid={`${testId}-search`}
                  value={query}
                  placeholder={`Search ${String(prepared.length)} ${label.toLowerCase()}s…`}
                  spellCheck={false}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActive(0);
                  }}
                  className="min-w-0 flex-1 border-0 bg-transparent text-[12px] placeholder:text-fg-subtle"
                  // The global `:focus-visible` ring is unlayered, so it beats Tailwind's `outline-none`.
                  style={{ outline: 'none' }}
                />
              </div>
            )}
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-1">
              {flat.length === 0 && <div className="px-3 py-2 text-fg-subtle">No matches</div>}
              {groups.map((group) => (
                <div key={group.group ?? ''} role="group" aria-label={group.group ?? undefined}>
                  {group.group && (
                    <div className="sticky top-0 z-10 bg-bg-elevated px-2.5 pt-1.5 pb-1 text-[10px] font-semibold tracking-wide text-fg-subtle uppercase">
                      {group.group}
                    </div>
                  )}
                  {group.options.map((option) => {
                    const i = indexOf.get(option.value) ?? 0;
                    const isSelected = option.value === value;
                    return (
                      <div
                        key={option.value}
                        role="option"
                        aria-selected={isSelected}
                        data-index={i}
                        data-testid={`${testId}-option`}
                        data-value={option.value}
                        onMouseEnter={() => setActive(i)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => choose(option)}
                        className={clsx(
                          'mx-1 flex cursor-default items-start gap-1.5 rounded px-1.5 py-1',
                          i === active && 'bg-accent-soft',
                        )}
                      >
                        <Check size={12} className={clsx('mt-0.5 shrink-0 text-accent', !isSelected && 'invisible')} />
                        <span className="min-w-0 flex-1">
                          <span className={clsx('block truncate', isSelected && 'font-medium')}>{option.name}</span>
                          {option.description && (
                            <span className="block truncate text-[11px] text-fg-subtle">{option.description}</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
