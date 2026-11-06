import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ILink, type ITheme } from '@xterm/xterm';
import {
  findDevUrls,
  fontFamily,
  groveWebsiteAction,
  terminalClipboardAction,
  type ResolvedTheme,
} from '@arbora/shared';
import { navigateBrowser, openFileAtLocation, openGroveWebsite } from '../../commands';
import { projectPathForTerminal } from '../../grove-store';
import { bindingForEvent } from '../../keybindings';
import { showToast, useApp } from '../../store';
import { useTerminals } from '../../terminal-store';

const FONT_FAMILY =
  "'Dank Mono', ui-monospace, 'JetBrainsMono Nerd Font', 'JetBrains Mono', 'CaskaydiaMono Nerd Font', 'Cascadia Code', 'SF Mono', Menlo, Consolas, 'Symbols Nerd Font Mono', 'DejaVu Sans Mono', monospace";
const RESIZE_DEBOUNCE_MS = 50;

const THEMES: Readonly<Record<ResolvedTheme, ITheme>> = {
  light: {
    background: '#ffffff',
    foreground: '#16181d',
    cursor: '#2f7d5b',
    cursorAccent: '#ffffff',
    selectionBackground: '#2f7d5b40',
    black: '#16181d',
    red: '#c93c3c',
    green: '#2f7d5b',
    yellow: '#a8730b',
    blue: '#2f6fbd',
    magenta: '#8a4fb5',
    cyan: '#16808f',
    white: '#8a909c',
    brightBlack: '#5c6370',
    brightRed: '#e05252',
    brightGreen: '#3c9a70',
    brightYellow: '#c28a12',
    brightBlue: '#4485d6',
    brightMagenta: '#a066cc',
    brightCyan: '#1d9aab',
    brightWhite: '#c0c4cc',
  },
  dark: {
    background: '#0b0d10',
    foreground: '#e6e8ec',
    cursor: '#4fb385',
    cursorAccent: '#0b0d10',
    selectionBackground: '#4fb38545',
    black: '#1a1e25',
    red: '#ef6b6b',
    green: '#4fb385',
    yellow: '#e2b35a',
    blue: '#6aa5ef',
    magenta: '#c08ae6',
    cyan: '#56c3cf',
    white: '#c5c9d1',
    brightBlack: '#6c7380',
    brightRed: '#ff8a8a',
    brightGreen: '#6fd0a2',
    brightYellow: '#f0c878',
    brightBlue: '#8cbcf7',
    brightMagenta: '#d3a6f0',
    brightCyan: '#7ad6df',
    brightWhite: '#ffffff',
  },
};

