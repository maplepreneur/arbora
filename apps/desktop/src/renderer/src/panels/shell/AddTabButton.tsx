import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { File, GitCompare, Globe, Plus, SquareTerminal, TriangleAlert, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { formatChord } from '@arbora/shared';
import { useKeybindingTable } from '../../keybindings';
import { useApp } from '../../store';
import { ADD_TABS, placeTabMenu, type AddTabId } from './add-tab-menu';

const ICONS: Record<AddTabId, LucideIcon> = {
  file: File,
  terminal: SquareTerminal,
  browser: Globe,
  changes: GitCompare,
  problems: TriangleAlert,
};

function useAddTabChords(): ReadonlyMap<AddTabId, string> {
  const table = useKeybindingTable();
  const platform = useApp((s) => s.info.platform);
  return useMemo(() => {
    const labels = new Map<AddTabId, string>();
    for (const item of ADD_TABS) {
      const binding = table.forCommand(item.command);
      if (binding) labels.set(item.id, formatChord(binding.chord, platform));
    }
    return labels;
  }, [table, platform]);
}

/**
 * The content pane's + button. The menu matches the app's other menus (elevated surface, border,
 * accent row) and uses the same icons as the tabs. It is drawn in the renderer: a native menu
 * cannot take the theme. It floats; the page underneath is parked by the caller when the native
 * browser view would cover it.
 */
export function AddTabButton({
  onChoose,
  onBeforeOpen,
  onOpenChange,
}: {
  onChoose: (id: AddTabId) => void;
  /** Runs before the menu is shown, so a live page can be captured while the view is still up. */
  onBeforeOpen?: () => Promise<void>;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const chords = useAddTabChords();

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const close = (refocus: boolean): void => {
    setOpen(false);
    setBox(null);
    onOpenChangeRef.current?.(false);
    if (refocus) triggerRef.current?.focus();
  };

  const choose = (id: AddTabId): void => {
    close(false);
    onChoose(id);
  };

  const openMenu = (index: number): void => {
    const start = (): void => {
      setActive(index);
      setOpen(true);
      onOpenChangeRef.current?.(true);
    };
    if (!onBeforeOpen) {
      start();
      return;
    }
    void onBeforeOpen().then(start);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const place = (): void => {
      setBox(
        placeTabMenu(trigger.getBoundingClientRect(), menu.getBoundingClientRect(), {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
    };
    place();
    menu.focus();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
      setBox(null);
      onOpenChangeRef.current?.(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const last = ADD_TABS.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => (index >= last ? 0 : index + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => (index <= 0 ? last : index - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(last);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const item = ADD_TABS[active];
        if (item) choose(item.id);
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
        aria-label="Open a tab"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'content-add-menu' : undefined}
        title="Open a file, terminal, browser, changes or problems"
        data-testid="content-add"
        onClick={() => {
          if (open) close(false);
          else openMenu(0);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          if (open) {
            setActive(event.key === 'ArrowUp' ? ADD_TABS.length - 1 : 0);
            return;
          }
          openMenu(event.key === 'ArrowUp' ? ADD_TABS.length - 1 : 0);
        }}
        className={clsx(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg',
          open && 'bg-bg-muted text-fg',
        )}
      >
        <Plus size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id="content-add-menu"
            role="menu"
            aria-label="Open a tab"
            tabIndex={-1}
            data-testid="content-add-menu"
            onKeyDown={onKeyDown}
            className="fixed z-50 w-60 rounded-md border border-border bg-bg-elevated py-1 text-[12px] text-fg shadow-xl outline-none"
            style={{
              outline: 'none',
              top: box?.top ?? 0,
              left: box?.left ?? 0,
              visibility: box ? 'visible' : 'hidden',
            }}
          >
            {ADD_TABS.map((item, index) => {
              const Icon = ICONS[item.id];
              const chord = chords.get(item.id);
              return (
                <div key={item.id}>
                  {item.separated && <div role="separator" className="my-1 h-px bg-border" />}
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`content-add-${item.id}`}
                    data-active={index === active ? 'true' : undefined}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(item.id)}
                    className={clsx(
                      'mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded px-2 py-1.5 text-left',
                      index === active && 'bg-accent-soft',
                    )}
                  >
                    <Icon size={14} className="shrink-0 text-fg-subtle" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {chord && (
                      <kbd
                        data-testid={`content-add-chord-${item.id}`}
                        className="shrink-0 font-mono text-[11px] text-fg-subtle"
                      >
                        {chord}
                      </kbd>
                    )}
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
