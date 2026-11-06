import { z } from 'zod';
import { isLocalHostname, viewportPresetIdSchema, type NavigationState, type ViewportPresetId } from './browser.js';

/** Shared persistent session for reference tabs (Figma, docs, production). */
export const REFERENCE_PARTITION = 'persist:arbora-web';

export const BROWSER_TAB_ROLES = ['app', 'reference'] as const;
export const browserTabRoleSchema = z.enum(BROWSER_TAB_ROLES);
export type BrowserTabRole = z.infer<typeof browserTabRoleSchema>;

export const browserTabRecordSchema = z.object({
  id: z.string().min(1),
  role: browserTabRoleSchema,
  url: z.string(),
  title: z.string().default(''),
  zoom: z.number().min(0.25).max(5).default(1),
  preset: viewportPresetIdSchema.default('responsive'),
  projectSession: z.boolean().default(false),
});

/** A browser tab remembered for a project. The live page is created separately. */
export interface BrowserTabRecord {
  id: string;
  role: BrowserTabRole;
  url: string;
  title: string;
  zoom: number;
  preset: ViewportPresetId;
  /** A reference tab that uses the project partition instead of the shared web partition. */
  projectSession: boolean;
}

export interface ClosedBrowserTab {
  tab: BrowserTabRecord;
  /** Index the tab occupied, so reopen puts it back. */
  index: number;
}

export interface BrowserTabsState {
  tabs: BrowserTabRecord[];
  activeTabId: string | null;
  closed: ClosedBrowserTab[];
}

/** Live pages kept at once. Further reference tabs are discarded and reload on focus. */
export const LIVE_TAB_CAP = 12;
const CLOSED_TAB_LIMIT = 16;

export function emptyBrowserTabs(): BrowserTabsState {
  return { tabs: [], activeTabId: null, closed: [] };
}

function copyTab(tab: BrowserTabRecord): BrowserTabRecord {
  return { ...tab };
}

function copyState(state: BrowserTabsState): BrowserTabsState {
  return {
    tabs: state.tabs.map(copyTab),
    activeTabId: state.activeTabId,
    closed: state.closed.map((entry) => ({ tab: copyTab(entry.tab), index: entry.index })),
  };
}

function pinAppTab(tabs: BrowserTabRecord[]): BrowserTabRecord[] {
  const appIndex = tabs.findIndex((tab) => tab.role === 'app');
  if (appIndex <= 0) return tabs;
  const [app] = tabs.splice(appIndex, 1);
  if (app) tabs.unshift(app);
  return tabs;
}

/** Opens `tab` and activates it. An app tab replaces the previous one and stays first. */
export function openBrowserTab(state: BrowserTabsState, tab: BrowserTabRecord): BrowserTabsState {
  const next = copyState(state);
  const opening: BrowserTabRecord = {
    ...tab,
    projectSession: tab.role === 'app' ? false : tab.projectSession,
  };
  if (opening.role === 'app') {
    next.tabs = next.tabs.map((item) => (item.role === 'app' ? { ...item, role: 'reference' } : item));
    next.tabs.unshift(opening);
  } else {
    next.tabs.push(opening);
  }
  next.activeTabId = opening.id;
  return next;
}

/** Closes any tab, including the last one. Closing the app tab does not promote another tab. */
export function closeBrowserTab(state: BrowserTabsState, id: string): BrowserTabsState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return state;
  const next = copyState(state);
  const [removed] = next.tabs.splice(index, 1);
  if (!removed) return state;
  next.closed = [{ tab: removed, index }, ...next.closed].slice(0, CLOSED_TAB_LIMIT);
  if (next.activeTabId === id) {
    next.activeTabId = next.tabs[index]?.id ?? next.tabs[index - 1]?.id ?? null;
  }
  return next;
}

export function activateBrowserTab(state: BrowserTabsState, id: string): BrowserTabsState {
  if (!state.tabs.some((tab) => tab.id === id) || state.activeTabId === id) return state;
  const next = copyState(state);
  next.activeTabId = id;
  return next;
}

/** Reorders a tab. The app tab stays at the front, so a reference tab cannot pass it. */
export function moveBrowserTab(state: BrowserTabsState, id: string, toIndex: number): BrowserTabsState {
  const from = state.tabs.findIndex((tab) => tab.id === id);
  if (from < 0) return state;
  const next = copyState(state);
  const [moving] = next.tabs.splice(from, 1);
  if (!moving) return state;
  let index = Math.max(0, Math.min(toIndex, next.tabs.length));
  if (moving.role === 'app') index = 0;
  else if (next.tabs[0]?.role === 'app' && index === 0) index = 1;
  next.tabs.splice(index, 0, moving);
  return next;
}

