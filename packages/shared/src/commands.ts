export interface Command {
  readonly id: string;
  readonly title: string;
  readonly category?: string;
  readonly run: () => void | Promise<void>;
  /** Hidden from the palette (but still runnable) when this returns false. */
  readonly isVisible?: () => boolean;
}

export type CommandRegistryListener = () => void;

export class CommandRegistry {
  readonly #commands = new Map<string, Command>();
  readonly #listeners = new Set<CommandRegistryListener>();

  /** Registers a command and returns a disposer. Re-registering an id replaces the previous entry. */
  register(command: Command): () => void {
    this.#commands.set(command.id, command);
    this.#notify();
    return () => {
      if (this.#commands.get(command.id) === command) {
        this.#commands.delete(command.id);
        this.#notify();
      }
    };
  }

  get(id: string): Command | undefined {
    return this.#commands.get(id);
  }

  list(): Command[] {
    return [...this.#commands.values()]
      .filter((command) => command.isVisible?.() ?? true)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  /** Runs a command by id. Returns false when no such command is registered. */
  async run(id: string): Promise<boolean> {
    const command = this.#commands.get(id);
    if (!command) return false;
    await command.run();
    return true;
  }

  subscribe(listener: CommandRegistryListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
