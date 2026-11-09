import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { BrowserWindow, Session, WebContents } from 'electron';
import {
  browserTabPartition,
  closeBrowserTab,
  cycleBrowserTab,
  emptyBrowserTabs,
  LIVE_TAB_CAP,
  moveBrowserTab,
  normalizeUrl,
  openBrowserTab,
  reopenClosedBrowserTab,
  restoreBrowserTabs,
  setBrowserTabRole,
  tabToDiscard,
  activateBrowserTab,
  type BrowserTabRecord,
  type BrowserTabRole,
  type BrowserTabsSnapshot,
  type BrowserTabsState,
  type NavigationState,
  type ProjectBrowserState,
  type Rect,
  type ViewportEmulation,
} from '@arbora/shared';
import { BrowserHistory } from './browser-history.js';
import { BrowserService, type BrowserServiceEvents as PageEvents } from './browser-service.js';

export interface BrowserTabsListener {
  /** The page the window should treat as the current browser. Null when no tab is open. */
  active(page: BrowserService | null, history: BrowserHistory | null): void;
  tabs(snapshot: BrowserTabsSnapshot): void;
}

export interface BrowserTabsOptions {
  readonly window: BrowserWindow;
  readonly projectPath: string;
  readonly projectPartition: string;
  readonly preloadPath: string;
  readonly userDataPath: string;
  readonly saved: ProjectBrowserState | undefined;
  readonly prepareSession: (partition: string) => Promise<Session>;
  readonly attachInterceptor: (contents: WebContents) => () => void;
  readonly eventsFor: (owner: () => BrowserService | null) => PageEvents;
  readonly beforeDevTools: (session: Session) => Promise<boolean>;
  /** Copies an existing Figma login into the shared partition. Once per machine. */
  readonly seedReferencePartition: () => Promise<void>;
}

interface LivePage {
  readonly service: BrowserService;
  readonly history: BrowserHistory;
}

/**
 * The browser pages of one project. Every tab can close, including the last one. At most one tab
 * is the app tab. Hidden pages keep their bounds and are not shown.
 */
export class BrowserTabs {
  private model: BrowserTabsState = emptyBrowserTabs();
  private readonly pages = new Map<string, LivePage>();
  private readonly opening = new Map<string, Promise<void>>();
  private readonly sessions = new Map<string, Promise<Session>>();
  /** Most recently shown tab ids, first. */
  private recency: string[] = [];
  private readonly protectedIds = new Set<string>();
  private bounds: { rect: Rect | null; emulation: ViewportEmulation | null } = { rect: null, emulation: null };
  private listener: BrowserTabsListener | null = null;
  private hostWindow: BrowserWindow;
  private disposed = false;
  /** The restored pre-tab history file belongs to this tab. */
  private legacyHistoryTabId: string | null = null;
  private saveTimer: NodeJS.Timeout | undefined;
  private readonly saveState: (state: ProjectBrowserState) => void;

  private constructor(
    private options: BrowserTabsOptions,
    persist: (state: ProjectBrowserState) => void,
  ) {
    this.hostWindow = options.window;
    this.saveState = persist;
  }

  static async open(options: BrowserTabsOptions, persist: (state: ProjectBrowserState) => void): Promise<BrowserTabs> {
    const tabs = new BrowserTabs(options, persist);
    await options.seedReferencePartition();
    const restored = restoreBrowserTabs(options.saved, { next: () => randomUUID() });
    tabs.model = restored.state;
    if (!options.saved?.tabs && options.saved?.lastUrl) tabs.legacyHistoryTabId = restored.state.activeTabId;
    if (restored.fresh) {
      tabs.model = openBrowserTab(tabs.model, {
        id: randomUUID(),
        role: 'app',
        url: '',
        title: '',
        zoom: options.saved?.zoomFactor ?? 1,
        preset: options.saved?.preset ?? 'responsive',
        projectSession: false,
      });
    }
    const active = tabs.model.activeTabId;
    if (active) await tabs.ensureLive(active);
    tabs.persistNow();
    return tabs;
  }

  get active(): BrowserService | null {
    const id = this.model.activeTabId;
    return id ? (this.pages.get(id)?.service ?? null) : null;
  }

  get activeHistory(): BrowserHistory | null {
    const id = this.model.activeTabId;
    return id ? (this.pages.get(id)?.history ?? null) : null;
  }

  /** A running design loop can keep a heavy reference tab from being discarded. */
  protect(id: string): void {
    this.protectedIds.add(id);
  }

  unprotect(id: string): void {
    this.protectedIds.delete(id);
  }

