import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { type BrowserWindow, type Session, type WebContents } from 'electron';
import {
  activateBrowserTab,
  activeTab,
  appTab,
  browserTabSnapshots,
  closeAgentTabs,
  closeBrowserTab,
  closeOtherBrowserTabs,
  discardBrowserTab,
  duplicateBrowserTab,
  moveBrowserTab,
  openReferenceTab,
  patchBrowserTab,
  persistedBrowserTabs,
  pinBrowserTab,
  reopenClosedTab,
  resolveBrowserTarget,
  restoreBrowserTabSet,
  setBrowserTabRole,
  setTabSession,
  windowOpenNeedsOpener,
  type BrowserTabRecord,
  type BrowserTabSet,
  type BrowserTabSnapshot,
  type NavigationState,
  type ProblemEntry,
  type ProjectBrowserState,
  type Rect,
  type TabRole,
  type ViewportEmulation,
} from '@arbora/shared';
import { BrowserHistory } from './browser-history.js';
import { BrowserService, type BrowserServiceEvents, type WindowOpenDecision } from './browser-service.js';

export const WEB_PARTITION = 'persist:arbora-web';

export interface BrowserTabsHooks {
  state(state: NavigationState): void;
  problemsAdded(entries: ProblemEntry[]): void;
  problemsCleared(): void;
  urlSuggested(url: string): void;
  inspectorSelected: BrowserServiceEvents['inspectorSelected'];
  inspectorCancelled(): void;
  designState: BrowserServiceEvents['designState'];
  designExitRequested(): void;
  designNavigationBlocked(url: string): void;
  designDocumentNavigated(): void;
  pageFocused(focused: boolean): void;
  focusParked(): void;
  tabsChanged(tabs: BrowserTabSnapshot[]): void;
  passwordOffer(offer: { origin: string; usernameField: string | null; passwordField: string; tabId: string }): void;
}

export interface BrowserTabsOptions {
  readonly window: BrowserWindow;
  readonly projectPath: string;
  readonly projectPartition: string;
  readonly preloadPath: string;
  readonly historyRoot: string;
  readonly initial: ProjectBrowserState | undefined;
  readonly prepareSession: (partition: string) => Promise<Session>;
  readonly attachInterceptor: (contents: WebContents) => () => void;
  readonly saveState: (state: ProjectBrowserState) => void;
  readonly beforeDevTools: (session: Session) => Promise<boolean>;
  readonly openLinksInTabs: () => boolean;
  readonly protectedIds: () => ReadonlySet<string>;
  readonly hooks: BrowserTabsHooks;
}

interface Slot {
  service: BrowserService | null;
  history: BrowserHistory;
  partition: string;
  popups: BrowserWindow[];
}

/**
 * The browser tabs of one project on one window. Each live tab is a `BrowserService`. Discarded
 * tabs keep their URL and reload the next time they are shown or an agent tool addresses them.
 */
export class BrowserTabs {
  private hostWindow: BrowserWindow;
  private hooks: BrowserTabsHooks;
  private set: BrowserTabSet;
  private readonly slots = new Map<string, Slot>();
  private disposed = false;

  constructor(private readonly options: BrowserTabsOptions) {
    this.hostWindow = options.window;
    this.hooks = options.hooks;
    this.set = restoreBrowserTabSet({
      tabs: options.initial?.tabs,
      activeTabId: options.initial?.activeTabId,
      lastUrl: options.initial?.lastUrl,
      preset: options.initial?.preset,
      zoom: options.initial?.zoomFactor,
      now: Date.now(),
      id: () => randomUUID(),
    });
  }

  async start(): Promise<void> {
    await this.materialize(activeTab(this.set), true);
    this.layout();
    this.publish();
  }

  activeService(): BrowserService | null {
    return this.slots.get(this.set.activeId)?.service ?? null;
  }

  appService(): BrowserService | null {
    return this.slots.get(appTab(this.set).id)?.service ?? null;
  }

  serviceFor(id: string): BrowserService | null {
    return this.slots.get(id)?.service ?? null;
  }

  serviceForContents(contents: WebContents): BrowserService | undefined {
    for (const slot of this.slots.values()) {
      if (slot.service && !slot.service.contents.isDestroyed() && slot.service.contents === contents)
        return slot.service;
    }
    return undefined;
  }

  snapshots(): BrowserTabSnapshot[] {
    return browserTabSnapshots(this.set);
  }

