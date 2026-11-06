import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { app, session, type Certificate, type Event, type Session, type WebContents } from 'electron';
import { isLocalHostname, type BrowserSettings } from '@arbora/shared';

/** Permissions the user's page may get without asking; everything else is denied. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen', 'pointerLock']);

export function browserPartition(projectPath: string): string {
  return `persist:arbora-browser-${createHash('sha256').update(projectPath).digest('hex').slice(0, 16)}`;
}

/** Unpacked extension directories under `root` (each has a `manifest.json`). */
export function findExtensionDirs(root: string | null): string[] {
  if (!root || !existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'manifest.json')))
    .map((entry) => join(root, entry.name));
}

export interface BrowserSessionsOptions {
  /** Directory of unpacked DevTools extensions, or null when none are bundled. */
  readonly extensionsDir: string | null;
  /**
   * `enabledExtensions` is the store selection. When it is omitted, every unpacked directory loads
   * (the tests). 1Password loads at startup whenever it is selected; React and Vue stay behind
   * the DevTools setting.
   */
  readonly settings: () => BrowserSettings & { enabledExtensions?: readonly string[] };
}

/**
 * Prepares the persistent session behind each project's browser panel: DevTools extensions
 * (which must be loaded before the first page loads), the localhost certificate rule and the
 * permission policy. One session per project partition, shared by reopened windows.
 */
export class BrowserSessions {
  private readonly prepared = new Map<string, Promise<Session>>();
  private readonly sessions = new Set<Session>();
  /** Sessions whose page DevTools were opened, so on-demand extensions belong there now. */
  private readonly demanded = new Set<Session>();
  private applied: string;

  constructor(private readonly options: BrowserSessionsOptions) {
    this.applied = JSON.stringify(options.settings());
    app.on('certificate-error', this.onCertificateError);
  }

  prepare(partition: string): Promise<Session> {
    let pending = this.prepared.get(partition);
    if (!pending) {
      pending = this.setUp(session.fromPartition(partition));
      this.prepared.set(partition, pending);
    }
    return pending;
  }

  /**
   * Re-applies the extensions setting to every prepared session. A no-op unless the browser
   * settings changed, since layout and bounds saves write settings constantly.
   */
  async applySettings(): Promise<void> {
    const next = JSON.stringify(this.options.settings());
    if (next === this.applied) return;
    this.applied = next;
    for (const pending of this.prepared.values()) await this.syncExtensions(await pending);
  }

  /**
   * Loads the DevTools extensions into `ses` if they are wanted and not loaded yet (on-demand
   * mode). Resolves true when something was loaded, which means the page must reload for React
   * DevTools to hook in before React boots.
   */
  async ensureExtensions(ses: Session): Promise<boolean> {
    this.demanded.add(ses);
    const before = new Set(ses.extensions.getAllExtensions().map((e) => e.id));
    await this.syncExtensions(ses);
    const added = ses.extensions.getAllExtensions().filter((e) => !before.has(e.id));
    if (added.length === 0) return false;
    // React DevTools registers its hook script from its service worker once that worker runs; a
    // reload before then would load the page without the hook.
    await waitFor(() => {
      const scopes = Object.values(ses.serviceWorkers.getAllRunning()).map((w) => w.scope);
      return added.every((e) => scopes.some((scope) => scope.startsWith(`chrome-extension://${e.id}/`)));
    }, 5000);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    return true;
  }

  dispose(): void {
    app.off('certificate-error', this.onCertificateError);
  }

  private async setUp(ses: Session): Promise<Session> {
    this.sessions.add(ses);
    ses.setPermissionRequestHandler((_contents, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
    await this.syncExtensions(ses);
    return ses;
  }

  /**
   * Trusts self-signed localhost certificates while the setting is on. Decided here rather than in
   * `setCertificateVerifyProc` because Chromium caches verifier results per certificate for the
   * session, so toggling the setting would not apply to certificates already seen; this event is
   * raised on every failed verification, cached or not.
   */
  private readonly onCertificateError = (
    event: Event,
    contents: WebContents,
    url: string,
    _error: string,
    _certificate: Certificate,
    callback: (isTrusted: boolean) => void,
  ): void => {
    if (!this.sessions.has(contents.session)) return;
    event.preventDefault();
    callback(this.options.settings().trustLocalhostCertificates && isLocalHostname(new URL(url).hostname));
  };

  private async syncExtensions(ses: Session): Promise<void> {
    const settings = this.options.settings();
    const selected = settings.enabledExtensions;
    const devtoolsReady =
      settings.devToolsExtensions && (settings.devToolsExtensionsLoad === 'startup' || this.demanded.has(ses));
    const wanted = findExtensionDirs(this.options.extensionsDir).filter((dir) => {
      const id = basename(dir);
      if (selected && !selected.includes(id)) return false;
      if (id === '1password') return true;
      return devtoolsReady;
    });
    const wantedPaths = new Set(wanted);
    for (const extension of ses.extensions.getAllExtensions()) {
      if (!wantedPaths.has(extension.path)) ses.extensions.removeExtension(extension.id);
    }
    const loadedPaths = new Set(ses.extensions.getAllExtensions().map((extension) => extension.path));
    for (const dir of wanted) {
      if (loadedPaths.has(dir)) continue;
      try {
        await ses.extensions.loadExtension(dir, { allowFileAccess: true });
      } catch (error) {
        console.warn(`[browser] could not load extension ${dir}: ${(error as Error).message}`);
      }
    }
  }
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await new Promise((resolveTick) => setTimeout(resolveTick, 50));
}