  bind(listener: BrowserTabsListener): void {
    this.listener = listener;
    this.emit();
  }

  /** Drops the listener so a parked project does not update the window that no longer shows it. */
  unbind(): void {
    this.listener = null;
  }

  snapshot(): BrowserTabsSnapshot {
    return {
      activeTabId: this.model.activeTabId,
      closedCount: this.model.closed.length,
      tabs: this.model.tabs.map((tab) => {
        const live = this.pages.get(tab.id)?.service.getState();
        const active = tab.id === this.model.activeTabId;
        return {
          id: tab.id,
          role: tab.role,
          url: live?.url || tab.url,
          title: live?.title || tab.title,
          active,
          loading: active && (live?.loading ?? false),
          favicon: active ? (live?.favicon ?? null) : null,
          projectSession: tab.projectSession,
        };
      }),
    };
  }

  setBounds(rect: Rect | null, emulation: ViewportEmulation | null): void {
    this.bounds = { rect, emulation };
    this.showActive();
  }

  rebind(
    window: BrowserWindow,
    eventsFor: (owner: () => BrowserService | null) => PageEvents,
    attachInterceptor: (contents: WebContents) => () => void,
  ): void {
    this.hostWindow = window;
    this.options = { ...this.options, window, eventsFor, attachInterceptor };
    for (const [id, page] of this.pages) {
      page.service.rebind(
        window,
        this.wrapEvents(
          id,
          eventsFor(() => page.service),
        ),
        attachInterceptor,
      );
    }
  }

  park(): void {
    for (const page of this.pages.values()) page.service.setBounds(null, null);
  }

  async openTab(
    input: {
      url?: string | undefined;
      role?: BrowserTabRole | undefined;
      after?: string | undefined;
      /** Load the page without switching the tab the user is looking at. */
      background?: boolean | undefined;
    } = {},
  ): Promise<BrowserTabsSnapshot> {
    const role = input.role ?? 'reference';
    const url = input.url ? (normalizeUrl(input.url) ?? '') : '';
    const previous = this.model.activeTabId;
    const record: BrowserTabRecord = {
      id: randomUUID(),
      role,
      url,
      title: '',
      zoom: 1,
      preset: 'responsive',
      projectSession: false,
    };
    this.model = openBrowserTab(this.model, record);
    if (input.after && role !== 'app') {
      const index = this.model.tabs.findIndex((tab) => tab.id === input.after);
      if (index >= 0) this.model = moveBrowserTab(this.model, record.id, index + 1);
    }
    await this.ensureLive(record.id);
    if (input.background && previous && previous !== record.id) {
      this.model = activateBrowserTab(this.model, previous);
    }
    this.finishSwitch();
    return this.snapshot();
  }

  async closeTab(id?: string): Promise<BrowserTabsSnapshot> {
    const target = id ?? this.model.activeTabId;
    if (!target) return this.snapshot();
    this.destroyPage(target);
    this.model = closeBrowserTab(this.model, target);
    this.protectedIds.delete(target);
    const active = this.model.activeTabId;
    if (active) await this.ensureLive(active);
    this.finishSwitch();
    return this.snapshot();
  }

  async activate(id: string): Promise<BrowserTabsSnapshot> {
    const next = activateBrowserTab(this.model, id);
    if (next === this.model) return this.snapshot();
    this.model = next;
    await this.ensureLive(id);
    this.finishSwitch();
    return this.snapshot();
  }

  move(id: string, toIndex: number): BrowserTabsSnapshot {
    this.model = moveBrowserTab(this.model, id, toIndex);
    this.finishSwitch();
    return this.snapshot();
  }

  async setRole(id: string, role: BrowserTabRole): Promise<BrowserTabsSnapshot> {
    const before = this.model.tabs.find((tab) => tab.id === id);
    if (!before) return this.snapshot();
    const next = setBrowserTabRole(this.model, id, role);
    if (next === this.model) return this.snapshot();
    const partitionBefore = browserTabPartition(before, this.options.projectPartition);
    this.model = next;
    const after = this.model.tabs.find((tab) => tab.id === id);
    if (after && browserTabPartition(after, this.options.projectPartition) !== partitionBefore) {
      this.destroyPage(id);
      if (this.model.activeTabId === id) await this.ensureLive(id);
    }
    this.finishSwitch();
    return this.snapshot();
  }

