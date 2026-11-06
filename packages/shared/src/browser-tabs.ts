import { z } from 'zod';
import { viewportPresetIdSchema, type ViewportPresetId } from './browser.js';

/** Live `WebContentsView`s before the least recently used reference tab is discarded. */
export const LIVE_TAB_CAP = 12;
/** Closed reference tabs `Mod+Shift+T` can reopen. */
export const CLOSED_TAB_LIMIT = 25;

export const tabRoleSchema = z.enum(['app', 'reference']);
export type TabRole = z.infer<typeof tabRoleSchema>;

/** What is written into the machine-local project state. */
export const persistedBrowserTabSchema = z.object({
  id: z.string().min(1).max(80),
  role: tabRoleSchema,
  url: z.string().max(8000),
  title: z.string().max(500),
  zoom: z.number().min(0.25).max(5),
  preset: viewportPresetIdSchema,
  /** Reference tabs use the shared web partition unless this is on. The app tab always does. */
  useProjectSession: z.boolean(),
  /** Set when an agent opened the tab; the tab closes with that session unless pinned. */
  openedByThreadId: z.string().max(80).nullable(),
  pinned: z.boolean(),
});
export type PersistedBrowserTab = z.infer<typeof persistedBrowserTabSchema>;

export interface BrowserTabRecord extends PersistedBrowserTab {
  /** Epoch ms of the last time the user or a tool used the tab. */
  usedAt: number;
  /** Not loaded yet, or unloaded to stay under {@link LIVE_TAB_CAP}. */
  discarded: boolean;
  favicon: string | null;
  loading: boolean;
}

export interface BrowserTabSet {
  readonly tabs: readonly BrowserTabRecord[];
  readonly activeId: string;
  readonly closed: readonly PersistedBrowserTab[];
}

export interface BrowserTabSnapshot {
  readonly id: string;
  readonly role: TabRole;
  readonly url: string;
  readonly title: string;
  readonly favicon: string | null;
  readonly loading: boolean;
  readonly active: boolean;
  readonly discarded: boolean;
  readonly pinned: boolean;
  readonly useProjectSession: boolean;
  readonly openedByAgent: boolean;
}

const persistedListSchema = z.array(persistedBrowserTabSchema).max(50);

export const browserTabSnapshotSchema = z.object({
  id: z.string(),
  role: tabRoleSchema,
  url: z.string(),
  title: z.string(),
  favicon: z.string().nullable(),
  loading: z.boolean(),
  active: z.boolean(),
  discarded: z.boolean(),
  pinned: z.boolean(),
  useProjectSession: z.boolean(),
  openedByAgent: z.boolean(),
});

export function browserTabSnapshots(set: BrowserTabSet): BrowserTabSnapshot[] {
  return set.tabs.map((tab) => ({
    id: tab.id,
    role: tab.role,
    url: tab.url,
    title: tab.title,
    favicon: tab.favicon,
    loading: tab.loading,
    active: tab.id === set.activeId,
    discarded: tab.discarded,
    pinned: tab.pinned,
    useProjectSession: tab.useProjectSession,
    openedByAgent: tab.openedByThreadId !== null,
  }));
}

export function appTab(set: BrowserTabSet): BrowserTabRecord {
  const tab = set.tabs.find((entry) => entry.role === 'app');
  if (!tab) throw new Error('A project has no app tab');
  return tab;
}

export function activeTab(set: BrowserTabSet): BrowserTabRecord {
  const tab = set.tabs.find((entry) => entry.id === set.activeId);
  if (!tab) throw new Error('The active browser tab is missing');
  return tab;
}

function tab(partial: PersistedBrowserTab & { usedAt: number; discarded?: boolean }): BrowserTabRecord {
  return {
    ...partial,
    discarded: partial.discarded ?? false,
    favicon: null,
    loading: false,
  };
}