  historyEntries() {
    const merged = new Map<string, { url: string; title: string; visitedAt: number }>();
    for (const slot of this.slots.values()) {
      for (const entry of slot.history.list()) {
        const previous = merged.get(entry.url);
        if (!previous || entry.visitedAt > previous.visitedAt) merged.set(entry.url, entry);
      }
    }
    return [...merged.values()].sort((a, b) => b.visitedAt - a.visitedAt);
  }

  /** Loads `url` into the app tab when it is empty. Does not switch away from a reference tab. */
  suggestUrl(url: string): boolean {
    const app = appTab(this.set);
    const service = this.slots.get(app.id)?.service;
    if (!service) {
      void this.materialize(app, false).then((created) => {
        created.suggestUrl(url);
      });
      return true;
    }
    return service.suggestUrl(url);
  }

  async open(
    url: string,
    opts: {
      activate?: boolean;
      useProjectSession?: boolean;
      openedByThreadId?: string | null;
      pinned?: boolean;
    } = {},
  ): Promise<string> {
    const id = randomUUID();
    this.set = openReferenceTab(this.set, {
      id,
      url,
      now: Date.now(),
      activate: opts.activate !== false,
      ...(opts.useProjectSession !== undefined ? { useProjectSession: opts.useProjectSession } : {}),
      ...(opts.openedByThreadId !== undefined ? { openedByThreadId: opts.openedByThreadId } : {}),
      ...(opts.pinned !== undefined ? { pinned: opts.pinned } : {}),
      protectedIds: this.options.protectedIds(),
    });
    await this.syncSlots();
    this.layout();
    this.publish();
    return id;
  }

  close(id: string): { ok: true } | { ok: false; error: string } {
    const result = closeBrowserTab(this.set, id, Date.now());
    if (!result.ok) return result;
    this.set = result.set;
    this.dropSlot(id);
    this.layout();
    this.publish();
    return { ok: true };
  }

  closeOthers(id: string): void {
    const removed = this.set.tabs.filter((entry) => entry.role !== 'app' && entry.id !== id).map((entry) => entry.id);
    this.set = closeOtherBrowserTabs(this.set, id);
    for (const tabId of removed) this.dropSlot(tabId);
    this.layout();
    this.publish();
  }

  closeOpenedBy(threadId: string): void {
    const before = new Set(this.set.tabs.map((entry) => entry.id));
    this.set = closeAgentTabs(this.set, threadId, Date.now());
    for (const id of before) if (!this.set.tabs.some((entry) => entry.id === id)) this.dropSlot(id);
    this.layout();
    this.publish();
  }

  async activate(id: string): Promise<void> {
    if (!this.set.tabs.some((entry) => entry.id === id)) return;
    this.set = activateBrowserTab(this.set, id, Date.now());
    await this.syncSlots();
    this.layout();
    this.publish();
  }

  async activateApp(): Promise<void> {
    await this.activate(appTab(this.set).id);
  }

  move(id: string, index: number): void {
    this.set = moveBrowserTab(this.set, id, index);
    this.publish();
  }

  async setRole(id: string, role: TabRole): Promise<void> {
    if (role === 'reference') return;
    const before = this.partitionFor(this.set.tabs.find((entry) => entry.id === id) ?? appTab(this.set));
    this.set = setBrowserTabRole(this.set, id);
    const after = this.set.tabs.find((entry) => entry.id === id);
    if (after && this.partitionFor(after) !== before) await this.recreate(after);
    this.layout();
    this.publish();
  }

  async duplicate(id: string): Promise<string | null> {
    const newId = randomUUID();
    const next = duplicateBrowserTab(this.set, id, newId, Date.now(), this.options.protectedIds());
    if (!next) return null;
    this.set = next;
    await this.syncSlots();
    this.layout();
    this.publish();
    return newId;
  }

  async setUseProjectSession(id: string, useProjectSession: boolean): Promise<void> {
    const before = this.set.tabs.find((entry) => entry.id === id);
    if (!before || before.role === 'app' || before.useProjectSession === useProjectSession) return;
    this.set = setTabSession(this.set, id, useProjectSession);
    const after = this.set.tabs.find((entry) => entry.id === id);
    if (after) await this.recreate(after);
    this.publish();
  }

  pin(id: string, pinned: boolean): void {
    this.set = pinBrowserTab(this.set, id, pinned);
    this.publish();
  }

  discard(id: string): void {
    this.set = discardBrowserTab(this.set, id);
    const slot = this.slots.get(id);
    if (slot?.service) {
      slot.service.dispose();
      slot.service = null;
    }
    this.publish();
  }

