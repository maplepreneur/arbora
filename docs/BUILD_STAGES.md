# Arbora: Build Stages and Progress

This document breaks [PLAN.md](./PLAN.md) into stages a coding agent can execute one at a time. Each stage has a goal, scope, step-by-step instructions, gotchas, acceptance criteria and a progress checklist. Feature IDs (`F-...`) refer to PLAN.md section 4.

## How to use this document

- Work one stage at a time, in order. Each stage ends with a usable app.
- One pull request per stage (split into several PRs if a stage is large, but do not mix stages).
- Before starting a stage, read its gotchas. Most of them cost hours when discovered the hard way.
- When a task is done, tick its checkbox in this file in the same PR. Update the **Progress** table at the top.
- Before pushing: `pnpm typecheck && pnpm lint && pnpm test`. Keep the `fixtures/` apps green.
- Record new gotchas you discover in the stage's "Gotchas" list so the next agent benefits.
- Pin dependency versions when first adding them. Check the current latest at that time; versions named here are a starting point, not a contract.

## Code conventions for the builder agent

- TypeScript `strict` everywhere; no `any` without a comment explaining why.
- All IPC goes through zod-validated channels in `packages/shared`. The renderer never imports from `electron`.
- Imports at the top of the file; no inline `import()` except documented lazy boundaries in `src/main/lazy/` and `React.lazy` panel entries.
- Exhaustive `switch` over unions and enums with a `never` default.
- Services in main are plain classes with explicit `dispose()`; no module-level singletons holding process handles.
- Child processes (agents, terminals, git, tooling) always receive the cached login-shell PATH and the project cwd.
- Every new tool, command or setting gets a unit test or an e2e step in the stage it lands in.
- Commit per logical change; one PR per stage (or per clearly labelled sub-part of a stage).

## Progress

| Stage | Name | Status | Notes |
| --- | --- | --- | --- |
| 0 | Foundation | Not started | |
| 1 | Browser panel | Not started | |
| 2 | Terminal panel | Not started | |
| 3 | Agent panel (ACP) | Not started | |
| 4 | Agent mode (`Mod+K`) | Not started | |
| 5 | Browser control MCP server | Not started | |
| 6 | Design mode (`Mod+D`) | Not started | |
| 7 | Files and editor | Not started | |
| 8 | Git and GitHub | Not started | |
| 9 | Distribution and polish | Not started | |
| 10 | Stretch | Not started | |

Status values: `Not started`, `In progress`, `Blocked (reason)`, `Done (PR #)`.

## Cross-cutting gotchas (read before any stage)

- **Super key is unreliable.** `Win+K` opens Cast on Windows, `Super+D` shows the desktop on Windows and many Linux WMs, GNOME grabs many Super chords. Implement `Mod` as Cmd on macOS and Super elsewhere, detect failures (the keydown never arrives) and offer `Ctrl+Alt+K` / `Ctrl+Alt+D` as the fallback. Make every binding configurable from day one.
- **macOS GUI apps do not inherit your shell PATH.** `kimi`, `grok`, `node`, `pnpm`, `git` may not resolve when Arbora is launched from Finder/Dock. On startup, spawn the user's login shell (`$SHELL -ilc 'echo -n "$PATH"'`) once, cache the result, and use it for every child process (agents, terminals, git). Linux desktop launchers have the same problem with user-local bins (`~/.local/bin`, nvm, volta).
- **Windows path and shell differences.** Spawn `npx` as `npx.cmd` (or use `shell: true` with careful quoting). Use `PowerShell` or `pwsh` as the default terminal. Normalise paths with `path.posix` before sending to agents and MCP tools; ACP agents expect absolute paths, and Codex/Claude Code handle `C:\...` but prompts read better with forward slashes.
- **Native modules must be rebuilt for Electron.** `node-pty` (and anything else with a `.node` binary) must be compiled against Electron's Node ABI. Use `electron-builder install-app-deps` (or `@electron/rebuild`) in `postinstall`, and never import native modules from the renderer.
- **Electron security defaults are not enough.** Set `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true` on every `BrowserWindow` and `WebContentsView`. Call `setWindowOpenHandler` and deny by default. The user's dev server is untrusted content.
- **Use `WebContentsView`, not `<webview>`.** `<webview>` is deprecated-in-spirit, slow, and has broken focus and sizing behaviour. `WebContentsView` is a native view you position from main; the renderer sends layout rects over IPC.
- **CDP and DevTools fight over the debugger.** `webContents.debugger.attach()` detaches when the user opens DevTools on the same `webContents`, and vice versa. Listen for `detach` and re-attach when DevTools closes; disable inspector/design overlays while DevTools is open, or show a warning.
- **Agent CLIs change weekly.** Pin adapter versions in the registry (`npx -y pkg@x.y.z`) and expose an "update adapters" action. Always read `agentCapabilities` and `promptCapabilities` from `initialize` instead of hard-coding what an agent can do.
- **Keep secrets out of logs.** The ACP log viewer must redact `env` values and auth tokens. The MCP bearer token must never appear in prompts.

---

## Stage 0: Foundation

**Goal.** A runnable Electron app that opens a project folder and shows an empty, resizable panel layout, with the tooling and CI that every later stage relies on.

**Features.** `F-SHELL-01` to `F-SHELL-06`, `F-NFR-01`, `F-NFR-03` (partial).

**In scope.** pnpm monorepo, electron-vite app, TypeScript strict, ESLint + Prettier, zod IPC layer, settings store, project open/recent, panel layout skeleton with persisted sizes, command palette, keybinding service with Super fallback, GitHub Actions matrix (typecheck, lint, unit), electron-builder producing unsigned artifacts.

**Out of scope.** Any real panel content, signing, updater.

### Instructions

1. Initialise the pnpm workspace: `apps/desktop`, `packages/shared`, `packages/acp-client`, `packages/browser-bridge`, `packages/mcp-browser-server`, `fixtures/*`. Add `pnpm-workspace.yaml`, root `package.json` scripts (`dev`, `build`, `typecheck`, `lint`, `test`, `e2e`, `package`), `.npmrc` with `node-linker=hoisted` (electron-builder and native modules misbehave with the default isolated layout).
2. Scaffold `apps/desktop` with `electron-vite` (React + TypeScript template). Three entry points: `main`, `preload`, `renderer`. Add a fourth build entry `browser-preload` now (empty) so the Vite config is right before Stage 1.
3. TypeScript: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, project references per package. ESLint flat config with `typescript-eslint` strict, `react-hooks`, `import/no-cycle`, and a rule banning inline imports (`no-restricted-syntax` on `ImportExpression` outside `src/main/lazy/`).
4. IPC layer in `packages/shared`: define each channel as `{ name, request: z.ZodType, response: z.ZodType }` and each event as `{ name, payload: z.ZodType }`. Write `defineHandler` (main) and `createClient` (preload) helpers that validate both directions. Expose the client through `contextBridge.exposeInMainWorld('arbora', ...)`. The renderer must never call `ipcRenderer` directly.
5. Settings store in main (`electron-store` or a hand-rolled JSON file under `app.getPath('userData')`), with a zod schema and migrations table. Per-project settings live in `<project>/.arbora/project.json`.
6. Window management: one `BrowserWindow` per project, `titleBarStyle: 'hiddenInset'` on macOS, custom title bar on Linux/Windows with window controls. Remember bounds per project.
7. Project open: native dialog, recent projects list (most recent 10), drag-and-drop a folder onto the welcome screen, CLI argument `arbora <path>`.
8. Layout: `react-resizable-panels` with the layout from PLAN section 4.1. Persist sizes and collapsed state per project. Lazy-load panel components with `React.lazy` so Stage 0 ships placeholders.
9. Command palette with `cmdk`, command registry in `packages/shared` (`{ id, title, keybinding?, run }`). Every later feature registers commands here.
10. Keybinding service: parse chords like `mod+k`, resolve `mod` per OS, register via renderer `keydown` for in-window chords and `globalShortcut` only for the `Mod+K` / `Mod+D` fallback probe. On first run, probe whether `Super+K` reaches the window; if not, switch defaults to `Ctrl+Alt+K/D` and record the decision in settings.
11. Theme: Tailwind with CSS variables for dark/light, follow `nativeTheme`, toggle command.
12. CI: `.github/workflows/ci.yml` matrix `ubuntu-latest`, `macos-latest`, `windows-latest` running `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test`. A separate `package.yml` on tags running `electron-builder --publish never` and uploading artifacts.
13. electron-builder config: `appId: dev.arbora.app`, targets AppImage + deb (Linux), dmg + zip (macOS, unsigned for now), nsis (Windows). `asarUnpack` native modules.
14. Fixtures: `fixtures/vite-react` (React 19 + Vite + Tailwind), `fixtures/plain-html` (static server). Next and Nuxt fixtures come in Stage 4.
15. Unit tests with Vitest for the IPC helpers, keybinding parser and settings migrations. One Playwright-for-Electron smoke test: launch, open `fixtures/vite-react`, assert the layout renders.

