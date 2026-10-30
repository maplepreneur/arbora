# AGENTS.md

Conventions for agents building Arbora. The full rules live in [docs/BUILD_STAGES.md](docs/BUILD_STAGES.md) ("Code conventions for the builder agent" and the per-stage gotchas); read them before starting a stage.

Cursor always-on copy of the progress rule: [`.cursor/rules/update-stage-progress.mdc`](.cursor/rules/update-stage-progress.mdc).

## Shipping

Until told otherwise (set 30 Oct 2026): commit on `main` and push `origin main`. Do not open a branch or a pull request. GitHub Actions minutes for this private repo are used up for the month, and review PRs are not worth a CI run while development is this fast.

- The progress update below goes in that same commit. Do not leave it for a follow-up.
- Run `pnpm typecheck && pnpm lint && pnpm test` before a push that contains code. Run `pnpm e2e` when the change touches the Electron app (needs a display; use `xvfb-run -a` on headless Linux).
- A push of code to `main` still starts the Linux CI job. Changes that only touch `**/*.md`, `docs/**` or `.cursor/**` do not. Do not add `ci:all-os` and do not start the all-OS workflow. Batch commits so a stage is not one push per file.
- This section is what to revert when Actions minutes are back and PRs are wanted again.

## End of work: update progress

A task is not finished until the phase docs match what you just did. Update them in the **same commit** as the work. Do not leave the tracker for a follow-up commit, and do not skip this because the change was "docs only", a fix, CI, or verification.

1. Read [docs/BUILD_STAGES.md](docs/BUILD_STAGES.md) **Progress** and the current stage checklist, and [docs/PLAN.md](docs/PLAN.md) **Current phase**.
2. Tick finished checklist items. Leave unverified items unchecked (especially Omarchy/Hyprland `arch-ok`).
3. Set the Progress table **Status** and **Notes** for every stage you touched. Notes must be true *now*: on `main` or not, CI result (name red jobs), what is left, what comes next. Do not leave "then merge" after the work is on `main`.
4. Rewrite **Current phase** in `docs/PLAN.md` so **Now / Next / Blockers** match that table.
5. Append new gotchas to the stage that discovered them. Fill Appendix B cells when you ran a manual agent matrix.

Status values: `Not started`, `In progress` or `In progress (PR #N)` / `In progress (PR #N, merged)`, `Blocked (reason)`, `Done` or `Done (PR #N)`. During direct-to-main, new work uses `In progress` or `Done` and names the commit on `main`. Keep `PR #N` on stages that already landed that way.

Never mark a stage `Done` from CI alone. The definition of done requires `arch-ok` on Omarchy/Hyprland (see BUILD_STAGES "Local testing"). Until then the status stays `In progress` or `Blocked`.

When you finish a stage's code, point the next unstarted stage's Notes at "Next stage" and say what hand-off is ready (hooks, fixtures, settings).

## Commands

- `pnpm install` (postinstall runs `install-electron`; Electron 45 no longer downloads its binary on install)
- `pnpm typecheck && pnpm lint && pnpm test` before every code push; `pnpm e2e` for the Electron smoke tests (needs a display; use `xvfb-run -a` on headless Linux)
- CI minutes are billed, and the monthly allowance is used up (30 Oct 2026). Ship on `main` (see Shipping). A code push to `main` still runs the Linux job. Do not open a PR and do not request macOS or Windows (`ci:all-os` or "Run workflow" with `all_os`, 10x and 2x minutes) until minutes are back.
- `pnpm dev -- /absolute/path/to/project` to launch with a project open

## Where things go