/** `src/App.tsx:12:5`, `./lib/a.ts:3`, `/abs/path/file.js:10` in compiler and test output. */
const FILE_LOCATION =
  /(?:^|[\s('"`])((?:\.{1,2}\/|\/|[A-Za-z]:[\\/])?[\w@.-]+(?:[\\/][\w@.-]+)*\.\w+):(\d+)(?::(\d+))?/g;

export interface TerminalSession {
  readonly id: string;
  readonly term: Terminal;
  readonly search: SearchAddon;
  /** Moved between pane containers as tabs switch; xterm is opened into it once. */
  readonly host: HTMLDivElement;
  attach(container: HTMLElement): void;
  /** Detaches from `container` only if the host is still there (it may have moved to a split). */
  detach(container?: HTMLElement): void;
  fit(): void;
  focus(): void;
  dispose(): void;
}

const sessions = new Map<string, TerminalSession>();
/** Terminals whose scrollback is still loading; live output for them is already in that scrollback. */
const loading = new Set<string>();

export async function copySelection(session: TerminalSession): Promise<boolean> {
  const text = session.term.getSelection();
  if (!text) return false;
  await window.arbora.invoke('clipboard.writeText', { text });
  return true;
}

export async function pasteClipboard(session: TerminalSession): Promise<void> {
  const text = await window.arbora.invoke('clipboard.readText');
  if (text) session.term.paste(text);
}

function openLink(terminalId: string, uri: string): void {
  const grove = groveWebsiteAction({
    workspace: useApp.getState().layout.workspace,
    projectPath: projectPathForTerminal(terminalId),
    url: uri,
  });
  if (grove) {
    void openGroveWebsite(grove);
    return;
  }
  if (findDevUrls(uri).length > 0) void navigateBrowser(uri);
  else window.open(uri, '_blank');
}

function createSession(id: string): TerminalSession {
  const { settings, theme, info } = useApp.getState();
  const term = new Terminal({
    allowProposedApi: true,
    fontFamily: fontFamily(settings.appearance.codeFont, FONT_FAMILY),
    fontSize: settings.terminal.fontSize,
    lineHeight: 1.15,
    scrollback: 5000,
    cursorBlink: settings.terminal.cursorBlink,
    macOptionIsMeta: true,
    theme: THEMES[theme.resolved],
  });
  const fitAddon = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(search);
  term.loadAddon(new WebLinksAddon((_event, uri) => openLink(id, uri)));
  term.registerLinkProvider({
    provideLinks(lineNumber, callback) {
      const line = term.buffer.active.getLine(lineNumber - 1)?.translateToString(true) ?? '';
      const links: ILink[] = [];
      for (const match of line.matchAll(FILE_LOCATION)) {
        const [, path, lineText, columnText] = match;
        if (!path || !lineText || /^https?:/.test(path)) continue;
        const start = match.index + match[0].indexOf(path);
        const text = `${path}:${lineText}${columnText ? `:${columnText}` : ''}`;
        links.push({
          range: { start: { x: start + 1, y: lineNumber }, end: { x: start + text.length, y: lineNumber } },
          text,
          activate: () =>
            openFileAtLocation({ path, line: Number(lineText), ...(columnText ? { column: Number(columnText) } : {}) }),
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  });

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;
    const clipboard = terminalClipboardAction(
      { code: event.code, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey },
      info.platform,
      term.hasSelection(),
    );
    if (clipboard === 'copy') {
      void copySelection(session).then(() => term.clearSelection());
      event.preventDefault();
      return false;
    }
    if (clipboard === 'paste') {
      void pasteClipboard(session);
      event.preventDefault();
      return false;
    }
    // Arbora chords (palette, new terminal, ...) run their command instead of reaching the shell.
    return bindingForEvent(event) === undefined;
  });
  term.onData((data) => void window.arbora.invoke('terminal.write', { id, data }));
  term.onTitleChange((title) => {
    if (title) host.title = title;
  });

  const host = document.createElement('div');
  host.className = 'h-full w-full';
  host.dataset['testid'] = 'terminal-xterm';
  host.dataset['terminalId'] = id;
  host.addEventListener('focusin', () => {
    useApp.setState({ terminalFocused: true });
    useTerminals.setState({ activePaneId: id });
  });
  host.addEventListener('focusout', () => useApp.setState({ terminalFocused: false }));

  let opened = false;
  let observer: ResizeObserver | undefined;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const fit = (): void => {
    if (!host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) return;
    fitAddon.fit();
    const size = { cols: term.cols, rows: term.rows };
    useTerminals.setState({ lastSize: size });
    void window.arbora.invoke('terminal.resize', { id, ...size });
  };

  const session: TerminalSession = {
    id,
    term,
    search,
    host,
    attach(container) {
      if (host.parentElement !== container) container.appendChild(host);
      if (!opened) {
        term.open(host);
        opened = true;
        try {
          const webgl = new WebglAddon();
          webgl.onContextLoss(() => webgl.dispose());
          term.loadAddon(webgl);
        } catch (error) {
          // Some Linux GPU/driver stacks and headless CI have no WebGL2; xterm falls back to DOM.
          console.warn('[terminal] WebGL renderer unavailable, using the DOM renderer', error);
        }
      }
      observer?.disconnect();
      observer = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(fit, RESIZE_DEBOUNCE_MS);
      });
      observer.observe(host);
      fit();
    },
    detach(container) {
      if (container && host.parentElement !== container) return;
      observer?.disconnect();
      observer = undefined;
      clearTimeout(resizeTimer);
      host.remove();
    },
    fit,
    focus: () => term.focus(),
    dispose() {
      session.detach();
      term.dispose();
    },
  };
  return session;
}

/** The session for terminal `id`, created on first use and filled with main's scrollback. */
export function ensureSession(id: string): TerminalSession {
  const existing = sessions.get(id);
  if (existing) return existing;
  const session = createSession(id);
  sessions.set(id, session);
  loading.add(id);
  void window.arbora
    .invoke('terminal.scrollback', { id })
    .then(({ data }) => {
      if (data) session.term.write(data);
    })
    .catch((error: unknown) => showToast(`Could not load terminal output: ${(error as Error).message}`))
    .finally(() => loading.delete(id));
  return session;
}

export function getSession(id: string | null): TerminalSession | undefined {
  return id === null ? undefined : sessions.get(id);
}

function disposeStale(): void {
  const live = new Set(useTerminals.getState().terminals.map((t) => t.id));
  for (const [id, session] of sessions) {
    if (live.has(id)) continue;
    session.dispose();
    sessions.delete(id);
    loading.delete(id);
  }
}

let initialized = false;

/** Subscribes the session manager to main's terminal output and to theme/font changes (once). */
export function initTerminalSessions(): void {
  if (initialized) return;
  initialized = true;
  window.arbora.on('terminal.data', ({ id, data }) => {
    if (loading.has(id)) return;
    sessions.get(id)?.term.write(data);
  });
  useTerminals.subscribe((state, previous) => {
    if (state.terminals !== previous.terminals) disposeStale();
  });
  useApp.subscribe((state, previous) => {
    if (state.theme.resolved !== previous.theme.resolved) {
      for (const session of sessions.values()) session.term.options.theme = THEMES[state.theme.resolved];
    }
    if (
      state.settings.terminal.fontSize !== previous.settings.terminal.fontSize ||
      state.settings.appearance.codeFont !== previous.settings.appearance.codeFont
    ) {
      for (const session of sessions.values()) {
        session.term.options.fontSize = state.settings.terminal.fontSize;
        session.term.options.fontFamily = fontFamily(state.settings.appearance.codeFont, FONT_FAMILY);
        session.fit();
      }
    }
    if (state.settings.terminal.cursorBlink !== previous.settings.terminal.cursorBlink) {
      for (const session of sessions.values()) session.term.options.cursorBlink = state.settings.terminal.cursorBlink;
    }
  });
}