### Gotchas

- electron-vite externalises Electron and Node built-ins in `main` and `preload` by default but bundles everything else. Native modules (`node-pty` later) must be listed in `build.rollupOptions.external` and kept in `dependencies` (not `devDependencies`) so electron-builder packages them.
- With `sandbox: true` the preload cannot `require` arbitrary modules. Keep preloads tiny: `contextBridge` + `ipcRenderer` only. Everything else lives in main.
- `electron-builder` on Linux needs `libarchive-tools`, `rpm` (if you add rpm) and `fakeroot`; on CI install them in the Linux job. The AppImage needs `--no-sandbox` on some Arch setups unless the AppImage's chrome-sandbox is setuid; document this rather than fighting it.
- `globalShortcut` steals the chord from every other app while Arbora runs. Use it only for the one-time probe and release it immediately.
- `react-resizable-panels` needs explicit `id` and `order` on every panel when panels are conditionally rendered, or layouts get corrupted on persist/restore.
- Playwright for Electron requires `electron.launch({ args: [path/to/main.js] })` against the built output; add a `pnpm build:test` script that builds once without minification.

### Acceptance

- `pnpm dev` opens the app on Linux, macOS and Windows; opening `fixtures/vite-react` shows the empty layout with persisted sizes after restart.
- `Mod+Shift+P` opens the palette; `Mod+K` and `Mod+D` dispatch commands (placeholders) or the fallback chords do, and the choice is visible in settings.
- CI matrix is green; `package.yml` produces AppImage, deb, dmg, exe artifacts.

### Checklist

- [ ] Monorepo, scripts, `.npmrc`, workspace packages
- [ ] electron-vite app with four build entries
- [ ] TypeScript strict + ESLint + Prettier
- [ ] zod IPC layer and `window.arbora` bridge
- [ ] Settings store with migrations; `.arbora/project.json`
- [ ] Window management and custom title bar
- [ ] Project open: dialog, recents, drag-and-drop, CLI arg
- [ ] Panel layout with persistence and lazy panels
- [ ] Command palette and command registry
- [ ] Keybinding service with Super probe and fallback
- [ ] Theme
- [ ] CI matrix and package workflow
- [ ] electron-builder config
- [ ] Fixtures `vite-react`, `plain-html`
- [ ] Unit tests and Playwright smoke test

---

## Stage 1: Browser panel

**Goal.** Load the user's dev server inside Arbora with the instrumentation every later stage depends on: CDP, console/network capture, screenshots, DevTools extensions, and a preload channel into the page.

**Features.** `F-BROWSER-01` to `F-BROWSER-08`.

**Out of scope.** Multiple tabs (Stage 10), overlays (Stage 4/6), MCP tools (Stage 5).

### Instructions

1. `BrowserService` in main: creates one `WebContentsView` per window with `webPreferences: { partition: 'persist:arbora-browser-<projectHash>', preload: browserPreloadPath, contextIsolation: true, sandbox: true, nodeIntegration: false }`. Attach it to `win.contentView`. The renderer sends the browser panel's rect on every layout change (`ResizeObserver` -> IPC, throttled with rAF), and main calls `view.setBounds`.
2. Navigation API: `navigate(url)`, `back`, `forward`, `reload`, `hardReload` (`reloadIgnoringCache`), `stop`, `openExternal`, `toggleDevTools`, `setZoom`. Emit `navigation-state` events (url, title, canGoBack, canGoForward, loading, favicon).
3. URL bar component: accepts bare `localhost:5173`, defaults to `http://`, shows an insecure/local badge, history dropdown from the partition.
4. Viewport presets: the renderer draws a letterboxed container; the view is sized to the preset width/height and centred. Emulate DPR and touch via CDP `Emulation.setDeviceMetricsOverride` so mobile presets are honest.
5. CDP: `webContents.debugger.attach('1.3')` on `did-start-loading`. Enable `Runtime`, `Log`, `Network`, `Page`. Buffer `Runtime.consoleAPICalled`, `Runtime.exceptionThrown`, `Log.entryAdded`, `Network.loadingFailed`, `Network.responseReceived` (status >= 400) into a ring buffer (last 500 entries) in `BrowserService`. Expose `getConsole()`, `getNetworkErrors()`, `clear()`. Render in the Problems tab.
6. Screenshot API: `captureViewport()` via `webContents.capturePage()`, `captureElement(rect)` via `capturePage(rect)`, `captureFullPage()` via CDP `Page.captureScreenshot({ captureBeyondViewport: true })`. Optional `highlight: rect` draws a 2px outline using `sharp` or an offscreen canvas in the renderer before returning. Return `{ pngBase64, width, height, dpr }` and optionally write to `.arbora/screenshots/<timestamp>.png`.
7. DevTools extensions: vendor unpacked builds of React DevTools and Vue DevTools under `apps/desktop/resources/extensions/` (download at build time with a script, commit the checksums, not the binaries). Call `session.fromPartition(partition).loadExtension(path)` after `app.whenReady()` and before the first `loadURL`. Make this a setting (default on).
8. `browser-preload.ts`: minimal bootstrap that exposes nothing to the page, establishes `ipcRenderer` request/event helpers on a private channel prefix `arbora:page:`, and reports `page-ready`. Stage 4 and 6 extend this file.
9. Dev-server URL detection hook: `BrowserService.suggestUrl(url)` that the terminal (Stage 2) will call; for now, wire a "Open fixture" command so you can test without a terminal.
10. Tests: Playwright e2e loading `fixtures/vite-react`, asserting title, triggering a console error in the fixture and reading it from the Problems tab, taking a screenshot and checking dimensions.

### Gotchas

- `WebContentsView` draws above all renderer DOM. Anything that must appear over the browser (prompt popovers, drop indicators, modals) must either be another `WebContentsView` or be rendered inside the page by the preload. Decide now: Arbora renders popovers in the renderer and temporarily shrinks or hides the view only for full-screen modals; in-page overlays are rendered by the preload. The Stage 4 prompt popover is drawn by the renderer next to the view (the view is clipped if the popover would overlap), not inside the page.
- `loadExtension` only works on persistent partitions and must be awaited before loading a page, otherwise the hook is not injected and React DevTools reports "no React detected" even though it is loaded.
- React DevTools only exposes component names in development builds. Production builds of the user's app will fall back to tier 3 source resolution; surface this in the UI.
- Electron's `webContents.capturePage` returns the visible area at device scale. On HiDPI screens the PNG is 2x; store `dpr` with every screenshot so element rects can be mapped back.
- Attaching the debugger after DevTools is open throws "Another debugger is already attached". Wrap `attach` in try/catch, listen for `devtools-closed` and retry.
- `Network.enable` with large pages can flood the main process. Set `maxTotalBufferSize` and drop bodies; only metadata goes in the ring buffer.
- If the dev server redirects to `0.0.0.0` or an IPv6 host, Chromium may refuse. Normalise `0.0.0.0` to `localhost` in the URL bar.
- Self-signed HTTPS dev servers (Vite with `https: true`) trigger certificate errors. Add `session.setCertificateVerifyProc` that trusts localhost origins only, behind a setting.

