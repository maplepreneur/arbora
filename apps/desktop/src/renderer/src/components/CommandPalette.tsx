import { useSyncExternalStore } from 'react';
import { Command } from 'cmdk';
import { formatChord, type Command as ArboraCommand } from '@arbora/shared';
import { commands, executeCommand } from '../commands';
import { useKeybindingTable } from '../keybindings';
import { useApp } from '../store';

function useCommands(): ArboraCommand[] {
  return useSyncExternalStore(
    (onChange) => commands.subscribe(onChange),
    () => commandsSnapshot(),
  );
}

let snapshot: ArboraCommand[] = [];
let snapshotKey = '';
function commandsSnapshot(): ArboraCommand[] {
  const list = commands.list();
  const key = list.map((c) => c.id).join('|');
  if (key !== snapshotKey) {
    snapshotKey = key;
    snapshot = list;
  }
  return snapshot;
}

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const platform = useApp((s) => s.info.platform);
  const table = useKeybindingTable();
  const all = useCommands();
  const close = (): void => useApp.setState({ paletteOpen: false });

  if (!open) return null;

  const visible = all.filter((c) => !c.hidden);
  const categories = [...new Set(visible.map((c) => c.category ?? 'General'))];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <Command
        label="Command palette"
        data-testid="command-palette"
        className="w-[min(560px,90vw)] overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
        }}
      >
        <Command.Input
          autoFocus
          placeholder="Type a command…"
          className="h-11 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-fg-subtle"
        />
        <Command.List className="max-h-[50vh] overflow-y-auto p-1">
          <Command.Empty className="px-3 py-6 text-center text-fg-subtle">No matching commands</Command.Empty>
          {categories.map((category) => (
            <Command.Group
              key={category}
              heading={category}
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-subtle [&_[cmdk-group-heading]]:uppercase"
            >
              {visible
                .filter((c) => (c.category ?? 'General') === category)
                .map((command) => {
                  const binding = table.forCommand(command.id);
                  return (
                    <Command.Item
                      key={command.id}
                      value={`${command.category ?? ''} ${command.title} ${command.id}`}
                      onSelect={() => {
                        close();
                        executeCommand(command.id);
                      }}
                      className="flex cursor-default items-center rounded px-3 py-1.5 data-[selected=true]:bg-accent-soft data-[selected=true]:text-fg"
                    >
                      <span className="flex-1">{command.title}</span>
                      {binding && <kbd className="font-mono text-[11px] text-fg-subtle">{formatChord(binding.chord, platform)}</kbd>}
                    </Command.Item>
                  );
                })}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