/** The single app tab a project starts with. */
export function createBrowserTabSet(input: {
  id: string;
  url?: string;
  title?: string;
  zoom?: number;
  preset?: ViewportPresetId;
  now: number;
}): BrowserTabSet {
  return {
    tabs: [
      tab({
        id: input.id,
        role: 'app',
        url: input.url ?? '',
        title: input.title ?? '',
        zoom: input.zoom ?? 1,
        preset: input.preset ?? 'responsive',
        useProjectSession: true,
        openedByThreadId: null,
        pinned: true,
        usedAt: input.now,
      }),
    ],
    activeId: input.id,
    closed: [],
  };
}

/**
 * Restores tabs. Only `activeId` is live; the rest stay discarded until shown. A file from before
 * tabs existed becomes one app tab at `lastUrl`.
 */
export function restoreBrowserTabSet(input: {
  tabs?: unknown;
  activeTabId?: string | undefined;
  lastUrl?: string | undefined;
  preset?: ViewportPresetId | undefined;
  zoom?: number | undefined;
  now: number;
  id: () => string;
}): BrowserTabSet {
  const parsed = persistedListSchema.safeParse(input.tabs);
  const saved = parsed.success ? parsed.data : [];
  if (saved.length === 0) {
    return createBrowserTabSet({
      id: input.id(),
      ...(input.lastUrl ? { url: input.lastUrl } : {}),
      ...(input.preset ? { preset: input.preset } : {}),
      ...(input.zoom !== undefined ? { zoom: input.zoom } : {}),
      now: input.now,
    });
  }
  const app = saved.find((entry) => entry.role === 'app') ?? saved[0];
  if (!app) return createBrowserTabSet({ id: input.id(), now: input.now });
  const rest = saved.filter((entry) => entry.id !== app.id && entry.role !== 'app');
  const ordered = [app, ...rest];
  const activeId = ordered.some((entry) => entry.id === input.activeTabId) ? (input.activeTabId as string) : app.id;
  return {
    tabs: ordered.map((entry, index) =>
      tab({
        ...entry,
        role: index === 0 ? 'app' : 'reference',
        useProjectSession: index === 0 ? true : entry.useProjectSession,
        pinned: index === 0 ? true : entry.pinned,
        usedAt: input.now - (ordered.length - index),
        discarded: entry.id !== activeId,
      }),
    ),
    activeId,
    closed: [],
  };
}

export function persistedBrowserTabs(set: BrowserTabSet): {
  tabs: PersistedBrowserTab[];
  activeTabId: string;
} {
  return {
    activeTabId: set.activeId,
    tabs: set.tabs.map((entry) => ({
      id: entry.id,
      role: entry.role,
      url: entry.url,
      title: entry.title,
      zoom: entry.zoom,
      preset: entry.preset,
      useProjectSession: entry.useProjectSession,
      openedByThreadId: entry.openedByThreadId,
      pinned: entry.pinned,
    })),
  };
}

function withCap(set: BrowserTabSet, protectedIds: ReadonlySet<string>): BrowserTabSet {
  return discardLeastRecent(set, protectedIds);
}

/** Opens a reference tab. It is live and, by default, active. */
export function openReferenceTab(
  set: BrowserTabSet,
  input: {
    id: string;
    url: string;
    title?: string;
    now: number;
    activate?: boolean;
    useProjectSession?: boolean;
    openedByThreadId?: string | null;
    pinned?: boolean;
    protectedIds?: ReadonlySet<string>;
  },
): BrowserTabSet {
  const activate = input.activate !== false;
  const next: BrowserTabSet = {
    tabs: [
      ...set.tabs,
      tab({
        id: input.id,
        role: 'reference',
        url: input.url,
        title: input.title ?? '',
        zoom: 1,
        preset: 'responsive',
        useProjectSession: input.useProjectSession === true,
        openedByThreadId: input.openedByThreadId ?? null,
        pinned: input.pinned === true,
        usedAt: input.now,
      }),
    ],
    activeId: activate ? input.id : set.activeId,
    closed: set.closed,
  };
  return withCap(next, input.protectedIds ?? new Set());
}

export type CloseTabResult = { ok: true; set: BrowserTabSet } | { ok: false; error: string };