### Acceptance

- Load `fixtures/vite-react`, navigate, hard reload, switch to a mobile preset and see the fixture's responsive layout.
- Console errors and failed requests appear in Problems with timestamps and source URLs.
- A screenshot command writes a PNG with correct dimensions; element screenshot works with a rect.
- React DevTools panel appears inside DevTools for the fixture.

### Checklist

- [ ] `BrowserService` with `WebContentsView` and rect sync
- [ ] Navigation API and events
- [ ] URL bar and chrome
- [ ] Viewport presets with CDP emulation
- [ ] CDP attach, ring buffers, Problems tab
- [ ] Screenshot API (viewport, element, full page, highlight)
- [ ] Bundled React/Vue DevTools extensions
- [ ] `browser-preload` bootstrap and private channel
- [ ] Localhost certificate handling (setting)
- [ ] e2e tests

---

## Stage 2: Terminal panel

**Goal.** Run dev servers (and anything else) inside Arbora, detect their URLs and open them in the browser panel. Provide the output buffer the MCP server will read later.

**Features.** `F-TERM-01` to `F-TERM-04`, `F-BROWSER-03`.

### Instructions

1. `TerminalService` in main wrapping `node-pty`: `create({ cwd, shell?, env?, cols, rows })`, `write`, `resize`, `kill`, `list`. Each terminal keeps a ring buffer of the last 2000 lines (stripped of ANSI) for `devserver_logs` and URL detection.
2. Shell detection: macOS/Linux read `$SHELL` (fallback `/bin/zsh`, `/bin/bash`); Windows prefer `pwsh.exe`, then `powershell.exe`, then `cmd.exe`. Launch as a login shell (`-l`) on macOS so profile PATH applies.
3. Environment: merge the cached login-shell PATH (cross-cutting gotcha) and set `TERM=xterm-256color`, `COLORTERM=truecolor`, `ARBORA=1`, `ARBORA_PROJECT=<path>`.
4. Renderer: `@xterm/xterm` with `addon-fit`, `addon-webgl` (fallback to canvas on failure), `addon-search`, `addon-web-links`. Tabs and horizontal/vertical splits. Context menu: copy, paste, clear, kill, rename.
5. URL detection: regex on terminal output for `https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[\w.-]+\.local)(:\d+)?(/\S*)?`. Debounce, dedupe per terminal, show a toast "Open http://localhost:5173 in browser" and auto-open if the project setting `autoOpenDevUrl` is on and no URL is loaded yet.
6. Dev command: `.arbora/project.json` `{ devCommand: "pnpm dev", devUrl?: string }`. On first open, infer from `package.json` scripts (`dev`, `start`, `serve`) and the lockfile (pnpm/yarn/npm/bun). "Run dev server" command creates a dedicated terminal named `dev` and runs the command. Provide `restartDevServer()` (SIGINT, wait, rerun) for Stage 5.
7. Terminal link clicks: file paths with `:line:col` open in the editor (Stage 7 will implement; register the command now and no-op).
8. Tests: unit test URL regex and shell detection; e2e start `fixtures/vite-react` dev server from the terminal and assert the browser navigates to it.

### Gotchas

- `node-pty` must be rebuilt for Electron (postinstall). On Windows it requires the Spectre-mitigated VS build tools or the prebuilt binaries; prefer prebuilts and pin the version.
- Killing a dev server: `pty.kill()` on Windows kills the shell but often leaves `node` running and the port held. Use `taskkill /T /F /PID` on Windows and process-group kill (`-pid`) on POSIX. Verify the port is free before restarting.
- Vite prints URLs with ANSI colour codes and sometimes box-drawing characters; strip ANSI before running the regex. Next.js prints `- Local: http://localhost:3000`; Nuxt prints `➜ Local: http://localhost:3000/`. Test against all fixtures.
- xterm's WebGL addon throws on some Linux GPU/driver combinations (and in headless CI). Wrap `loadAddon` in try/catch and fall back.
- Resizing panels fires many `resize` events; debounce `pty.resize` or shells redraw badly.
- Terminals from ACP agents (Stage 3) will reuse `TerminalService`; keep the API transport-neutral (no renderer assumptions).

### Acceptance

- Open a terminal, run `pnpm dev` in the fixture, see the URL toast, click it, browser panel loads the app.
- "Run dev server" works on a fresh project with inferred command; `.arbora/project.json` is written.
- Splits, tabs, search and copy/paste work on all three OSes.

### Checklist

- [ ] `TerminalService` with ring buffer
- [ ] Shell detection and login-shell PATH
- [ ] xterm UI with tabs, splits, addons
- [ ] URL detection and open-in-browser
- [ ] Dev command inference, `project.json`, run/restart
- [ ] Process-tree kill on all OSes
- [ ] Tests

---

## Stage 3: Agent panel (ACP)

**Goal.** Talk to any ACP agent from Arbora: Claude Code, Codex, Kimi Code, Grok Build, or a custom command. Full streaming UI, permissions, client-side fs/terminal, persistence.

**Features.** `F-AGENT-01` to `F-AGENT-09`, `F-TERM-05`.

### Instructions

1. `packages/acp-client`:
   - `AgentRegistry`: built-in definitions `{ id, name, command, args, env, installHint, docsUrl }` for the four agents (commands in PLAN section 2), plus custom entries from settings. `detect()` checks `which`/`where` for binaries and `npx` availability.
   - `AgentProcess`: spawns the command with the cached login-shell PATH, pipes stdio, wraps `stdout`/`stdin` into an ACP `Stream` (`ndJsonStream` from the SDK), forwards `stderr` to the log viewer. Restart with backoff on crash; surface exit codes.
   - `AcpSession`: uses `client({ name: 'arbora' })` from `@agentclientprotocol/sdk` (stable v1 entrypoint). Register client handlers: `session/request_permission`, `fs/read_text_file`, `fs/write_text_file`, `terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill`, `terminal/release`, and `session/update` notifications. Call `initialize` with `clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true }`, then `authenticate` if `authMethods` is non-empty and the agent returns auth-required, then `session/new { cwd, mcpServers }`.
   - `UpdateNormalizer`: converts `session/update` variants (`agent_message_chunk`, `agent_thought_chunk`, `user_message_chunk`, `tool_call`, `tool_call_update`, `plan`, `available_commands_update`, `current_mode_update`) into a flat, append-only event log the renderer renders. Store raw messages for the log viewer.
