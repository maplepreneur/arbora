import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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
  readonly settings: () => BrowserSettings;
}

/**
 * Prepares the persistent session behind each project's browser panel: DevTools extensions
 * (which must be loaded before the first page loads), the localhost certificate rule and the
 * permission policy. One session per project partition, shared by reopened windows.
 */
export class BrowserSessions {
  private readonly prepared = new Map<string, Promise<Session>>();
  private readonly sessions = new Set<Session>();
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
    const wanted = this.options.settings().devToolsExtensions;
    const loaded = ses.extensions.getAllExtensions();
    if (!wanted) {
      for (const extension of loaded) ses.extensions.removeExtension(extension.id);
      return;
    }
    const loadedPaths = new Set(loaded.map((e) => e.path));
    for (const dir of findExtensionDirs(this.options.extensionsDir)) {
      if (loadedPaths.has(dir)) continue;
      try {
        await ses.extensions.loadExtension(dir, { allowFileAccess: true });
      } catch (error) {
        console.warn(`[browser] could not load extension ${dir}: ${(error as Error).message}`);
      }
    }
  }
}