/** Closes a reference tab. The app tab cannot be closed. */
export function closeBrowserTab(set: BrowserTabSet, id: string, now: number): CloseTabResult {
  const target = set.tabs.find((entry) => entry.id === id);
  if (!target) return { ok: false, error: 'That tab is not open' };
  if (target.role === 'app') return { ok: false, error: 'The app tab stays open' };
  const tabs = set.tabs.filter((entry) => entry.id !== id);
  const closed = [persist(target), ...set.closed.filter((entry) => entry.id !== id)].slice(0, CLOSED_TAB_LIMIT);
  let activeId = set.activeId;
  if (activeId === id) {
    const index = set.tabs.findIndex((entry) => entry.id === id);
    const neighbor = tabs[Math.min(index, tabs.length - 1)];
    activeId = neighbor?.id ?? appTab({ ...set, tabs }).id;
  }
  return {
    ok: true,
    set: {
      tabs: tabs.map((entry) => (entry.id === activeId ? { ...entry, usedAt: now, discarded: false } : entry)),
      activeId,
      closed,
    },
  };
}

export function closeOtherBrowserTabs(set: BrowserTabSet, keepId: string): BrowserTabSet {
  const keep = set.tabs.filter((entry) => entry.role === 'app' || entry.id === keepId);
  const closed = [
    ...set.tabs.filter((entry) => entry.role !== 'app' && entry.id !== keepId).map(persist),
    ...set.closed,
  ].slice(0, CLOSED_TAB_LIMIT);
  const activeId = keep.some((entry) => entry.id === set.activeId) ? set.activeId : (keep[0]?.id ?? set.activeId);
  return { tabs: keep, activeId, closed };
}

/** Closes every unpinned tab an agent opened for `threadId`. */
export function closeAgentTabs(set: BrowserTabSet, threadId: string, now: number): BrowserTabSet {
  let current = set;
  for (const entry of set.tabs) {
    if (entry.openedByThreadId !== threadId || entry.pinned || entry.role === 'app') continue;
    const closed = closeBrowserTab(current, entry.id, now);
    if (closed.ok) current = closed.set;
  }
  return current;
}

export function activateBrowserTab(set: BrowserTabSet, id: string, now: number): BrowserTabSet {
  if (!set.tabs.some((entry) => entry.id === id)) return set;
  return withCap(
    {
      ...set,
      activeId: id,
      tabs: set.tabs.map((entry) => (entry.id === id ? { ...entry, usedAt: now, discarded: false } : entry)),
    },
    new Set([id]),
  );
}

export function moveBrowserTab(set: BrowserTabSet, id: string, index: number): BrowserTabSet {
  const from = set.tabs.findIndex((entry) => entry.id === id);
  const moving = set.tabs[from];
  if (!moving || moving.role === 'app') return set;
  const without = set.tabs.filter((entry) => entry.id !== id);
  const clamped = Math.max(1, Math.min(index, without.length));
  const tabs = [...without.slice(0, clamped), moving, ...without.slice(clamped)];
  return { ...set, tabs };
}

/**
 * Makes `id` the app tab. The previous app tab becomes a reference tab and keeps its place
 * unless it was the pinned first slot, which the new app tab takes.
 */
export function setBrowserTabRole(set: BrowserTabSet, id: string): BrowserTabSet {
  const target = set.tabs.find((entry) => entry.id === id);
  if (!target || target.role === 'app') return set;
  const tabs = set.tabs.map((entry) => {
    if (entry.id === id) return { ...entry, role: 'app' as const, useProjectSession: true, pinned: true };
    if (entry.role === 'app') return { ...entry, role: 'reference' as const, pinned: false };
    return entry;
  });
  const app = tabs.find((entry) => entry.role === 'app');
  const rest = tabs.filter((entry) => entry.role !== 'app');
  return { ...set, tabs: app ? [app, ...rest] : tabs };
}

export function duplicateBrowserTab(
  set: BrowserTabSet,
  id: string,
  newId: string,
  now: number,
  protectedIds: ReadonlySet<string> = new Set(),
): BrowserTabSet | null {
  const source = set.tabs.find((entry) => entry.id === id);
  if (!source) return null;
  return openReferenceTab(set, {
    id: newId,
    url: source.url,
    title: source.title,
    now,
    useProjectSession: source.role === 'app' ? false : source.useProjectSession,
    protectedIds,
  });
}