2. `AgentService` in main: one `AcpSession` per thread, thread persistence in `.arbora/threads/<id>.json` (metadata + normalized events, not raw blobs beyond a cap), `prompt(threadId, blocks)`, `cancel(threadId)`, `setMode`, `setModel`, `loadOrResume` when `agentCapabilities.loadSession` / `sessionCapabilities.resume` are advertised.
3. Permissions: show a card with the tool title, kind, locations and raw input; buttons map to the agent's `options` (`allow_once`, `allow_always`, `reject_once`, `reject_always`). Remember "always" choices per agent + tool kind in settings. Add a per-thread "auto-approve edits in project" toggle.
4. Client fs handlers: resolve path, ensure it is inside the project root (`path.relative` not starting with `..`, and `realpath` check), read/write UTF-8, emit `file-changed` events that Stage 8 will consume for "Agent changes".
5. Client terminal handlers: back them with `TerminalService` (Stage 2). Show agent terminals as read-only tabs with an "agent" badge; `terminal/output` returns the buffered output with `truncated` flag honouring `outputByteLimit`.
6. Renderer agent panel: thread list, new thread (agent picker), message list (markdown with code highlighting, images inline), thoughts collapsible, tool call cards with status icon and diff view (reuse CodeMirror merge later; a simple unified diff component now), plan checklist, slash command autocomplete from `available_commands_update`, mode/model dropdowns, cancel button, composer with attachments (files via `resource_link`, images via `image`).
7. ACP log viewer: raw JSON-RPC both directions with redaction of `env` and `token`-like values; export to file.
8. First-prompt instruction block (Stage 5 will extend it): a short system-style preface describing Arbora, the project cwd, and the dev URL.
9. Tests: unit tests for the normalizer and path scoping; an integration test that runs a tiny fake ACP agent (from the SDK examples) end to end; manual matrix against the four real agents recorded in the Progress notes.

### Gotchas

- **SDK entrypoints must not be mixed.** Use `@agentclientprotocol/sdk` (stable v1) everywhere in Arbora. Only switch to `/unstable` or `/experimental/v2` deliberately, project-wide. Mixing produces confusing type errors and runtime method-name mismatches.
- **`authenticate` is conditional.** Some agents (Kimi, Claude Code with a cached login) need no `authenticate` call; Grok requires one and expects `methodId` of `xai.api_key` or `cached_token`. Try `session/new` first; on an auth-required error, run `authenticate` with the first method the user picks, then retry.
- **Grok and Kimi are single binaries that must already be logged in.** If `session/new` fails with auth errors, show the exact login command (`grok login`, `kimi` then `/login`) and a "Retry" button rather than trying to drive the login yourself.
- **Codex adapter ships its own Codex binary.** `@agentclientprotocol/codex-acp` bundles `@openai/codex`; the first `npx` run downloads a large package. Show a spinner with stderr output during startup, and consider pre-warming adapters from Settings.
- **Claude Code ACP terminals.** `claude-code-acp` uses client-side terminals when `terminal: true` is advertised; if your terminal handlers are slow or buggy, every shell command the agent runs breaks. Implement `terminal/wait_for_exit` properly (resolve on exit, not on first output).
- **Permission responses must map to the agent's `optionId` values.** Do not invent ids; echo one of `params.options[].optionId`. If the request is cancelled by the agent (turn cancelled), respond with `{ outcome: { outcome: 'cancelled' } }`.
- **Message chunks arrive interleaved with tool calls.** Keep an ordered event log; do not merge chunks across tool-call boundaries or the transcript reads wrong.
- **`session/cancel` is a notification.** Do not await a response; await the pending `session/prompt` promise resolving with `stopReason: 'cancelled'`.
- **Agent stdout must stay clean.** If an adapter prints a banner on stdout the stream breaks. Kimi and Grok log to stderr correctly; for custom agents, show a parse error with the offending line instead of hanging.
- **Large tool outputs.** Cap stored events (e.g. 2 MB per thread) and truncate tool content in persistence; keep the full content in memory for the current session only.
- **Image prompts.** Check `promptCapabilities.image` before sending `image` blocks (Kimi: yes; Claude Code and Codex: yes; Grok: check at runtime). Otherwise fall back to a file path.

### Acceptance

- For each of Claude Code, Codex, Kimi Code and Grok Build: create a thread, send "add a comment to `fixtures/vite-react/src/App.tsx`", approve the permission, see the diff and the file change on disk.
- An agent command runs in the Terminal panel as a read-only tab.
- Restarting Arbora restores the thread list and transcript; `session/load` works where advertised.
- Log viewer shows redacted traffic.

### Checklist

- [ ] `AgentRegistry` with four built-ins, custom entries, detection
- [ ] `AgentProcess` with PATH handling, stderr capture, restart
- [ ] `AcpSession` with client handlers and capability negotiation
- [ ] `UpdateNormalizer` and persisted event log
- [ ] `AgentService`, thread persistence, load/resume
- [ ] Permission UI with remembered choices
- [ ] Client fs handlers with path scoping and change events
- [ ] Client terminal handlers on `TerminalService`
- [ ] Agent panel UI (threads, transcript, tool cards, plan, slash commands, mode/model, composer)
- [ ] ACP log viewer with redaction
- [ ] Fake-agent integration test; manual matrix recorded

---

## Stage 4: Agent mode (`Mod+K`)

**Goal.** Point at a component, type a prompt, and the agent receives the right source file, a screenshot with the element outlined, and the instruction to verify in the browser.

**Features.** `F-INSPECT-01` to `F-INSPECT-06`.

### Instructions

1. Inspector overlay in `browser-preload` (code in `packages/browser-bridge/overlay/inspector.ts`): a single fixed-position `<div>` host with a closed shadow root containing highlight boxes (content/padding/border/margin colours like DevTools), a label chip, and a breadcrumb bar. Attach `mousemove`/`click`/`keydown` listeners on `window` in capture phase and `preventDefault`/`stopPropagation` while active so the page does not react to clicks. `Esc` exits.
2. Element identity: assign an incrementing `data-arbora-ref` only on selection (never on hover) and keep a `WeakMap<Element, ref>` so refs survive re-renders where the node is reused. Produce a stable CSS selector (id > data-testid > nth-child path) as a fallback.
3. Framework detection (`packages/browser-bridge/detect.ts`), run once per page load and cached: React via `window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers` size or any DOM key starting with `__reactFiber$`; Vue 3 via `__vue_app__` on root or `__vueParentComponent` on nodes; Next (`__NEXT_DATA__` or `next` global), Nuxt (`__NUXT__`), Svelte (`__svelte`), Angular (`ng?.getComponent`), else `html`.
4. Component chain resolution:
   - React: walk `node[__reactFiber$key]` up through `return`, collecting fibers whose `type` is a function/class (skip host components and fragments). For each, `displayName || name`, and `_debugSource` (file, line, column) when present (React <= 18 dev). For React 19, use `_debugOwner` and `_debugStack` to extract file names from stack frames when available.
   - Vue: `node.__vueParentComponent`, walk `parent`, collect `type.__name || type.name`, `type.__file`.
   - Svelte/Angular/plain: skip to tier 3.
5. Tier 3 descriptor: trimmed `outerHTML` (depth-limited to 3 levels, text truncated at 200 chars, data-* and style attributes preserved), class list, text content, a subset of computed styles (display, position, colour, background, font-size, padding, margin), bounding box in CSS pixels. Also list candidate source files by grepping the project (in main, with ripgrep) for the component name and the first two unique class names; include the top five matches as `resource_link`s.
6. Source path mapping: `_debugSource.fileName` can be absolute, `webpack://`, or Vite `/src/...`. Normalise: strip `webpack://_N_E/`, `webpack:///`, resolve `/src/...` against the project root, and verify existence before sending.
7. Prompt popover: rendered by the renderer, anchored at the element rect (converted from page CSS px to window coordinates using the view bounds and zoom). Multiline textarea, Enter submits, `Shift+Enter` newline, chips for attachments with toggles, agent/thread picker defaulting to the last used thread. If the popover would overlap the `WebContentsView`, shrink the view's bounds temporarily (view-over-DOM gotcha).
8. Screenshot: hide the overlay, `captureViewport()`, burn in a 2px outline at the element rect (scaled by `dpr`), restore the overlay.
9. Prompt composer (`packages/browser-bridge/prompt.ts`): deterministic template with sections: Request, Target (framework, tier, component chain, file path:line if known), Context (HTML, styles, console errors since last navigation), Instructions (edit the source, wait for HMR, verify via browser tools when available, report what changed). Blocks: `text` for the body, `image` for the screenshot (or a path when unsupported), `resource_link` for each known file.
10. Mode state machine in the renderer: `idle -> inspecting -> selected -> prompting -> idle`. Entering design mode (Stage 6) from agent mode is a transition, not a reload.
11. Add fixtures `fixtures/next` (App Router) and `fixtures/nuxt`; e2e tests select a known component on each fixture and assert the chain and (for Vite React 18 and Vue) the file path.

