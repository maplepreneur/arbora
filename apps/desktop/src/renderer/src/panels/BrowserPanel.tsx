import { useEffect, useRef, useState, type ReactNode, type RefObject, type SyntheticEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  Camera,
  ExternalLink,
  Globe,
  Lock,
  LockOpen,
  RotateCw,
  Server,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import {
  CommandId,
  fitViewport,
  urlSecurity,
  VIEWPORT_PRESETS,
  viewportPresetIdSchema,
  type BrowserHistoryEntry,
  type Channels,
  type LoadError,
  type NavigationState,
  type RequestOf,
  type ViewportPresetId,
} from '@arbora/shared';
import { executeCommand, navigateBrowser } from '../commands';
import type { ModeState } from '../mode';
import { useChordLabel } from '../keybindings';
import { useApp } from '../store';
import { AgentModeLayer } from './agent-mode/AgentModeLayer';

const DEFAULT_DEV_URL = 'http://localhost:5173';

/**
 * Keeps the native `WebContentsView` glued to `ref`'s box. The view draws above all DOM, so it is
 * hidden (rect `null`) whenever DOM must show in that area. Measured with a ResizeObserver and
 * throttled to one IPC per animation frame; window `resize` events alone lag a frame behind under
 * tiling compositors.
 */
function useViewBounds(ref: RefObject<HTMLDivElement | null>, hidden: boolean, preset: ViewportPresetId): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    let last = '';
    const send = (): void => {
      frame = 0;
      let payload: RequestOf<Channels['browser.setBounds']>;
      if (hidden) {
        payload = { rect: null, emulation: null };
      } else {
        const box = element.getBoundingClientRect();
        payload = fitViewport({ x: box.x, y: box.y, width: box.width, height: box.height }, preset);
      }
      const key = JSON.stringify(payload);
      if (key === last) return;
      last = key;
      void window.arbora.invoke('browser.setBounds', payload);
    };
    const schedule = (): void => {
      frame ||= requestAnimationFrame(send);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    observer.observe(document.documentElement);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      void window.arbora.invoke('browser.setBounds', { rect: null, emulation: null });
    };
  }, [ref, hidden, preset]);
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  testId,
  collapseBelow,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  testId?: string;
  /** Hide the button when the toolbar is narrower than this container size (the palette still has it). */
  collapseBelow?: 'xs' | 'sm' | 'md';
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'h-7 w-7 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg disabled:opacity-35 disabled:hover:bg-transparent',
        collapseBelow === undefined && 'flex',
        collapseBelow === 'xs' && 'hidden @xs:flex',
        collapseBelow === 'sm' && 'hidden @sm:flex',
        collapseBelow === 'md' && 'hidden @md:flex',
        active && 'bg-bg-muted text-fg',
      )}
    >
      <Icon size={15} />
    </button>
  );
}

function SecurityBadge({ url }: { url: string }) {
  const security = urlSecurity(url);
  switch (security) {
    case 'local':
      return (
        <span title="Local dev server" data-testid="url-security" data-security={security} className="text-accent">
          <Server size={13} />
        </span>
      );
    case 'secure':
      return (
        <span title="Secure connection" data-testid="url-security" data-security={security} className="text-fg-subtle">
          <Lock size={13} />
        </span>
      );
    case 'insecure':
      return (
        <span title="Not secure" data-testid="url-security" data-security={security} className="text-danger">
          <LockOpen size={13} />
        </span>
      );
    case 'none':
      return (
        <span data-testid="url-security" data-security={security} className="text-fg-subtle">
          <Globe size={13} />
        </span>
      );
    default: {
      const unreachable: never = security;
      return unreachable;
    }
  }
}

