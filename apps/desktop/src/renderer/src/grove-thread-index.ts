/** A thread Grove knows about, including ones whose project is not focused. Attention reads this without a store cycle. */
export interface IndexedGroveThread {
  readonly projectPath: string;
  readonly id: string;
  readonly title: string;
  readonly agentId: string;
  readonly parentThreadId: string | null;
}

let threads: readonly IndexedGroveThread[] = [];

export function replaceGroveThreadIndex(next: readonly IndexedGroveThread[]): void {
  threads = next;
}

export function findGroveThread(id: string): IndexedGroveThread | undefined {
  return threads.find((thread) => thread.id === id);
}