### Gotchas

- **React 19 removed `_debugSource`.** Only React <= 18 development builds provide file:line per fiber. On React 19, you get owner stacks and component names; file resolution falls to tier 3 or the Stage 10 dev plugin. Say this clearly in the prompt payload (`tier: 3`) so the agent greps.
- **Fibers on DOM nodes point at host components.** The first interesting ancestor is the nearest function/class component; the user usually means that one, but offer the breadcrumb so they can pick `Card` instead of `CardHeader`.
- **Production builds minify names.** If `displayName` looks minified (one or two characters), label it "anonymous component" and rely on HTML descriptors.
- **Shadow DOM and iframes.** `document.elementFromPoint` stops at shadow hosts; use `composedPath()` from the event to find the deepest element. Cross-origin iframes are opaque; highlight the iframe element and say so.
- **Overlay must survive HMR.** Frameworks re-render the body; keep the host element attached to `document.documentElement` (not `body`) and re-append on `MutationObserver` if removed.
- **Capture-phase listeners can break the page's own hotkeys.** Only intercept while the mode is active and release everything on exit. Restore `document.activeElement` focus.
- **Coordinates.** Page CSS px -> view px (zoom factor, scroll) -> window px (view bounds) -> screen px (window position). Write one helper and unit test it; off-by-DPR bugs are the main source of misplaced popovers and outlines.
- **Huge `outerHTML`.** A selected `<main>` can be megabytes. Depth-limit and size-cap before sending over IPC.
- **Screenshots and image sizes.** Agents have input limits; downscale to max 1568px on the long edge and JPEG-quality PNG optimisation before sending.

### Acceptance

- On `fixtures/vite-react` (React 18 dev build) clicking the button inside `Card` shows chain `Button <- Card <- App` and the path `src/components/Card.tsx:LINE`.
- On `fixtures/nuxt` the chain shows Vue component names and `.vue` paths.
- On `fixtures/next` (React 19) the chain shows names and the payload declares tier 3 with grep candidates.
- Submitting "make this button red" produces a thread where the agent edits the right file and the page updates.
- Agents without image support receive a file path and still succeed.

### Checklist

- [ ] Inspector overlay with shadow root, box model, label, breadcrumb
- [ ] Element refs and selector fallback
- [ ] Framework detection
- [ ] React and Vue component chain resolution
- [ ] Tier 3 descriptor and ripgrep candidates
- [ ] Source path normalisation
- [ ] Prompt popover anchored to element, view-overlap handling
- [ ] Screenshot with highlight
- [ ] Prompt composer and block assembly, image fallback
- [ ] Mode state machine
- [ ] `fixtures/next`, `fixtures/nuxt`, e2e tests

---

## Stage 5: Browser control MCP server and agent skill

**Goal.** The agent can drive Arbora's browser (navigate, click, type, scroll, screenshot, read logs, restart the dev server) so it can verify its own work without the user.

**Features.** `F-MCP-01` to `F-MCP-05`.

### Instructions