function UrlBar({ state }: { state: NavigationState | null }) {
  // While editing, the input shows the user's draft; otherwise it follows the page URL.
  const [draft, setDraft] = useState<string | null>(null);
  const [history, setHistory] = useState<BrowserHistoryEntry[]>([]);
  // Chromium guesses `/favicon.ico`, which dev servers often answer with their HTML fallback.
  const [brokenFavicon, setBrokenFavicon] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusRequest = useApp((s) => s.urlFocusRequest);
  const currentUrl = state?.url ?? '';

  useEffect(() => {
    if (focusRequest === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const target = draft?.trim();
    if (!target) return;
    inputRef.current?.blur();
    void navigateBrowser(target).then(() => window.arbora.invoke('browser.action', { action: 'focusPage' }));
  };

  return (
    <form
      onSubmit={submit}
      className="flex h-7 min-w-24 flex-1 items-center gap-2 rounded border border-border bg-bg-subtle px-2 focus-within:border-accent"
    >
      <SecurityBadge url={currentUrl} />
      {state?.favicon && state.favicon !== brokenFavicon && (
        <img
          src={state.favicon}
          alt=""
          className="h-3.5 w-3.5 shrink-0"
          onError={() => setBrokenFavicon(state.favicon)}
        />
      )}
      <input
        ref={inputRef}
        data-testid="url-input"
        aria-label="Address"
        list="arbora-browser-history"
        spellCheck={false}
        autoComplete="off"
        placeholder="localhost:5173"
        value={draft ?? currentUrl}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => {
          setDraft(currentUrl);
          event.target.select();
          void window.arbora.invoke('browser.history').then(setHistory);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.currentTarget.blur();
        }}
        className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-fg outline-none placeholder:text-fg-subtle"
      />
      <datalist id="arbora-browser-history">
        {history.map((entry) => (
          <option key={entry.url} value={entry.url}>
            {entry.title}
          </option>
        ))}
      </datalist>
      {state && Math.abs(state.zoomFactor - 1) > 0.001 && (
        <button
          type="button"
          data-testid="zoom-indicator"
          title="Reset zoom"
          onClick={() => executeCommand(CommandId.browserZoomReset)}
          className="shrink-0 rounded bg-bg-muted px-1 font-mono text-[10px] text-fg-muted hover:text-fg"
        >
          {Math.round(state.zoomFactor * 100)}%
        </button>
      )}
    </form>
  );
}

function Toolbar({ state }: { state: NavigationState | null }) {
  const reloadLabel = useChordLabel(CommandId.browserReload);
  const devToolsLabel = useChordLabel(CommandId.browserToggleDevTools);
  const loading = state?.loading ?? false;
  const hasPage = Boolean(state?.url);
  return (
    <div
      className="@container flex h-9 shrink-0 items-center gap-1 overflow-hidden border-b border-border px-2"
      data-testid="browser-toolbar"
    >
      <ToolButton
        icon={ArrowLeft}
        label="Back"
        testId="browser-back"
        disabled={!state?.canGoBack}
        onClick={() => executeCommand(CommandId.browserBack)}
      />
      <ToolButton
        icon={ArrowRight}
        label="Forward"
        testId="browser-forward"
        disabled={!state?.canGoForward}
        onClick={() => executeCommand(CommandId.browserForward)}
      />
      {loading ? (
        <ToolButton
          icon={X}
          label="Stop"
          testId="browser-stop"
          onClick={() => void window.arbora.invoke('browser.action', { action: 'stop' })}
        />
      ) : (
        <ToolButton
          icon={RotateCw}
          label={reloadLabel ? `Reload (${reloadLabel}; Shift for hard reload)` : 'Reload'}
          testId="browser-reload"
          disabled={!hasPage}
          onClick={() => executeCommand(CommandId.browserReload)}
        />
      )}
      <UrlBar state={state} />
      <select
        aria-label="Viewport"
        data-testid="viewport-preset"
        value={state?.preset ?? 'responsive'}
        onChange={(event) => {
          const preset = viewportPresetIdSchema.parse(event.target.value);
          void window.arbora.invoke('browser.setPreset', { preset });
        }}
        className="h-7 w-28 min-w-16 shrink rounded border border-border bg-bg-subtle px-1 text-[11px] text-fg-muted outline-none focus:border-accent"
      >
        {VIEWPORT_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
      </select>
      <ToolButton
        icon={Camera}
        label="Take screenshot"
        testId="browser-screenshot"
        collapseBelow="sm"
        disabled={!hasPage}
        onClick={() => executeCommand(CommandId.browserScreenshot)}
      />
      <ToolButton
        icon={Bug}
        label={devToolsLabel ? `Page DevTools (${devToolsLabel})` : 'Page DevTools'}
        testId="browser-devtools"
        collapseBelow="xs"
        active={state?.devToolsOpen ?? false}
        disabled={!hasPage}
        onClick={() => executeCommand(CommandId.browserToggleDevTools)}
      />
      <ToolButton
        icon={ExternalLink}
        label="Open in external browser"
        collapseBelow="md"
        disabled={!hasPage}
        onClick={() => executeCommand(CommandId.browserOpenExternal)}
      />
    </div>
  );
}

function Notice({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div
      data-testid={testId}
      className="flex h-8 shrink-0 items-center justify-center gap-2 border-b border-border bg-accent-soft px-3 text-xs text-fg"
    >
      {children}
    </div>
  );
}

function loadErrorHint(error: LoadError): string {
  if (error.code === -102 || error.code === -105 || error.code === -109) {
    return 'Is the dev server running? Start it in a terminal, then retry.';
  }
  if (error.code <= -200 && error.code > -300) {
    return 'Certificate error. Localhost certificates are trusted when "browser.trustLocalhostCertificates" is on.';
  }
  return '';
}

function EmptyState({ devUrl }: { devUrl: string }) {
  const focusLabel = useChordLabel(CommandId.browserFocusUrl);
  return (
    <div data-testid="browser-empty" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Globe size={28} strokeWidth={1.25} className="text-fg-subtle" />
      <div className="font-medium text-fg-muted">No page loaded</div>
      <div className="max-w-xs text-xs text-fg-subtle">
        Enter your dev server URL in the address bar{focusLabel ? ` (${focusLabel})` : ''}, or open the default.
      </div>
      <button
        type="button"
        data-testid="open-dev-url"
        onClick={() => void navigateBrowser(devUrl)}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90"
      >
        Open {devUrl}
      </button>
    </div>
  );
}

function ErrorState({ error }: { error: LoadError }) {
  const hint = loadErrorHint(error);
  return (
    <div data-testid="browser-error" className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <TriangleAlert size={26} strokeWidth={1.5} className="text-danger" />
      <div className="font-medium text-fg">Could not load the page</div>
      <div className="max-w-md font-mono text-[11px] break-all text-fg-muted">{error.url}</div>
      <div className="font-mono text-[11px] text-fg-subtle">
        {error.description} ({error.code})
      </div>
      {hint && <div className="max-w-sm text-xs text-fg-subtle">{hint}</div>}
      <button
        type="button"
        data-testid="browser-retry"
        onClick={() => executeCommand(CommandId.browserReload)}
        className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-bg-muted"
      >
        Retry
      </button>
    </div>
  );
}

function modeBannerText(mode: ModeState, hasPage: boolean, changes: number, original: boolean): string {
  switch (mode.kind) {
    case 'idle':
      return '';
    case 'agent':
      switch (mode.phase) {
        case 'inspecting':
          // The inspector starts as soon as a page reports in.
          return hasPage ? 'Agent mode: click a component' : 'Agent mode: load your page, then click a component';
        case 'selected':
          return 'Agent mode: capturing…';
        case 'prompting':
          return 'Agent mode: describe the change';
        default: {
          const unreachable: never = mode;
          return unreachable;
        }
      }
    case 'design':
      switch (mode.phase) {
        case 'editing':
          if (!hasPage) return 'Design mode: load your page, then click an element';
          if (original) return 'Design mode: showing the page before your changes';
          return changes > 0
            ? `Design mode: ${changes} unsent change${changes === 1 ? '' : 's'}`
            : 'Design mode: click an element, then edit it';
        case 'confirm':
          return 'Design mode: send or discard your changes?';
        default: {
          const unreachable: never = mode;
          return unreachable;
        }
      }
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

export default function BrowserPanel() {
  const mode = useApp((s) => s.mode);
  const designChanges = useApp((s) => s.design.cursor);
  const showingOriginal = useApp((s) => s.design.showingOriginal);
  const state = useApp((s) => s.browser);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const suggestedUrl = useApp((s) => s.suggestedUrl);
  const devUrl = useApp((s) => s.project?.settings.devUrl) ?? DEFAULT_DEV_URL;
  const exitLabel = useChordLabel(CommandId.exitMode);
  const viewportRef = useRef<HTMLDivElement>(null);

  const empty = !state || (!state.url && !state.loading);
  const error = state?.error ?? null;
  const prompting = mode.kind === 'agent' && mode.phase === 'prompting' ? mode.selection : null;
  // Anything rendered in the viewport area (or over it, like the palette) needs the view hidden.
  const hidden = empty || error !== null || paletteOpen || prompting !== null;
  const preset = state?.preset ?? 'responsive';
  useViewBounds(viewportRef, hidden, preset);

  return (
    <div className="flex h-full flex-col bg-bg" data-testid="browser-panel">
      <Toolbar state={state} />
      {mode.kind !== 'idle' && (
        <div
          data-testid="mode-banner"
          data-mode={mode.kind}
          data-phase={mode.phase}
          className="flex h-7 shrink-0 items-center justify-center bg-accent text-xs font-medium text-accent-fg"
        >
          {modeBannerText(mode, !empty && error === null, designChanges, showingOriginal)} · {exitLabel} to exit
        </div>
      )}
      {suggestedUrl && (
        <Notice testId="url-suggestion">
          Dev server detected at <span className="font-mono">{suggestedUrl}</span>
          <button type="button" className="font-medium underline" onClick={() => void navigateBrowser(suggestedUrl)}>
            Open
          </button>
          <button type="button" className="text-fg-muted" onClick={() => useApp.setState({ suggestedUrl: null })}>
            Dismiss
          </button>
        </Notice>
      )}
      <div
        ref={viewportRef}
        data-testid="browser-viewport"
        data-preset={preset}
        className={clsx('relative min-h-0 flex-1', preset !== 'responsive' && 'bg-bg-muted')}
      >
        {error ? (
          <ErrorState error={error} />
        ) : empty ? (
          <EmptyState devUrl={devUrl} />
        ) : prompting ? (
          <AgentModeLayer key={prompting.id} selection={prompting} preset={preset} />
        ) : null}
      </div>
    </div>
  );
}