  async reopen(): Promise<string | null> {
    const next = reopenClosedTab(this.set, randomUUID(), Date.now());
    if (!next) return null;
    this.set = next;
    await this.syncSlots();
    this.layout();
    this.publish();
    return this.set.activeId;
  }

  get projectPath(): string {
    return this.options.projectPath;
  }

  /** The thread that opened this tab, null when the user did, undefined when the id is unknown. */
  openedBy(id: string): string | null | undefined {
    return this.set.tabs.find((entry) => entry.id === id)?.openedByThreadId;
  }

  /**
   * The tab a tool named. A hidden tab is loaded but not shown. Throws when the id is unknown.
   */
  async resolve(target: string | undefined): Promise<{ id: string; role: TabRole; service: BrowserService }> {
    const resolved = resolveBrowserTarget(this.set, target);
    if ('error' in resolved) throw new Error(resolved.error);
    const record = this.set.tabs.find((entry) => entry.id === resolved.id);
    if (!record) throw new Error('Unknown tab');
    const show = record.id === this.set.activeId;
    const service = await this.materialize(record, show);
    if (!show) {
      this.set = patchBrowserTab(this.set, record.id, { usedAt: Date.now() });
      this.park(service);
    }
    return { id: record.id, role: record.role, service };
  }

  noteClosed(id: string): void {
    if (this.set.tabs.some((entry) => entry.id === id)) return;
    this.dropSlot(id);
  }

  rebind(
    window: BrowserWindow,
    hooks: BrowserTabsHooks,
    attachInterceptor: (contents: WebContents) => () => void,
  ): void {
    this.hostWindow = window;
    this.hooks = hooks;
    for (const [id, slot] of this.slots) {
      slot.service?.rebind(window, this.eventsFor(id), attachInterceptor);
    }
    this.layout();
  }

  setBounds(rect: Rect | null, emulation: ViewportEmulation | null): void {
    this.bounds = { rect, emulation };
    this.layout();
  }

