import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { DEFAULT_COMMANDS, filterKeybindingCheatRows, keybindingCheatRows } from '@arbora/shared';
import { closeOverlay, useApp } from '../store';
import { Dialog } from './Dialog';

/**
 * Reference list of the chords that are actually bound. Enter and Escape close it; nothing in the
 * list runs a command.
 */
export function KeybindingsCheatsheet() {
  const open = useApp((s) => s.overlay === 'keybindings');
  if (!open) return null;
  return <KeybindingsSheet />;
}

function KeybindingsSheet() {
  const platform = useApp((s) => s.info.platform);
  const userOverrides = useApp((s) => s.settings.keybindings);
  const projectOverrides = useApp((s) => s.project?.settings.keybindings);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () =>
      filterKeybindingCheatRows(
        keybindingCheatRows(DEFAULT_COMMANDS, platform, userOverrides, projectOverrides),
        query,
      ),
    [platform, userOverrides, projectOverrides, query],
  );
  const selected = rows.length === 0 ? 0 : Math.min(Math.max(index, 0), rows.length - 1);
  const activeId = rows[selected] ? `keybinding-row-${rows[selected].commandId}` : undefined;

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected, query]);

  const close = (): void => closeOverlay('keybindings');

  return (
    <Dialog label="Keybindings" testId="keybindings-cheatsheet" onClose={close} width={640}>
      <input
        data-autofocus
        role="combobox"
        aria-expanded="true"
        aria-controls="keybindings-list"
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        placeholder="Keybindings..."
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIndex((current) => (rows.length === 0 ? 0 : Math.min(rows.length - 1, current + 1)));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIndex((current) => Math.max(0, current - 1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            close();
          }
        }}
        className="h-11 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-fg-subtle"
      />
      <div
        ref={listRef}
        id="keybindings-list"
        role="listbox"
        aria-label="Keybindings"
        className="max-h-[60vh] overflow-y-auto py-1"
      >
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-fg-subtle">No matching keybindings</p>
        ) : (
          rows.map((row, rowIndex) => {
            const active = rowIndex === selected;
            return (
              <div
                key={row.commandId}
                id={`keybinding-row-${row.commandId}`}
                role="option"
                aria-selected={active}
                data-active={active ? 'true' : 'false'}
                className={clsx(
                  'grid grid-cols-[13.5rem_1.5rem_minmax(0,1fr)] items-center gap-3 border-l-2 px-4 py-2',
                  active ? 'border-accent bg-accent-soft text-fg' : 'border-transparent text-fg-muted',
                )}
              >
                <span className="truncate font-mono text-[13px]">{row.chord}</span>
                <span className="text-fg-subtle" aria-hidden>
                  →
                </span>
                <span className="min-w-0 truncate">
                  {row.title}
                  {row.scope && <span className="ml-2 text-xs text-fg-subtle">{row.scope}</span>}
                </span>
              </div>
            );
          })
        )}
      </div>
    </Dialog>
  );
}
