import type { TabRole } from '@arbora/shared';

interface GrantKey {
  readonly projectPath: string;
  readonly threadId: string;
  readonly tabId: string;
}

/**
 * Reference tabs an agent thread may use. The project's app tab is always allowed. Grants are in
 * memory: they end when the tab closes, and a restart asks again.
 */
export class TabGrantStore {
  private readonly grants = new Map<string, Set<string>>();
  private readonly writes = new Set<string>();

  grant(projectPath: string, threadId: string, tabId: string): void {
    const key = threadKey(projectPath, threadId);
    const set = this.grants.get(key) ?? new Set<string>();
    set.add(tabId);
    this.grants.set(key, set);
  }

  revoke(projectPath: string, threadId: string, tabId: string): void {
    this.grants.get(threadKey(projectPath, threadId))?.delete(tabId);
    this.writes.delete(writeKey({ projectPath, threadId, tabId }));
  }

  list(projectPath: string, threadId: string): string[] {
    return [...(this.grants.get(threadKey(projectPath, threadId)) ?? [])];
  }

  canRead(projectPath: string, threadId: string, tabId: string, role: TabRole): boolean {
    if (role === 'app') return true;
    return this.grants.get(threadKey(projectPath, threadId))?.has(tabId) === true;
  }

  canWrite(key: GrantKey): boolean {
    return this.writes.has(writeKey(key));
  }

  allowWrite(key: GrantKey): void {
    this.writes.add(writeKey(key));
  }

  dropThread(projectPath: string, threadId: string): void {
    this.grants.delete(threadKey(projectPath, threadId));
    const prefix = `${projectPath}\0${threadId}\0`;
    for (const key of [...this.writes]) if (key.startsWith(prefix)) this.writes.delete(key);
  }

  /** Drops the tab from every thread in the project. Returns the threads that had it. */
  dropTab(projectPath: string, tabId: string): string[] {
    const affected: string[] = [];
    const prefix = `${projectPath}\0`;
    for (const [key, tabs] of this.grants) {
      if (!key.startsWith(prefix) || !tabs.delete(tabId)) continue;
      affected.push(key.slice(prefix.length));
    }
    for (const key of [...this.writes]) {
      if (key.startsWith(`${projectPath}\0`) && key.endsWith(`\0${tabId}`)) this.writes.delete(key);
    }
    return affected;
  }

  /** Tabs a running loop may be using. The LRU discard must leave these loaded. */
  protectedIds(projectPath: string): ReadonlySet<string> {
    const ids = new Set<string>();
    const prefix = `${projectPath}\0`;
    for (const [key, tabs] of this.grants) {
      if (!key.startsWith(prefix)) continue;
      for (const id of tabs) ids.add(id);
    }
    return ids;
  }
}

function threadKey(projectPath: string, threadId: string): string {
  return `${projectPath}\0${threadId}`;
}

function writeKey(key: GrantKey): string {
  return `${key.projectPath}\0${key.threadId}\0${key.tabId}`;
}