/** Makes `id` the app tab, or turns it into a reference tab. There is still at most one app tab. */
export function setBrowserTabRole(state: BrowserTabsState, id: string, role: BrowserTabRole): BrowserTabsState {
  const target = state.tabs.find((tab) => tab.id === id);
  if (!target || target.role === role) return state;
  const next = copyState(state);
  if (role === 'app') {
    next.tabs = next.tabs.map((tab) => {
      if (tab.id === id) return { ...tab, role: 'app', projectSession: false };
      if (tab.role === 'app') return { ...tab, role: 'reference' };
      return tab;
    });
    pinAppTab(next.tabs);
  } else {
    next.tabs = next.tabs.map((tab) => (tab.id === id ? { ...tab, role: 'reference' } : tab));
  }
  return next;
}

export function reopenClosedBrowserTab(state: BrowserTabsState): BrowserTabsState {
  const [entry, ...rest] = state.closed;
  if (!entry) return state;
  const next = copyState(state);
  next.closed = rest;
  let restored = copyTab(entry.tab);
  if (restored.role === 'app' && next.tabs.some((tab) => tab.role === 'app')) {
    restored = { ...restored, role: 'reference' };
  }
  if (restored.role === 'app') {
    next.tabs.unshift(restored);
  } else {
    let index = Math.max(0, Math.min(entry.index, next.tabs.length));
    if (next.tabs[0]?.role === 'app' && index === 0) index = 1;
    next.tabs.splice(index, 0, restored);
  }
  next.activeTabId = restored.id;
  return next;
}

/**
 * The reference tab to unload when more than `cap` pages are live.
 * `recency` is most-recent first. The app tab, the active tab, and `protectedIds`
 * (a grant, or a tab a running loop is using) are never discarded.
 */
export function tabToDiscard(
  tabs: readonly BrowserTabRecord[],
  recency: readonly string[],
  protectedIds: ReadonlySet<string>,
  liveCount: number,
  cap: number,
): string | null {
  if (liveCount <= cap) return null;
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const active = recency[0];
  for (let i = recency.length - 1; i >= 0; i -= 1) {
    const id = recency[i];
    if (!id || id === active || protectedIds.has(id)) continue;
    const tab = byId.get(id);
    if (!tab || tab.role === 'app') continue;
    return id;
  }
  return null;
}

export type AgentTabResolution = { ok: true; id: string } | { ok: false; error: string };

/**
 * The page an agent tool acts on. An omitted target is the app tab. A reference tab is refused
 * until its id is in `grantedIds`. The app tab is always allowed.
 */
export function resolveAgentTab(
  tabs: readonly { id: string; role: BrowserTabRole }[],
  activeTabId: string | null,
  grantedIds: ReadonlySet<string>,
  target: string | undefined,
): AgentTabResolution {
  const wanted = !target || target === 'app' ? 'app' : target === 'current' || target === 'active' ? 'active' : target;
  const tab =
    wanted === 'app'
      ? tabs.find((item) => item.role === 'app')
      : wanted === 'active'
        ? tabs.find((item) => item.id === activeTabId)
        : tabs.find((item) => item.id === wanted);
  if (!tab) {
    return {
      ok: false,
      error:
        wanted === 'app'
          ? 'This project has no app tab.'
          : wanted === 'active'
            ? 'No browser tab is open.'
            : `Unknown tab ${wanted}.`,
    };
  }
  if (tab.role === 'reference' && !grantedIds.has(tab.id)) return { ok: false, error: 'tab not granted' };
  return { ok: true, id: tab.id };
}

/** Non-local cookie domains move to the shared reference partition. Loopback stays per project. */
export function cookieBelongsOnReferencePartition(domain: string): boolean {
  const host = domain.trim().replace(/^\./, '').toLowerCase();
  if (host.length === 0) return false;
  return !isLocalHostname(host);
}

export function cookiesForReferencePartition<T extends { domain?: string }>(cookies: readonly T[]): T[] {
  return cookies.filter((cookie) => cookie.domain !== undefined && cookieBelongsOnReferencePartition(cookie.domain));
}

/**
 * Fields for `cookies.set` on the shared partition. `__Host-` cookies are rejected when a Domain
 * attribute is present, so a Figma login cookie stays host-only.
 */
