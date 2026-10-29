# AGENTS.md

Conventions for coding agents working on Arbora. Read [docs/BUILD_STAGES.md](docs/BUILD_STAGES.md) (the current stage, its gotchas and the cross-cutting gotchas) before changing code.

## Commands

- `pnpm install` (pnpm 10, `node-linker=hoisted`)
- `pnpm typecheck && pnpm lint && pnpm test` before every push
- `pnpm e2e` for the Playwright-for-Electron smoke test (needs a display; use `xvfb-run` on headless Linux)
- `pnpm dev` to run the app; `ARBORA_USER_DATA_DIR=/tmp/arbora-dev pnpm dev` for clean settings

## Rules

- TypeScript strict everywhere; no `any` without a comment explaining why.
- All IPC goes through zod channels in `packages/shared/src/channels.ts`. The renderer never imports `electron`; it talks to main through `window.arbora` only.
- Imports at the top of the file. `import()` is only allowed in `apps/desktop/src/main/lazy/` and `apps/desktop/src/renderer/src/lazy.ts` (ESLint enforces this).
- Exhaustive `switch` over unions and enums with a `never` default (ESLint enforces this).
- Services in main are plain classes with `dispose()`; no module-level singletons holding process handles.
- New commands register in the command registry; new keybindings go in `defaultKeybindings` in `packages/shared/src/keybindings.ts`. Set `intercept: true` only for chords that must work while the embedded page has focus.
- Settings changes need a schema version bump and a migration in `packages/shared/src/settings.ts`, with a test.
- Every new tool, command or setting gets a unit test or an e2e step.
- In e2e tests, press intercepted chords with `pressNative` from `apps/desktop/e2e/app.ts`; Playwright's `keyboard.press` bypasses `before-input-event`.
- One PR per stage, a commit per logical change. Tick the stage checklist, update the Progress table and record new gotchas in BUILD_STAGES.md in the same PR.
