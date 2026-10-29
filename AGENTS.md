# AGENTS.md

Conventions for agents building Arbora. The full rules live in [docs/BUILD_STAGES.md](docs/BUILD_STAGES.md) ("Code conventions for the builder agent" and the per-stage gotchas); read them before starting a stage.

Cursor always-on copy of the progress rule: [`.cursor/rules/update-stage-progress.mdc`](.cursor/rules/update-stage-progress.mdc).

## End of work: update progress

A task is not finished until the phase docs match what you just did. Update them in the **same PR** as the work. Do not open a follow-up "update the tracker" PR, and do not skip this because the change was "docs only", a fix, CI, or verification.

1. Read [docs/BUILD_STAGES.md](docs/BUILD_STAGES.md) **Progress** and the current stage checklist, and [docs/PLAN.md](docs/PLAN.md) **Current phase**.
2. Tick finished checklist items. Leave unverified items unchecked (especially Omarchy/Hyprland `arch-ok`).
3. Set the Progress table **Status** and **Notes** for every stage you touched. Notes must be true *now*: merged or not, CI result (name red jobs), what is left, what comes next. Do not leave "then merge" after a PR is merged.
4. Rewrite **Current phase** in `docs/PLAN.md` so **Now / Next / Blockers** match that table.
5. Append new gotchas to the stage that discovered them. Fill Appendix B cells when you ran a manual agent matrix.

Status values: `Not started`, `In progress (PR #N)` or `In progress (PR #N, merged)`, `Blocked (reason)`, `Done (PR #N)`.

Never mark a stage `Done` from CI alone. The definition of done requires `arch-ok` on Omarchy/Hyprland (see BUILD_STAGES "Local testing"). Until then the status stays `In progress` or `Blocked`.

When you finish a stage's code, point the next unstarted stage's Notes at "Next stage" and say what hand-off is ready (hooks, fixtures, settings).

## Commands

- `pnpm install` (postinstall runs `install-electron`; Electron 45 no longer downloads its binary on install)
- `pnpm typecheck && pnpm lint && pnpm test` before every push; `pnpm e2e` for the Electron smoke tests (needs a display; use `xvfb-run -a` on headless Linux)
- `pnpm dev -- /absolute/path/to/project` to launch with a project open

## Where things go

- IPC: add channels and events to `packages/shared/src/channels.ts` (zod schemas both ways). Register handlers in `apps/desktop/src/main/index.ts` with `defineHandler`; the renderer calls `window.arbora.invoke(...)` and never imports `electron`.
- Commands: add a `CommandId` and descriptor to `packages/shared/src/commands.ts`, then handle it in the exhaustive `switch` in `apps/desktop/src/renderer/src/commands.ts`. Set `intercept: true` only for chords that must beat the embedded page (mode chords, palette).
- Settings: extend `appSettingsSchema` with a default for every new field; bump `SETTINGS_VERSION` and append a migration when a change is not backwards compatible.
- Panels: lazy-loaded from `apps/desktop/src/renderer/src/panels/` via `React.lazy` in `Workspace.tsx`.
- Browser panel: `apps/desktop/src/main/browser/` (`BrowserService` owns the `WebContentsView`, CDP and screenshots; `BrowserSessions` owns per-project partitions, extensions and the certificate rule). Messages between the page preload (`src/preload/browser.ts`) and main use `packages/shared/src/page-ipc.ts`, not the app's channel registry. Pure CDP/image helpers stay in separate files with unit tests.
- Terminal: `apps/desktop/src/main/terminal/`. `TerminalService` owns the node-pty processes, line buffers and URL detection; `DevServer` handles run/restart; `shell-env.ts` provides the login-shell PATH, and `process-tree.ts` the tree kill. Pure parsing (URLs, shells, dev command, clipboard chords) lives in `packages/shared/src/terminal.ts`. The renderer keeps xterm instances in `panels/terminal/sessions.ts`, outside React, and tab/split state in `terminal-store.ts`.
- Tests: unit tests next to the source as `*.test.ts` (Vitest); e2e in `apps/desktop/e2e/`. Browser e2e tests start the fixtures themselves (`e2e/servers.ts`) and drive the page via `webContents.executeJavaScript`/`sendInputEvent` from main; find the page's webContents by its `arbora-browser-` partition and skip `devtools:` URLs, which share the session.
