import type { Command as ArboraCommand } from '@arbora/shared';
import { Command } from 'cmdk';
import { useChordLabels } from '../chords';
import { showToast, useAppState, useServices } from '../context';

export function CommandPalette() {
  const { store, commands } = useServices();
  const open = useAppState((state) => state.paletteOpen);
  // Visibility depends on app state (project, mode), so the list is rebuilt each time it opens.
  const list: ArboraCommand[] = open ? commands.list() : [];
  const chords = useChordLabels();

  const close = (): void => {
    store.setState({ paletteOpen: false });
  };

  const run = (id: string): void => {
    close();
    void commands.run(id).catch((error: unknown) => {
      showToast(store, error instanceof Error ? error.message : String(error), 'error');
    });
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => {
        store.setState({ paletteOpen: next });
      }}
      label="Command palette"
      loop
      overlayClassName="fixed inset-0 z-40 bg-black/30"
      contentClassName="fixed top-[12%] left-1/2 z-50 w-[min(600px,90vw)] -translate-x-1/2"
    >
      <div
        data-testid="command-palette"
        className="overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
      >
        <Command.Input
          autoFocus
          placeholder="Type a command…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted"
        />
        <Command.List className="max-h-80 overflow-auto p-1">
          <Command.Empty className="px-3 py-6 text-center text-muted">
            No commands found.
          </Command.Empty>
          {list.map((command) => (
            <Command.Item
              key={command.id}
              value={`${command.category ?? ''} ${command.title} ${command.id}`}
              onSelect={() => {
                run(command.id);
              }}
              className="flex cursor-default items-center gap-2 rounded px-3 py-2 data-[selected=true]:bg-surface-2"
            >
              {command.category ? <span className="text-muted">{command.category}:</span> : null}
              <span className="flex-1">{command.title}</span>
              {chords.get(command.id) ? (
                <kbd className="font-mono text-[11px] text-muted">{chords.get(command.id)}</kbd>
              ) : null}
            </Command.Item>
          ))}
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