  async setProjectSession(id: string, projectSession: boolean): Promise<BrowserTabsSnapshot> {
    const tab = this.model.tabs.find((item) => item.id === id);
    if (!tab || tab.role === 'app' || tab.projectSession === projectSession) return this.snapshot();
    this.model = {
      ...this.model,
      tabs: this.model.tabs.map((item) => (item.id === id ? { ...item, projectSession } : item)),
    };
    this.destroyPage(id);
    if (this.model.activeTabId === id) await this.ensureLive(id);
    this.finishSwitch();
    return this.snapshot();
  }

  async duplicate(id: string): Promise<BrowserTabsSnapshot> {
    const tab = this.model.tabs.find((item) => item.id === id);
    if (!tab) return this.snapshot();
    return this.openTab({ url: tab.url, role: 'reference', after: id });
  }

  async closeOthers(id: string): Promise<BrowserTabsSnapshot> {
    const ids = this.model.tabs.filter((tab) => tab.id !== id).map((tab) => tab.id);
    for (const other of ids) {
      this.destroyPage(other);
      this.model = closeBrowserTab(this.model, other);
      this.protectedIds.delete(other);
    }
    if (this.model.tabs.some((tab) => tab.id === id)) this.model = activateBrowserTab(this.model, id);
    const active = this.model.activeTabId;
    if (active) await this.ensureLive(active);
    this.finishSwitch();
    return this.snapshot();
  }

  async reopen(): Promise<BrowserTabsSnapshot> {
    const next = reopenClosedBrowserTab(this.model);
    if (next === this.model) return this.snapshot();
    this.model = next;
    const active = this.model.activeTabId;
    if (active) await this.ensureLive(active);
    this.finishSwitch();
    return this.snapshot();
  }

  async cycle(direction: 1 | -1): Promise<BrowserTabsSnapshot> {
    const id = cycleBrowserTab(this.model, direction);
    if (!id || id === this.model.activeTabId) return this.snapshot();
    return this.activate(id);
  }

  /**
   * A dev-server URL. It loads the app tab when that tab is empty, and opens an app tab when
   * the project has none.
   */
  suggestDevUrl(input: string): boolean {
    const url = normalizeUrl(input);
    if (!url) return false;
    const app = this.model.tabs.find((tab) => tab.role === 'app');
    if (!app) {
      void this.openTab({ url, role: 'app' });
      return true;
    }
    const page = this.pages.get(app.id);
    if (!page) {
      this.model = {
        ...this.model,
        tabs: this.model.tabs.map((tab) => (tab.id === app.id && !tab.url ? { ...tab, url } : tab)),
      };
      this.persistNow();
      this.emit();
      return false;
    }
    return page.service.suggestUrl(url);
  }

  page(id: string): BrowserService | null {
    return this.pages.get(id)?.service ?? null;
  }

