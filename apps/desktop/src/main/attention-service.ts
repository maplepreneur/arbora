import { app, Notification, type BrowserWindow } from 'electron';
import type { AttentionKind, NotificationSettings, Platform } from '@arbora/shared';

export interface NotifyRequest {
  readonly title: string;
  readonly body: string;
  readonly threadId: string | null;
  readonly kind: AttentionKind;
}

export interface AttentionWindow {
  readonly window: BrowserWindow;
  /** Project path, or null for a welcome window. */
  readonly projectPath: string | null;
}

export interface AttentionServiceOptions {
  readonly platform: Platform;
  readonly settings: () => NotificationSettings;
  /** The notification was clicked: bring the window forward and open the thread. */
  readonly onClick: (target: AttentionWindow, threadId: string | null) => void;
  readonly onCountsChanged: () => void;
}

function kindEnabled(settings: NotificationSettings, kind: AttentionKind): boolean {
  switch (kind) {
    case 'permission':
    case 'auth':
      return settings.permission;
    case 'finished':
      return settings.finished;
    case 'failed':
      return settings.failed;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/**
 * Desktop notifications for agent threads, and the per-window "needs you" counts behind the dock
 * badge, the taskbar flash and the Projects page. The renderer decides when something deserves a
 * notification (it knows which thread is on screen); this class decides whether the OS shows it.
 */
export class AttentionService {
  private readonly counts = new Map<BrowserWindow, number>();
  /** Notifications must stay referenced or a garbage collection drops their click handler. */
  private readonly live = new Set<Notification>();

  constructor(private readonly options: AttentionServiceOptions) {}

  notify(target: AttentionWindow, request: NotifyRequest): boolean {
    const settings = this.options.settings();
    if (!settings.enabled || !kindEnabled(settings, request.kind)) return false;
    if (target.window.isFocused() && !settings.whenFocused) return false;
    // Linux needs a notification daemon; without one Electron reports unsupported. Keep the badge.
    if (!Notification.isSupported()) return false;
    const notification = new Notification({
      title: request.title,
      body: request.body,
      silent: true,
      ...(this.options.platform === 'linux' ? { urgency: request.kind === 'finished' ? 'normal' : 'critical' } : {}),
    });
    this.live.add(notification);
    const release = (): void => {
      this.live.delete(notification);
    };
    notification.on('click', () => {
      release();
      if (!target.window.isDestroyed()) this.options.onClick(target, request.threadId);
    });
    notification.on('close', release);
    notification.on('failed', release);
    notification.show();
    if (settings.badge && !target.window.isFocused()) target.window.flashFrame(true);
    return true;
  }

  setCount(window: BrowserWindow, count: number): void {
    if (this.counts.get(window) === count) return;
    if (count === 0) this.counts.delete(window);
    else this.counts.set(window, count);
    if (count === 0 && !window.isDestroyed()) window.flashFrame(false);
    this.applyBadge();
    this.options.onCountsChanged();
  }

  forget(window: BrowserWindow): void {
    if (!this.counts.delete(window)) return;
    this.applyBadge();
    this.options.onCountsChanged();
  }

  count(window: BrowserWindow): number {
    return this.counts.get(window) ?? 0;
  }

  total(): number {
    let sum = 0;
    for (const value of this.counts.values()) sum += value;
    return sum;
  }

  /** Re-applies the badge after the setting changed. */
  applyBadge(): void {
    const total = this.options.settings().badge ? this.total() : 0;
    // macOS dock and Unity-style Linux launchers; a no-op elsewhere.
    app.setBadgeCount(total);
  }

  dispose(): void {
    for (const notification of this.live) notification.close();
    this.live.clear();
  }
}