export function setTabSession(set: BrowserTabSet, id: string, useProjectSession: boolean): BrowserTabSet {
  return {
    ...set,
    tabs: set.tabs.map((entry) => {
      if (entry.id !== id || entry.role === 'app') return entry;
      return { ...entry, useProjectSession };
    }),
  };
}

export function pinBrowserTab(set: BrowserTabSet, id: string, pinned: boolean): BrowserTabSet {
  return {
    ...set,
    tabs: set.tabs.map((entry) => (entry.id === id && entry.role !== 'app' ? { ...entry, pinned } : entry)),
  };
}

export function patchBrowserTab(
  set: BrowserTabSet,
  id: string,
  patch: Partial<
    Pick<BrowserTabRecord, 'url' | 'title' | 'favicon' | 'loading' | 'zoom' | 'preset' | 'usedAt' | 'discarded'>
  >,
): BrowserTabSet {
  return {
    ...set,
    tabs: set.tabs.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
  };
}

export function discardBrowserTab(set: BrowserTabSet, id: string): BrowserTabSet {
  const target = set.tabs.find((entry) => entry.id === id);
  if (!target || target.role === 'app' || target.id === set.activeId) return set;
  return {
    ...set,
    tabs: set.tabs.map((entry) => (entry.id === id ? { ...entry, discarded: true } : entry)),
  };
}

/**
 * Discards the least recently used live reference tabs until the live count is within the cap.
 * The app tab, the active tab and `protectedIds` (a granted tab in a running loop) stay loaded.
 */
export function discardLeastRecent(set: BrowserTabSet, protectedIds: ReadonlySet<string>): BrowserTabSet {
  let tabs = set.tabs.map((entry) => ({ ...entry }));
  while (liveFrom(tabs).length > LIVE_TAB_CAP) {
    const victim = [...liveFrom(tabs)]
      .filter((entry) => entry.role !== 'app' && entry.id !== set.activeId && !protectedIds.has(entry.id))
      .sort((a, b) => a.usedAt - b.usedAt)[0];
    if (!victim) break;
    tabs = tabs.map((entry) => (entry.id === victim.id ? { ...entry, discarded: true } : entry));
  }
  return { ...set, tabs };
}

function liveFrom(tabs: readonly BrowserTabRecord[]): BrowserTabRecord[] {
  return tabs.filter((entry) => !entry.discarded);
}

export function reopenClosedTab(set: BrowserTabSet, id: string, now: number): BrowserTabSet | null {
  const saved = set.closed[0];
  if (!saved) return null;
  const next = openReferenceTab(
    { ...set, closed: set.closed.slice(1) },
    {
      id,
      url: saved.url,
      title: saved.title,
      now,
      useProjectSession: saved.useProjectSession,
      openedByThreadId: null,
      pinned: saved.pinned,
    },
  );
  return next;
}

function persist(entry: BrowserTabRecord): PersistedBrowserTab {
  return {
    id: entry.id,
    role: 'reference',
    url: entry.url,
    title: entry.title,
    zoom: entry.zoom,
    preset: entry.preset,
    useProjectSession: entry.useProjectSession,
    openedByThreadId: null,
    pinned: entry.pinned,
  };
}

/** `app` (default), `active`, or a tab id. */
export function resolveBrowserTarget(
  set: BrowserTabSet,
  target: string | undefined,
): { id: string; role: TabRole } | { error: string } {
  const wanted = target === undefined || target === '' || target === 'app' ? 'app' : target;
  if (wanted === 'active' || wanted === 'current') {
    const tab = activeTab(set);
    return { id: tab.id, role: tab.role };
  }
  if (wanted === 'app') {
    const tab = appTab(set);
    return { id: tab.id, role: tab.role };
  }
  const found = set.tabs.find((entry) => entry.id === wanted);
  if (!found) return { error: `Unknown tab ${wanted}` };
  return { id: found.id, role: found.role };
}