  /** Loads a tab without making it the one on screen, so an agent can read a background page. */
  async retain(id: string): Promise<BrowserService | null> {
    if (!this.tabStillOpen(id)) return null;
    await this.ensureLive(id, false);
    this.showActive();
    return this.pages.get(id)?.service ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.saveTimer);
    this.listener = null;
    for (const id of [...this.pages.keys()]) this.destroyPage(id);
  }

  private finishSwitch(): void {
    if (this.model.activeTabId) this.touch(this.model.activeTabId);
    this.showActive();
    this.persistNow();
    this.emit();
  }

  private emit(): void {
    if (!this.listener || this.disposed) return;
    this.listener.tabs(this.snapshot());
    const active = this.active;
    this.listener.active(active, this.activeHistory);
  }

  private showActive(): void {
    const { rect, emulation } = this.bounds;
    for (const [id, page] of this.pages) {
      page.service.setBounds(
        id === this.model.activeTabId ? rect : null,
        id === this.model.activeTabId ? emulation : null,
      );
    }
  }

  /** True while this tab should still get a page. A dispose during `await` flips it. */
  private tabStillOpen(id: string): boolean {
    return !this.disposed && this.model.tabs.some((item) => item.id === id);
  }

  private async ensureLive(id: string, touch = true): Promise<void> {
    if (this.pages.has(id)) {
      if (touch) this.touch(id);
      return;
    }
    const pending = this.opening.get(id);
    if (pending) return pending;
    const created = this.createPage(id).finally(() => this.opening.delete(id));
    this.opening.set(id, created);
    await created;
    if (!this.pages.has(id)) return;
    if (touch) this.touch(id);
    else this.recency = [...this.recency.filter((item) => item !== id), id];
  }

  private async createPage(id: string): Promise<void> {
    const tab = this.model.tabs.find((item) => item.id === id);
    if (!tab || this.disposed) return;
    const partition = browserTabPartition(tab, this.options.projectPartition);
    const browserSession = await this.sessionFor(partition);
    if (!this.tabStillOpen(id)) return;
    const history = new BrowserHistory(this.historyPath(id, partition));
    const holder: { current: BrowserService | null } = { current: null };
    const inner = this.options.eventsFor(() => holder.current);
    const service = new BrowserService({
      window: this.hostWindow,
      session: browserSession,
      preloadPath: this.options.preloadPath,
      projectPath: this.options.projectPath,
      history,
      initial: {
        ...(tab.url ? { lastUrl: tab.url } : {}),
        preset: tab.preset,
        zoomFactor: tab.zoom,
      },
      events: this.wrapEvents(id, inner),
      attachInterceptor: this.options.attachInterceptor,
      saveState: (slice) => this.rememberSaved(id, slice),
      beforeDevTools: () => this.options.beforeDevTools(browserSession),
      openReferenceTab: (url) => {
        void this.openTab({ url, role: 'reference', after: id });
      },
    });
    holder.current = service;
    this.pages.set(id, { service, history });
    this.discardOverflow();
  }

  private wrapEvents(id: string, inner: PageEvents): PageEvents {
    return {
      ...inner,
      state: (state) => {
        this.rememberState(id, state);
        inner.state(state);
      },
    };
  }

  private sessionFor(partition: string): Promise<Session> {
    let pending = this.sessions.get(partition);
    if (!pending) {
      pending = this.options.prepareSession(partition);
      this.sessions.set(partition, pending);
    }
    return pending;
  }

  private historyPath(tabId: string, partition: string): string {
    const folder = partition.replace(/^persist:/, '');
    if (tabId === this.legacyHistoryTabId) return join(this.options.userDataPath, 'browser', folder, 'history.json');
    return join(this.options.userDataPath, 'browser', folder, 'tabs', `${tabId}.json`);
  }

  private rememberState(id: string, state: NavigationState): void {
    const tab = this.model.tabs.find((item) => item.id === id);
    if (!tab) return;
    if (
      tab.title === state.title &&
      tab.url === state.url &&
      tab.preset === state.preset &&
      tab.zoom === state.zoomFactor
    ) {
      return;
    }
    this.model = {
      ...this.model,
      tabs: this.model.tabs.map((item) =>
        item.id === id
          ? {
              ...item,
              title: state.title,
              url: state.url || item.url,
              preset: state.preset,
              zoom: state.zoomFactor,
            }
          : item,
      ),
    };
    this.scheduleSave();
    if (this.listener && !this.disposed) this.listener.tabs(this.snapshot());
  }

  private rememberSaved(id: string, slice: ProjectBrowserState): void {
    const tab = this.model.tabs.find((item) => item.id === id);
    if (!tab) return;
    this.model = {
      ...this.model,
      tabs: this.model.tabs.map((item) =>
        item.id === id
          ? {
              ...item,
              ...(slice.lastUrl ? { url: slice.lastUrl } : {}),
              preset: slice.preset,
              zoom: slice.zoomFactor,
            }
          : item,
      ),
    };
    this.scheduleSave();
  }

  private discardOverflow(): void {
    const protectedIds = new Set(this.protectedIds);
    if (this.model.activeTabId) protectedIds.add(this.model.activeTabId);
    const victim = tabToDiscard(this.model.tabs, this.recency, protectedIds, this.pages.size, LIVE_TAB_CAP);
    if (victim) this.destroyPage(victim);
  }

  private destroyPage(id: string): void {
    const page = this.pages.get(id);
    if (!page) return;
    this.pages.delete(id);
    page.service.dispose();
    page.history.dispose();
  }

  private touch(id: string): void {
    this.recency = [id, ...this.recency.filter((item) => item !== id)];
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persistNow(), 500);
  }

  private persistNow(): void {
    this.saveTimer = undefined;
    if (this.disposed) return;
    const tabs = this.model.tabs.map((tab) => {
      const live = this.pages.get(tab.id)?.service.getState();
      if (!live) return tab;
      return {
        ...tab,
        url: live.url || tab.url,
        title: live.title || tab.title,
        preset: live.preset,
        zoom: live.zoomFactor,
      };
    });
    this.model = { ...this.model, tabs };
    const active = tabs.find((tab) => tab.id === this.model.activeTabId);
    const url = active?.url;
    this.saveState({
      tabs,
      activeTabId: this.model.activeTabId,
      ...(url ? { lastUrl: url } : {}),
      preset: active?.preset ?? 'responsive',
      zoomFactor: active?.zoom ?? 1,
    });
  }
}
