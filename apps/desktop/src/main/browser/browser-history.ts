import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { browserHistoryEntrySchema, type BrowserHistoryEntry } from '@arbora/shared';
import { writeJsonAtomic } from '../settings-store.js';

export const MAX_HISTORY_ENTRIES = 200;
const SAVE_DELAY_MS = 1000;

const historyFileSchema = z.object({ entries: z.array(browserHistoryEntrySchema) });

/**
 * Visited URLs for one browser partition, newest first, one entry per URL. Electron sessions keep
 * no queryable history, so the URL bar's suggestions come from this file.
 */
export class BrowserHistory {
  private entries: BrowserHistoryEntry[];
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(private readonly filePath: string) {
    this.entries = BrowserHistory.read(filePath);
  }

  private static read(filePath: string): BrowserHistoryEntry[] {
    if (!existsSync(filePath)) return [];
    try {
      const parsed = historyFileSchema.safeParse(JSON.parse(readFileSync(filePath, 'utf8')));
      return parsed.success ? parsed.data.entries.slice(0, MAX_HISTORY_ENTRIES) : [];
    } catch {
      return [];
    }
  }

  list(): BrowserHistoryEntry[] {
    return [...this.entries];
  }

  record(url: string, title: string, visitedAt = Date.now()): void {
    if (!/^https?:/.test(url)) return;
    const previous = this.entries.find((e) => e.url === url);
    const entry = { url, title: title || previous?.title || '', visitedAt };
    this.entries = [entry, ...this.entries.filter((e) => e.url !== url)].slice(0, MAX_HISTORY_ENTRIES);
    this.scheduleSave();
  }

  /** Updates the title of an existing entry (titles usually arrive after the navigation). */
  setTitle(url: string, title: string): void {
    const entry = this.entries.find((e) => e.url === url);
    if (!entry || !title || entry.title === title) return;
    this.entries = this.entries.map((e) => (e.url === url ? { ...e, title } : e));
    this.scheduleSave();
  }

  flush(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    writeJsonAtomic(this.filePath, { entries: this.entries });
  }

  dispose(): void {
    if (this.saveTimer) this.flush();
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }
}