  private bounds: { rect: Rect | null; emulation: ViewportEmulation | null } = { rect: null, emulation: null };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of [...this.slots.keys()]) this.dropSlot(id);
  }

  private async syncSlots(): Promise<void> {
    for (const record of this.set.tabs) {
      if (record.discarded) {
        const slot = this.slots.get(record.id);
        if (slot?.service) {
          slot.service.dispose();
          slot.service = null;
        }
        continue;
      }
      await this.materialize(record, record.id === this.set.activeId);
    }
  }

  private async materialize(record: BrowserTabRecord, visible: boolean): Promise<BrowserService> {
    const partition = this.partitionFor(record);
    let slot = this.slots.get(record.id);
    if (slot?.service && slot.partition === partition) {
      if (!record.discarded && record.id === this.set.activeId) {
        this.set = patchBrowserTab(this.set, record.id, { discarded: false });
      }
      return slot.service;
    }
    if (slot?.service) {
      slot.service.dispose();
      slot.service = null;
    }
    const session = await this.options.prepareSession(partition);
    const history =
      slot?.history ??
      new BrowserHistory(join(this.options.historyRoot, partition.replace(/^persist:/, ''), `${record.id}.json`));
    const service = new BrowserService({
      window: this.hostWindow,
      session,
      preloadPath: this.options.preloadPath,
      projectPath: this.options.projectPath,
      history,
      initial: {
        ...(record.url ? { lastUrl: record.url } : {}),
        preset: record.preset,
        zoomFactor: record.zoom,
      },
      events: this.eventsFor(record.id),
      attachInterceptor: (page) => this.options.attachInterceptor(page),
      saveState: (state) => this.onServiceState(record.id, state),
      beforeDevTools: () => this.options.beforeDevTools(session),
      onWindowOpen: (details) => this.onWindowOpen(record.id, details),
      onChildWindow: (child) => this.slots.get(record.id)?.popups.push(child),
    });
    slot = { service, history, partition, popups: slot?.popups ?? [] };
    this.slots.set(record.id, slot);
    this.set = patchBrowserTab(this.set, record.id, { discarded: false });
    if (!visible) this.park(service);
    return service;
  }

  private async recreate(record: BrowserTabRecord): Promise<void> {
    const slot = this.slots.get(record.id);
    if (!slot?.service) return;
    slot.service.dispose();
    slot.service = null;
    await this.materialize(record, record.id === this.set.activeId);
    this.layout();
  }

  private partitionFor(record: { role: TabRole; useProjectSession: boolean }): string {
    if (record.role === 'app' || record.useProjectSession) return this.options.projectPartition;
    return WEB_PARTITION;
  }

  private onServiceState(id: string, state: ProjectBrowserState): void {
    this.set = patchBrowserTab(this.set, id, {
      ...(state.lastUrl !== undefined ? { url: state.lastUrl } : {}),
      preset: state.preset,
      zoom: state.zoomFactor,
    });
    this.persist();
  }

  private onWindowOpen(
    openerId: string,
    details: { url: string; disposition: string; features: string },
  ): WindowOpenDecision | null {
    const opener = this.slots.get(openerId)?.service;
    if (!this.options.openLinksInTabs()) return null;
    if (!/^https?:/.test(details.url)) {
      return { action: 'deny' };
    }
    if (windowOpenNeedsOpener(details)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: this.hostWindow,
          webPreferences: {
            ...(opener ? { session: opener.contents.session } : {}),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
          },
        },
      };
    }
    const background = details.disposition === 'background-tab';
    void this.open(details.url, { activate: !background });
    return { action: 'deny' };
  }

  private eventsFor(id: string): BrowserServiceEvents {
    const current = (): boolean => !this.disposed && this.set.activeId === id;
    return {
      state: (state) => {
        this.set = patchBrowserTab(this.set, id, {
          url: state.url,
          title: state.title,
          favicon: state.favicon,
          loading: state.loading,
          zoom: state.zoomFactor,
          preset: state.preset,
        });
        if (current()) this.hooks.state(state);
        this.hooks.tabsChanged(this.snapshots());
      },
      problemsAdded: (entries) => {
        if (current()) this.hooks.problemsAdded(entries);
      },
      problemsCleared: () => {
        if (current()) this.hooks.problemsCleared();
      },
      urlSuggested: (url) => {
        if (current()) this.hooks.urlSuggested(url);
      },
      inspectorSelected: (selection) => {
        if (current()) this.hooks.inspectorSelected(selection);
      },
      inspectorCancelled: () => {
        if (current()) this.hooks.inspectorCancelled();
      },
      designState: (state) => {
        if (current()) this.hooks.designState(state);
      },
      designExitRequested: () => {
        if (current()) this.hooks.designExitRequested();
      },
      designNavigationBlocked: (url) => {
        if (current()) this.hooks.designNavigationBlocked(url);
      },
      designDocumentNavigated: () => {
        if (current()) this.hooks.designDocumentNavigated();
      },
      pageFocused: (focused) => {
        if (current()) this.hooks.pageFocused(focused);
      },
      focusParked: () => {
        if (current()) this.hooks.focusParked();
      },
      passwordOffer: (offer) => {
        this.hooks.passwordOffer({ ...offer, tabId: id });
      },
    };
  }

  private layout(): void {
    const { rect, emulation } = this.bounds;
    for (const [id, slot] of this.slots) {
      if (!slot.service) continue;
      if (id === this.set.activeId && rect) slot.service.setBounds(rect, emulation);
      else this.park(slot.service);
    }
  }

  /** A hidden tab keeps the panel's box, so a background screenshot is not an empty surface. */
  private park(service: BrowserService): void {
    const { rect, emulation } = this.bounds;
    if (rect && rect.width > 0 && rect.height > 0) service.parkSize(rect, emulation);
    else service.setBounds(null, null);
  }

  private dropSlot(id: string): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    for (const popup of slot.popups) {
      if (!popup.isDestroyed()) popup.close();
    }
    slot.service?.dispose();
    slot.history.dispose();
    this.slots.delete(id);
  }

  private publish(): void {
    if (this.disposed) return;
    this.persist();
    const service = this.activeService();
    if (service) {
      this.hooks.problemsCleared();
      const entries = [...service.getConsole(), ...service.getNetworkErrors()];
      if (entries.length > 0) this.hooks.problemsAdded(entries);
      this.hooks.state(service.getState());
    }
    this.hooks.tabsChanged(this.snapshots());
  }

  private persist(): void {
    const saved = persistedBrowserTabs(this.set);
    const app = this.set.tabs.find((entry) => entry.role === 'app');
    this.options.saveState({
      ...(app?.url ? { lastUrl: app.url } : {}),
      preset: app?.preset ?? 'responsive',
      zoomFactor: app?.zoom ?? 1,
      tabs: saved.tabs,
      activeTabId: saved.activeTabId,
    });
  }
}

