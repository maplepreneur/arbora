/**
 * One runtime per project path. A window that has the project open holds a reference, and Grove's
 * project list keeps a runtime alive with no window. It is disposed only when both are gone.
 */
export class RuntimeTable<T> {
  private readonly slots = new Map<string, { value: T; holders: Set<object>; listed: boolean }>();

  acquire(path: string, holder: object, create: () => T): T {
    const slot = this.slot(path, create);
    slot.holders.add(holder);
    return slot.value;
  }

  /** Keeps a runtime for a Grove listing. Returns it, creating one when this is the first reason. */
  list(path: string, create: () => T): T {
    const slot = this.slot(path, create);
    slot.listed = true;
    return slot.value;
  }

  /** Drops the listing. Returns the runtime when nothing else holds it, so the caller can dispose it. */
  unlist(path: string): T | null {
    const slot = this.slots.get(path);
    if (!slot) return null;
    slot.listed = false;
    return this.dropIfIdle(path);
  }

  /** Drops a window's hold. Returns the runtime when it should be disposed. */
  release(path: string, holder: object): T | null {
    const slot = this.slots.get(path);
    if (!slot) return null;
    slot.holders.delete(holder);
    return this.dropIfIdle(path);
  }

  get(path: string): T | undefined {
    return this.slots.get(path)?.value;
  }

  paths(): string[] {
    return [...this.slots.keys()];
  }

  /** Forgets every runtime and returns them so the caller can dispose each one. */
  drain(): T[] {
    const values = [...this.slots.values()].map((slot) => slot.value);
    this.slots.clear();
    return values;
  }

  private slot(path: string, create: () => T): { value: T; holders: Set<object>; listed: boolean } {
    const existing = this.slots.get(path);
    if (existing) return existing;
    const created = { value: create(), holders: new Set<object>(), listed: false };
    this.slots.set(path, created);
    return created;
  }

  private dropIfIdle(path: string): T | null {
    const slot = this.slots.get(path);
    if (!slot || slot.listed || slot.holders.size > 0) return null;
    this.slots.delete(path);
    return slot.value;
  }
}
