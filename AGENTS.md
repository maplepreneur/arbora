# AGENTS.md

Conventions for agents building Arbora. The full rules live in [docs/BUILD_STAGES.md](docs/BUILD_STAGES.md) ("Code conventions for the builder agent" and the per-stage gotchas); read them before starting a stage.

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
- Tests: unit tests next to the source as `*.test.ts` (Vitest); e2e in `apps/desktop/e2e/`. Browser e2e tests start the fixtures themselves (`e2e/servers.ts`) and drive the page via `webContents.executeJavaScript`/`sendInputEvent` from main; find the page's webContents by its `arbora-browser-` partition and skip `devtools:` URLs, which share the session.
