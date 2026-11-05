import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { File, GitCompare, Globe, Plus, SquareTerminal, TriangleAlert, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { ADD_TABS, placeTabMenu, type AddTabId } from './add-tab-menu';

const ICONS: Record<AddTabId, LucideIcon> = {
  file: File,
  terminal: SquareTerminal,
  browser: Globe,
  changes: GitCompare,
  problems: TriangleAlert,
};

/**
 * The content pane's + button. The menu matches the app's other menus (elevated surface, border,
 * accent row) and uses the same icons as the tabs. It is drawn in the renderer: a native menu
 * cannot take the theme.
 */
export function AddTabButton({
  onChoose,
  onFrame,
}: {
  onChoose: (id: AddTabId) => void;
  /** Menu bottom in window CSS pixels while open, so the page can start below it. */
  onFrame: (bottom: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean): void => {
    setOpen(false);
    setBox(null);
    if (refocus) triggerRef.current?.focus();
  };

  const choose = (id: AddTabId): void => {
    close(false);
    onChoose(id);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const place = (): void => {
      const next = placeTabMenu(trigger.getBoundingClientRect(), menu.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      setBox(next);
      onFrame(next.top + menu.offsetHeight);
    };
    place();
    menu.focus();
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      onFrame(null);
    };
  }, [open, onFrame]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
      setBox(null);
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
          setActive(0);
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          setActive(event.key === 'ArrowUp' ? ADD_TABS.length - 1 : 0);
          setOpen(true);
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
            className="fixed z-50 w-44 rounded-md border border-border bg-bg-elevated py-1 text-[12px] text-fg shadow-xl outline-none"
            style={{
              outline: 'none',
              top: box?.top ?? 0,
              left: box?.left ?? 0,
              visibility: box ? 'visible' : 'hidden',
            }}
          >
            {ADD_TABS.map((item, index) => {
              const Icon = ICONS[item.id];
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
                      'mx-1 flex items-center gap-2 rounded px-2 py-1.5 text-left',
                      index === active && 'bg-accent-soft',
                    )}
                  >
                    <Icon size={14} className="shrink-0 text-fg-subtle" />
                    {item.label}
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