- IPC: add channels and events to `packages/shared/src/channels.ts` (zod schemas both ways). Register handlers in `apps/desktop/src/main/index.ts` with `defineHandler`; the renderer calls `window.arbora.invoke(...)` and never imports `electron`.
- Commands: add a `CommandId` and descriptor to `packages/shared/src/commands.ts`, then handle it in the exhaustive `switch` in `apps/desktop/src/renderer/src/commands.ts`. Set `intercept: true` only for chords that must beat the embedded page (mode chords, palette).
- Settings: extend `appSettingsSchema` with a default for every new field; bump `SETTINGS_VERSION` and append a migration when a change is not backwards compatible.
- Panels: lazy-loaded from `apps/desktop/src/renderer/src/panels/` via `React.lazy` in `Workspace.tsx`.
- Browser panel: `apps/desktop/src/main/browser/` (`BrowserService` owns the `WebContentsView`, CDP and screenshots; `BrowserSessions` owns per-project partitions, extensions and the certificate rule). Messages between the page preload (`src/preload/browser.ts`) and main use `packages/shared/src/page-ipc.ts`, not the app's channel registry. Pure CDP/image helpers stay in separate files with unit tests.
- Terminal: `apps/desktop/src/main/terminal/`. `TerminalService` owns the node-pty processes, line buffers and URL detection; `DevServer` handles run/restart; `shell-env.ts` provides the login-shell PATH, and `process-tree.ts` the tree kill. Pure parsing (URLs, shells, dev command, clipboard chords) lives in `packages/shared/src/terminal.ts`. The renderer keeps xterm instances in `panels/terminal/sessions.ts`, outside React, and tab/split state in `terminal-store.ts`.
- Agent panel: `packages/acp-client` holds everything that speaks ACP and has no Electron dependency (`AgentRegistry`, `AgentProcess`, `AcpSession` on the SDK's stable v1 `client()`, `UpdateNormalizer`, path scoping, redaction, the fake agent under `src/testing/`). `apps/desktop/src/main/agent/` has `AgentService` (one session per thread, `.arbora/threads/<id>.json`), `AgentTerminals` (ACP `terminal/*` on `TerminalService`), `attachments.ts` and `ThreadStore`. The renderer keeps thread state in `agent-store.ts` and the UI in `panels/agent/`. Test real agents with `/tmp` scripts that drive the built app through Playwright (see the Stage 3 gotchas); never commit agent credentials or raw ACP logs.
- Agent mode (`Mod+K`): in-page code lives in `packages/browser-bridge` and is imported by the browser preload as `@arbora/browser-bridge/page`: the overlay, descriptors, and `detect.ts`/`components.ts`, which run in the page's main world via `main-world.ts`, so keep them self-contained. Main imports only the DOM-free composer from `@arbora/browser-bridge`. `apps/desktop/src/main/agent-mode/` resolves sources and candidates and sends the prompt; the renderer's state machine is `mode.ts`, and its UI is `panels/agent-mode/`.
- Browser tools for agents (MCP, Stage 5): `packages/mcp-browser-server` is Electron-free. `BrowserMcpServer` (stateless Streamable HTTP on `127.0.0.1`, bearer token), the tools in `tools.ts` with their permission checks in `ToolContext`, CDP-only helpers (`snapshot.ts`, `refs.ts`, `input.ts`, `page.ts`) and the stdio shim (`shim.ts`, built to `out/main/mcp-shim.js`). Main implements its `BrowserToolHost` in `apps/desktop/src/main/mcp/browser-tool-host.ts`, and `AgentService` attaches one server per agent process through the `mcp` option. Add a tool in `tools.ts` with a test in `server.test.ts`, and a step in the fake agent's "tool sweep" when it needs the real page.
- Git (Stage 8): `apps/desktop/src/main/git/` (`GitService` spawns `git`; `github.ts` uses the `gh` CLI). The renderer panel is `panels/GitPanel.tsx`, decorations go through `setGitDecorations` in `files-store.ts`, and the editor gutter is fed from `git-client.ts`.
- Files and editor (Stage 7): `apps/desktop/src/main/workspace/` has `WorkspaceService` (project-scoped fs through `resolveInsideRoot`), `ProjectWatcher` and `IgnoreRules` (chokidar plus `.gitignore`), `FileIndex` and `text-search.ts` (ripgrep with Node fallbacks), and `tooling/` (`ToolingService`; the project's own Prettier and ESLint run in `tooling/worker.ts`, built to `out/main/tooling-worker.js` as a `utilityProcess`, and `tsc` in its own). Loading modules from the user's project goes through `src/main/lazy/project-modules.ts`. The renderer keeps tabs, the tree and diagnostics in `files-store.ts`, and CodeMirror state in `panels/editor/sessions.ts`, outside React. The editor chunk registers an `EditorController`, so `commands.ts` never imports CodeMirror. Open a file with `openFile(path, { at })` and a diff with `openDiff(...)`.
- Tests: unit tests next to the source as `*.test.ts` (Vitest); e2e in `apps/desktop/e2e/`. Terminal and agent tests spawn ptys, so run them outside Cursor's sandbox. Browser e2e tests start the fixtures themselves (`e2e/servers.ts`) and drive the page via `webContents.executeJavaScript`/`sendInputEvent` from main; find the page's webContents by its `arbora-browser-` partition and skip `devtools:` URLs, which share the session.