export function referenceCookieWrite(cookie: {
  name: string;
  domain?: string | undefined;
  path?: string | undefined;
  secure?: boolean | undefined;
}): { url: string; path: string; domain?: string } | null {
  const host = cookie.domain?.replace(/^\./, '');
  if (!host) return null;
  const hostOnly = cookie.name.startsWith('__Host-');
  const path = hostOnly ? '/' : cookie.path || '/';
  return {
    url: `${cookie.secure || hostOnly ? 'https:' : 'http:'}//${host}${path}`,
    path,
    ...(hostOnly || !cookie.domain ? {} : { domain: cookie.domain }),
  };
}

export interface SavedBrowserTabs {
  lastUrl?: string | undefined;
  preset?: ViewportPresetId | undefined;
  zoomFactor?: number | undefined;
  tabs?: BrowserTabRecord[] | undefined;
  activeTabId?: string | null | undefined;
}

export interface RestoredBrowserTabs {
  readonly state: BrowserTabsState;
  /** True when the project has never stored a tab list, so the caller opens one app tab. */
  readonly fresh: boolean;
}

/**
 * Restores a tab list. A missing record is a first open. A stored empty list is an empty browser.
 * A pre-tab `lastUrl` becomes one app tab. A saved list keeps a single app tab, pinned first.
 */
export function restoreBrowserTabs(
  saved: SavedBrowserTabs | undefined,
  ids: { next: () => string },
): RestoredBrowserTabs {
  if (saved?.tabs) {
    let seenApp = false;
    const normalized = saved.tabs.map((tab) => {
      if (tab.role !== 'app') return copyTab(tab);
      if (seenApp) return { ...tab, role: 'reference' as const };
      seenApp = true;
      return { ...tab, projectSession: false };
    });
    const app = normalized.find((tab) => tab.role === 'app');
    const tabs = app ? [app, ...normalized.filter((tab) => tab !== app)] : normalized;
    const activeTabId = tabs.some((tab) => tab.id === saved.activeTabId)
      ? (saved.activeTabId ?? null)
      : (tabs[0]?.id ?? null);
    return { state: { tabs, activeTabId, closed: [] }, fresh: false };
  }
  if (saved?.lastUrl) {
    const id = ids.next();
    const restored = tabRecord({
      id,
      role: 'app',
      url: saved.lastUrl,
      zoom: saved.zoomFactor ?? 1,
      preset: saved.preset ?? 'responsive',
    });
    return { state: { tabs: [restored], activeTabId: id, closed: [] }, fresh: false };
  }
  return { state: emptyBrowserTabs(), fresh: saved === undefined };
}

/** The app tab, and a reference tab that opted in, use the project partition. */
export function browserTabPartition(
  tab: Pick<BrowserTabRecord, 'role' | 'projectSession'>,
  projectPartition: string,
  referencePartition: string = REFERENCE_PARTITION,
): string {
  return tab.role === 'app' || tab.projectSession ? projectPartition : referencePartition;
}

/** The tab `direction` steps away from the active one, wrapping. Null when there is nothing to show. */
export function cycleBrowserTab(state: BrowserTabsState, direction: 1 | -1): string | null {
  if (state.tabs.length === 0) return null;
  const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  const start = index < 0 ? 0 : index;
  const next = (start + direction + state.tabs.length) % state.tabs.length;
  return state.tabs[next]?.id ?? null;
}

export const browserTabSnapshotSchema = z.object({
  id: z.string(),
  role: browserTabRoleSchema,
  url: z.string(),
  title: z.string(),
  active: z.boolean(),
  loading: z.boolean(),
  favicon: z.string().nullable(),
  projectSession: z.boolean(),
});
export type BrowserTabSnapshot = z.infer<typeof browserTabSnapshotSchema>;

export const browserTabsSnapshotSchema = z.object({
  tabs: z.array(browserTabSnapshotSchema),
  activeTabId: z.string().nullable(),
  closedCount: z.number().int().nonnegative(),
});
export type BrowserTabsSnapshot = z.infer<typeof browserTabsSnapshotSchema>;

/** Navigation state when no browser tab is open. The panel uses the tab list to tell this from a blank tab. */
export function emptyNavigation(): NavigationState {
  return {
    url: '',
    title: '',
    favicon: null,
    canGoBack: false,
    canGoForward: false,
    loading: false,
    zoomFactor: 1,
    preset: 'responsive',
    devToolsOpen: false,
    error: null,
    pageReady: false,
  };
}

function tabRecord(patch: Partial<BrowserTabRecord> & Pick<BrowserTabRecord, 'id' | 'role' | 'url'>): BrowserTabRecord {
  return {
    title: '',
    zoom: 1,
    preset: 'responsive',
    projectSession: false,
    ...patch,
  };
}