1. `packages/mcp-browser-server`: `McpServer` from `@modelcontextprotocol/sdk` with the Streamable HTTP transport on `http.createServer` bound to `127.0.0.1` and port `0`. Middleware checks `Authorization: Bearer <token>`; token generated per ACP session. Expose `start() -> { url, token }`, `stop()`.
2. Register the server in `session/new`: `mcpServers: [{ type: 'http', name: 'arbora-browser', url, headers: [{ name: 'Authorization', value: 'Bearer <token>' }] }]`. If the agent's `mcpCapabilities.http` is false, instead pass a stdio entry `{ name, command: process.execPath, args: [arboraMcpShimPath, url, token], env: [] }` where the shim (a tiny Node script bundled with Arbora) bridges stdio MCP to the HTTP server.
3. Tools (all take an optional `target` for future multi-tab, default current):
   - Navigation: `browser_navigate { url }`, `browser_reload { hard? }`, `browser_back`, `browser_forward`.
   - Observation: `browser_screenshot { mode: 'viewport' | 'full' | 'element', ref?, selector? }` returning an MCP `image` content block; `browser_snapshot` returning an accessibility tree from CDP `Accessibility.getFullAXTree` flattened to a compact YAML-ish text with `ref=eN` ids (mirror Playwright MCP's format, agents already know it); `browser_console_logs { since?, level? }`; `browser_network_errors`; `browser_get_element_source { ref | selector }` reusing Stage 4 resolution; `browser_get_url`.
   - Interaction: `browser_click { ref | selector, button?, double? }`, `browser_hover`, `browser_type { ref, text, submit? }`, `browser_press_key { key }`, `browser_scroll { ref?, dx, dy }`, `browser_select_option { ref, values }`, `browser_wait_for { selector? | text? | networkIdle? , timeoutMs }`, `browser_evaluate { expression }` (runs in the page via CDP `Runtime.evaluate`, returns JSON, 5 s timeout), `browser_set_viewport { preset | width, height, dpr }`.
   - Dev server: `devserver_status`, `devserver_logs { lines? }`, `devserver_restart`, `terminal_run { command, cwd?, timeoutMs }` (new short-lived pty, captured output, killed on timeout).
4. Implement interactions through CDP (`DOM.getBoxModel` -> `Input.dispatchMouseEvent`, `Input.insertText`, `Input.dispatchKeyEvent`) rather than injected JS, so framework event handlers fire like real user input. Resolve `ref` ids from the last snapshot (`DOM.describeNode` by backendNodeId) and `selector` via `DOM.querySelector`.
5. Permissions: every tool call is mirrored into the agent panel as a tool-call card (the agent also reports it via ACP, dedupe by timestamp and name). `browser_navigate` to an origin different from the dev URL prompts once per session. `browser_evaluate` and `terminal_run` are behind a per-project setting (default: ask once).
6. Agent instructions (`packages/acp-client/instructions.ts`): a concise block appended to the first prompt of each session and written to `.arbora/SKILL.md`. Content: what Arbora is, the dev URL, that the browser is already open, the verify loop (edit -> wait for HMR or `devserver_restart` -> `browser_screenshot` -> compare with the request -> iterate), that `browser_snapshot` is cheaper than screenshots for structure, and to finish with a summary plus a final screenshot. Keep it under 400 words.
7. Tests: unit tests for the snapshot formatter and the ref resolver; an e2e where a scripted fake agent calls the tools over HTTP against `fixtures/vite-react` (click a counter button, assert the snapshot changed); a manual run with each real agent recorded in Progress notes.

### Gotchas

- **Agents differ in MCP transport support.** Kimi supports http/sse/stdio; Claude Code and Codex support stdio and http; Grok should be checked at runtime via `initialize` -> `agentCapabilities.mcpCapabilities`. Always have the stdio shim path working.
- **MCP headers in ACP are an array of `{ name, value }`**, not an object. Getting this wrong fails silently (agent sees no tools).
- **Codex/Claude Code may sandbox outbound network.** Localhost is normally allowed, but if an agent runs with a strict sandbox the HTTP MCP server may be unreachable; the stdio shim avoids this. Detect "no tools listed" after `session/new` and warn.
- **Screenshots as MCP image content need `mimeType: 'image/png'` and raw base64** (no data URL prefix). Downscale as in Stage 4.
- **CDP `Input.dispatchMouseEvent` needs `mousePressed` and `mouseReleased` with `clickCount: 1`** and coordinates in CSS px relative to the viewport, after scrolling the element into view (`DOM.scrollIntoViewIfNeeded`).
- **`Accessibility.getFullAXTree` can be huge.** Limit depth, drop generic/ignored nodes without names, cap to ~10k nodes, and tell the agent when truncated.
- **HMR is asynchronous.** After an edit the page may still show old content for a second. `browser_wait_for { networkIdle: true }` plus a short settle is what the instructions should recommend; `devserver_restart` should wait for the URL to respond before returning.
- **Dev server port changes on restart** (Vite picks 5174 if 5173 is busy). Re-detect the URL from the terminal after restart and navigate the browser accordingly.
- **Tool-call mirroring duplicates.** Agents already report MCP tool calls via ACP `tool_call` updates; mirror only the result preview (screenshot thumbnail) to avoid double cards.

### Acceptance

- With any of the four agents: "Change the primary button to red and confirm visually" results in the agent editing the file, taking a screenshot, and replying with a confirmation and the image, without user intervention beyond permissions.
- `browser_snapshot` output includes refs that `browser_click` accepts; the fixture counter increments.
- Navigating to `https://example.com` via the tool prompts for permission once.
- `devserver_restart` brings the server back and the browser reloads on the new URL.

### Checklist

- [ ] MCP server with HTTP transport, token auth, start/stop per session
- [ ] ACP registration (http) and stdio shim fallback
- [ ] Navigation, observation, interaction, dev-server tools
- [ ] CDP-based input and ref resolution
- [ ] Permission surfacing and origin check
- [ ] Agent instructions and `.arbora/SKILL.md`
- [ ] Tests and manual matrix

---

## Stage 6: Design mode (`Mod+D`)

**Goal.** Edit the page visually like Webflow, then hand the agent a precise, reviewable change request with before/after screenshots.

**Features.** `F-DESIGN-01` to `F-DESIGN-09`.

### Instructions

1. Design overlay (`packages/browser-bridge/overlay/design.ts`) sharing the selection and ref machinery from Stage 4. Multi-select with Shift; selection handles; `Esc` deselects, `Esc` again exits with a Save/Discard prompt if there are changes.
2. Op recorder: `applyOp(op)` and `revertOp(op)` for `style`, `text`, `attr`, `move`, `insert`, `delete`. Each op captures `before` and `after` fully (for `move`: old parent, old index, new parent, new index via refs). Undo/redo is a cursor over the op list. Ops are mirrored to main over IPC as they happen so a crash does not lose work.
3. Live preview strategy: `style` ops set inline styles with `!important` on the element (removed on discard); `text` ops edit text nodes directly; `attr` ops set attributes; structure ops mutate the DOM. If the page re-renders (HMR, state change), re-apply the ops by ref/selector and mark ops whose target disappeared as "stale" in the UI.
4. Properties panel (renderer, replaces the agent panel while in design mode): groups from PLAN 4.6. Each control reads `getComputedStyle` of the selection (via preload) and writes a `style` op on change. Spacing uses draggable handles drawn by the overlay (drag margin/padding edges). Colour inputs with eyedropper (`EyeDropper` API in the renderer; fall back to text input).
5. Inline text editing: double-click a text-bearing element sets `contenteditable` on the deepest text container; on blur, record a `text` op with the original and new text. Block `Enter` from inserting `<div>`s (insert `<br>` or finish editing).
6. Structure: drag to move within the same parent or into a sibling container with drop indicators; duplicate (`Mod+D` while in design mode is taken, use `Mod+Shift+D`); delete; insert palette (div, text, image placeholder, button) at the selection's position.
7. Styling-approach detection (main): Tailwind if `tailwind.config.*` or `@import "tailwindcss"` found; CSS modules if `*.module.css` present; styled-components/emotion from `package.json`; else plain CSS. Tailwind mapper: translate common CSS props (spacing scale, colours in the config palette, font sizes, radius, display/flex) to utility classes; unknown values fall back to arbitrary values (`p-[13px]`).
8. Save flow: after screenshot, change list rendered as Markdown (one bullet per op, grouped by component, with before -> after values and, when Tailwind, suggested class changes), resolved sources for every touched component (Stage 4 resolution, deduped), styling approach, then an instruction block ("implement these changes in source so the app matches the after screenshot; do not add inline styles; verify in the browser"). Send both screenshots as `image` blocks (or paths). Then revert the live DOM so the real HMR result is visible.
9. Discard reverts all ops. Session store: `.arbora/design-sessions/<timestamp>.json` with ops and screenshot paths; a "Resend" command loads and sends again.
10. Tests: unit tests for the op recorder (apply/revert round trip), Tailwind mapper; e2e: change padding and text on the fixture card, save, assert the prompt contains the expected bullets and two images.

### Gotchas

- **Inline `!important` styles leak into screenshots and into the agent's view.** Always revert live edits after Save before the agent starts verifying, or the agent will see its own work as already done.
- **Frameworks own the DOM.** React will overwrite text you edited on the next render and may throw on removed nodes ("Failed to execute 'removeChild'"). Keep structure ops minimal in preview, warn that previews of move/delete may be reset by re-renders, and rely on the agent for the real change.
- **Tailwind arbitrary values and JIT.** Suggested classes that are not already in the compiled CSS will not render in preview; the preview uses inline styles anyway, so this only affects the suggestion text. State the config palette mapping assumptions in the prompt.
- **Computed vs authored values.** `getComputedStyle` returns `16px`, not `1rem`; show computed values but record ops in the unit the user typed and include both in the change list.
- **Spacing handles and transforms.** Elements with CSS transforms or inside scaled containers need `getBoundingClientRect` plus transform inversion; start by disabling handles on transformed elements.
- **Keyboard conflicts.** While `contenteditable` is active, all Arbora shortcuts except `Esc` must be suppressed.
- **Before screenshot timing.** Take it on mode entry after a `requestAnimationFrame`, with the overlay hidden; if the user navigates during design mode, prompt to save or discard first.

### Acceptance

- Change text, padding and background on the fixture card, undo one step, redo, save. The agent receives two images and a bullet list, edits source, and the resulting page matches the after screenshot (manual visual check plus `browser_screenshot` from the agent).
- Discard restores the original page without reload.
- Reopening Arbora shows the session in a "Design sessions" list and resend works.

### Checklist

- [ ] Design overlay, selection, handles
- [ ] Op recorder with apply/revert, undo/redo, crash-safe mirroring
- [ ] Live preview and re-apply after re-render
- [ ] Properties panel groups and controls
- [ ] Inline text editing
- [ ] Structure ops and insert palette
- [ ] Styling-approach detection and Tailwind mapper
- [ ] Save flow (screenshots, change list, sources, instructions), discard
- [ ] Session storage and resend
- [ ] Tests

---

## Stage 7: Files and editor

**Goal.** A light file explorer and editor for the occasional hand edit, plus the diff viewer the Git panel needs.

**Features.** `F-FILES-01` to `F-FILES-03`, `F-EDITOR-01` to `F-EDITOR-03`, `F-GIT-04` (viewer component).

### Instructions

1. `WorkspaceService` in main: `readDir` (lazy), `stat`, `readFile`, `writeFile`, `rename`, `delete` (to trash via `shell.trashItem`), `createFile/Dir`, `revealInOS`. Watcher with `chokidar` honouring `.gitignore` (use `ignore` package) and always ignoring `node_modules`, `.git`, `dist`, `.next`, `.nuxt`. Emit coalesced change events.
2. Explorer UI: virtualised tree, lazy expansion, inline rename, context menu, drag-and-drop move, git decorations placeholder (Stage 8 fills it). Open file on click; double-click pins the tab.
3. Quick open (`Mod+P`): index file paths with ripgrep `--files`, fuzzy match in a worker (`fzf`-style scoring), refresh on watcher events.
4. Search panel: ripgrep JSON output streamed to the renderer, include/exclude globs, case/regex toggles, results grouped by file, click to open at line.
5. Editor: CodeMirror 6 with `@codemirror/lang-javascript` (ts/tsx/jsx), `lang-html`, `lang-css`, `lang-json`, `lang-markdown`, `lang-python`, `lang-go`, `lang-rust`, `lang-vue`, `lang-svelte` (community packages where no official one exists), bracket matching, folding, multiple selections, search, theme matching the app. Tabs with dirty state, `Mod+S` saves, external change detection with reload prompt.
6. Format on save: if the project has Prettier in `node_modules`, run it in a utility process (`utilityProcess.fork`) with the project's config; otherwise skip. Never bundle a formatter.
7. Diagnostics on save: run `eslint --format json <file>` and, for TS files, `tsc --noEmit --pretty false` scoped by the project's `tsconfig` in a utility process with a debounce and a 10 s timeout; map output to `@codemirror/lint` diagnostics and the Problems tab. Make this a setting (default on for ESLint, off for tsc because it is slow on large projects).
8. Diff viewer component on `@codemirror/merge`: side-by-side and unified, word-level diffs, collapse unchanged regions. Used by Stage 8 and by agent tool-call cards.
9. Terminal link-to-file (Stage 2 placeholder) and agent `locations` clicks open the editor at line.

### Gotchas

- **Utility processes, not worker threads, for tooling.** ESLint/Prettier/tsc load project code and plugins; run them in `utilityProcess` with `cwd` = project so module resolution matches the user's setup. Kill on project close.
- **ESLint flat config vs legacy.** Detect `eslint.config.*` versus `.eslintrc*` and set `ESLINT_USE_FLAT_CONFIG` accordingly for older ESLint versions.
- **`tsc` is slow and memory hungry.** Debounce to 2 s after save and never run two at once. Prefer `tsc --build` when project references exist.
- **File watching limits on Linux.** `chokidar` can hit `ENOSPC` (inotify limits) on big repos. Catch it, fall back to polling for the open directories only, and show a hint to raise `fs.inotify.max_user_watches`.
- **Windows path case and line endings.** Preserve the file's original EOL on save; detect it on read.
- **CodeMirror language packages for Vue/Svelte are community-maintained.** Pin versions and treat them as best-effort highlighting.
- **Large files.** Open files above 2 MB read-only with syntax highlighting disabled.

### Acceptance

- Open, edit, save `src/App.tsx` in the fixture; Prettier formats; ESLint diagnostics show in the gutter and Problems tab.
- Quick open finds files in under 100 ms on a 10k-file repo; search streams results.
- The diff viewer renders a change with word-level highlighting in both layouts.

### Checklist

- [ ] `WorkspaceService` and watcher with ignore rules
- [ ] Explorer tree with rename/move/context menu
- [ ] Quick open with fuzzy index
- [ ] Ripgrep search panel
- [ ] CodeMirror editor, tabs, save, external change detection
- [ ] Prettier on save via utility process
- [ ] ESLint/tsc diagnostics on save (settings)
- [ ] Diff viewer component
- [ ] Open-at-line wiring from terminal and agent locations

---

## Stage 8: Git and GitHub

**Goal.** Manage change history, review agent edits, commit, push and open PRs without leaving Arbora.

**Features.** `F-GIT-01` to `F-GIT-07`, `F-GIT-04` integration, `F-GIT-05`.

### Instructions

1. `GitService` on `simple-git` with the cached PATH: `status` (porcelain v2 with renames), `diff` (file, staged, hunk ranges), `stage`/`unstage` file and hunk (apply patch with `git apply --cached`), `discard`, `commit` (message, amend, sign-off, GPG/SSH signing passthrough), `branches`, `checkout`, `createBranch`, `log` (graph via `--graph --format` or compute from parents), `push`/`pull`/`fetch` with progress, `stash` list/apply/pop/drop, `remotes`. Poll status on watcher events (debounced) and on focus.
2. Git panel UI: groups Staged / Changes / Untracked / Agent changes; hunk staging in the diff viewer; commit box with "Generate message" (sends the staged diff to the current agent thread or a one-shot session and inserts the result); branch switcher; log view with graph and commit details; push/pull/fetch buttons with ahead/behind counts; stash list.
3. "Agent changes" group: files from Stage 3 `file-changed` events plus watcher changes that happen during an active agent turn, tagged with thread id; "Review" opens the diff; "Accept all" stages; "Revert" discards.
4. Explorer decorations and editor gutter markers from status/diff.
5. GitHub: detect `origin` remote on github.com; auth by (a) `gh auth token` if `gh` is installed and logged in, else (b) OAuth device flow with an Arbora GitHub App client id (store token in `safeStorage`). Octokit for: list PRs for the current branch, create PR (title/body optionally drafted by the agent from the commit range), open in browser, check runs summary polled every 60 s while the panel is visible.
6. Credential helpers: pushes rely on the user's existing git credential setup (SSH agent, credential manager). Surface git's stderr clearly when auth fails; do not implement a credential store.
7. Tests: unit tests against a temporary repo for status/stage/hunk/commit; e2e for the panel on the fixture repo; manual GitHub flow against a scratch repo recorded in Progress notes.

### Gotchas

- **Hunk staging is patch application.** Build the partial patch from the diff hunks the user selected with correct headers and line counts; `git apply --cached --unidiff-zero` is unforgiving. Reuse a tested library approach (parse with `diff` package, re-serialize) rather than string slicing.
- **`simple-git` spawns `git` with the inherited env.** Set `GIT_TERMINAL_PROMPT=0` so a missing credential fails fast instead of hanging, and `LANG=C` for stable parsing.
- **Windows line endings and `core.autocrlf`.** Status can show whole-file diffs after an agent writes LF files; respect `.gitattributes` and show a hint rather than "fixing" it.
- **Watcher storms during `git checkout`.** Suspend the status poller while Arbora itself runs a git command, and coalesce events for 300 ms after.
- **Device flow needs the GitHub App to allow it.** Create the OAuth App with "Enable Device Flow" checked; scopes `repo` and `read:org`. Store the client id in the app, never a secret.
- **`gh` token reuse** is the fastest path for most developers; prefer it, but the token may lack `repo` scope for org repos with SSO. Show the GitHub error body.
- **Signing.** If the user has `commit.gpgsign`, pinentry may need a TTY; pass through and surface the failure with the exact git message.

### Acceptance

- Stage a hunk, commit with an agent-generated message, push, open a PR, see CI status, all from the panel, against a scratch GitHub repo.
- After an agent turn, the Agent changes group lists exactly the files it touched; Revert restores them.
- Explorer and editor gutters show git state.

### Checklist

- [ ] `GitService` with status/diff/stage/hunks/commit/branches/log/push/pull/stash
- [ ] Git panel UI and hunk staging
- [ ] Agent changes group with review/accept/revert
- [ ] Explorer decorations and gutter markers
- [ ] Generate commit message via agent
- [ ] GitHub auth (`gh` token or device flow) and PR create/list/status
- [ ] Tests and manual GitHub run

---

## Stage 9: Distribution and polish

**Goal.** Installable, signed, auto-updating builds for all three OSes, an onboarding flow that gets a new user to a working agent-mode prompt, and a settings UI.

**Features.** `F-ONBOARD-01`, `F-ONBOARD-02`, `F-NFR-02`, `F-NFR-03`, `F-NFR-04`.

### Instructions

1. Signing and notarization: macOS Developer ID certificate in CI secrets, `electron-builder` `notarize` with an App Store Connect API key, hardened runtime entitlements (`com.apple.security.cs.allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation` for native modules). Windows: Azure Trusted Signing or an EV certificate via `signtool`; if neither is available yet, ship unsigned with SmartScreen documentation. Linux: no signing; publish checksums.
2. Targets: AppImage and `.deb` (Debian/Ubuntu), a `.tar.gz` plus an AUR `PKGBUILD` (`arbora-bin`) in a separate `aur/` directory with a release script that bumps `pkgver` and `sha256sums`; `.dmg` universal (arm64 + x64) or separate; NSIS `.exe` with per-user install.
3. Auto-update: `electron-updater` with GitHub Releases provider, channels `latest` and `beta`, "check for updates" command, release notes dialog. AppImage updates in place; `.deb` and AUR users get a notification with instructions instead.
4. Release workflow: tag `v*` -> matrix build -> sign -> notarize -> upload to a draft release -> publish on approval.
5. Onboarding wizard: welcome, open project, detect dev command (editable), start dev server, detect agents (with install hints and "test connection" that runs `initialize`), keybinding probe with fallback explanation, finish with a guided `Mod+K` on the running page.
6. Settings UI: agents (add/edit custom, env overrides, adapter versions and "update adapters"), keybindings editor with conflict detection, theme, browser (partition reset, trust localhost certs, DevTools extensions), MCP tool permissions, dev server, screenshots folder, diagnostics toggles, LSP opt-in (Stage 10 ships it).
7. Performance budget in CI: launch the packaged app on Linux, load the fixture, measure RSS after 10 s and screenshot latency; fail if over budget (350 MB, 300 ms). Lazy-load CodeMirror languages and xterm addons.
8. Accessibility: keyboard navigation across panels, focus rings, ARIA on custom controls, reduced-motion support.
9. Crash handling: `crashReporter` disabled (no telemetry); local crash dumps and an "Export diagnostics" command that zips logs and settings (redacted).
10. Docs: `README.md` install instructions per OS, FAQ (Super key fallback, macOS PATH, Windows SmartScreen, Arch sandbox), agent setup pages.

### Gotchas

- **Notarization fails on unsigned native binaries inside `node_modules`** (node-pty's spawn-helper, ripgrep). `electron-builder` signs nested binaries when they are not in `asar`; keep them in `asarUnpack` and verify with `codesign --verify --deep --strict`.
- **Universal macOS builds need both architectures of every native module.** Either build arm64 and x64 separately (simpler, two downloads) or use `@electron/universal` and ensure prebuilt binaries exist for both.
- **AppImage on Arch and Wayland.** Some setups need `--no-sandbox` or `--ozone-platform=wayland`; expose `ARBORA_FLAGS` env and document. The AUR package should install to `/opt/arbora` with a `.desktop` file and a wrapper script.
- **Windows per-user NSIS installs and auto-update** work without admin; per-machine installs break `electron-updater`. Keep per-user.
- **`electron-updater` requires `latest.yml` / `latest-mac.yml` / `latest-linux.yml`** in the release; publishing from a draft requires `GH_TOKEN` with `repo` scope in CI.
- **Keybinding editor must prevent trapping `Esc`** and the exit-mode chords; reserve them.
- **`safeStorage` on Linux** depends on a keyring (gnome-keyring/kwallet). Fall back to a warning and plaintext-with-consent if `isEncryptionAvailable()` is false.

### Acceptance

- Fresh install on Debian, Arch (AUR), macOS and Windows reaches a working `Mod+K` prompt through onboarding without reading docs.
- Updates download and apply on macOS/Windows/AppImage; others get a notification.
- CI release pipeline produces signed and notarized artifacts from a tag.
- Performance budget job passes.

### Checklist

- [ ] macOS signing and notarization, entitlements
- [ ] Windows signing (or documented unsigned path)
- [ ] Linux targets: AppImage, deb, tarball, AUR PKGBUILD and release script
- [ ] `electron-updater` with channels
- [ ] Release workflow from tags
- [ ] Onboarding wizard
- [ ] Settings UI
- [ ] Performance budget job
- [ ] Accessibility pass
- [ ] Diagnostics export
- [ ] User docs

---

## Stage 10: Stretch

**Goal.** Improvements that are valuable but not required for the core workflow. Pick in order of user demand.

### Items

1. **`@arbora/dev-plugin`** (tier 1 source mapping): Vite plugin, Next/webpack loader and Nuxt module that add `data-arbora-src="path:line:col"` to JSX/Vue template elements in development (same approach as `code-inspector-plugin`). Arbora detects the attribute and reports exact locations regardless of React version. Offer "Install dev plugin" from the inspector when tier 3 is in use.
   - Gotcha: attributes on fragments and custom components do not reach the DOM; only host elements get them, so the chain still comes from fibers.
2. **Multiple browser tabs**: one `WebContentsView` per tab, tab strip in the browser chrome, MCP `target` parameter wired.
3. **Parallel agent sessions with git worktrees**: each thread optionally gets a worktree and its own dev server port; the browser switches per thread.
   - Gotcha: `node_modules` per worktree; offer `pnpm install` on worktree creation or share via a workspace symlink strategy.
4. **Design-mode direct write-through**: for tier 1 targets in Tailwind projects, apply class edits directly to the source file and skip the agent round trip; keep a one-click "Ask agent instead".
5. **Design session history**: list, compare, resend, export as Markdown.
6. **Agent action traces**: record MCP browser actions as a Playwright-like trace (screenshots per step) viewable in the thread.
7. **LSP opt-in**: `@codemirror/lsp-client` + `typescript-language-server` spawned per project; hover, go-to-definition, completions.
   - Gotcha: the language server must be the project's TypeScript version; resolve `node_modules/typescript` first.
8. **Agent-mode on production builds**: heuristics to map minified components via source maps when available (`//# sourceMappingURL`), using CDP `Debugger.getScriptSource`.

### Checklist

- [ ] Dev plugin (Vite, webpack/Next, Nuxt) and inspector integration
- [ ] Browser tabs
- [ ] Worktree sessions
- [ ] Tailwind write-through
- [ ] Design session history
- [ ] Action traces
- [ ] LSP opt-in
- [ ] Source-map assisted mapping

---

## Appendix A: Definition of done for every stage

- Code typechecks (`strict`), lints, unit tests pass on all three OSes in CI.
- e2e smoke passes against the fixtures touched by the stage.
- New IPC channels have zod schemas in `packages/shared` and are documented in the channel registry.
- New settings have defaults, schema entries and UI (from Stage 9 onward).
- Stage checklist and Progress table updated in this file; new gotchas recorded.
- No secrets, tokens or absolute user paths in logs or committed fixtures.

## Appendix B: Manual test matrix (record results in Progress notes)

| Scenario | Claude Code | Codex | Kimi Code | Grok Build |
| --- | --- | --- | --- | --- |
| Stage 3: edit a file with permission | | | | |
| Stage 4: `Mod+K` prompt with image | | | | |
| Stage 4: `Mod+K` prompt with path fallback | | | | |
| Stage 5: MCP tools over http | | | | |
| Stage 5: MCP tools over stdio shim | | | | |
| Stage 5: verify loop completes unaided | | | | |
| Stage 6: design save applied correctly | | | | |
| Stage 8: generate commit message | | | | |

Fill cells with `ok`, `partial (note)` or `fail (issue link)` and the agent/adapter version tested.
