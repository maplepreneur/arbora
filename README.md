# arbora

Arbora is a cross-platform desktop app (Linux, macOS, Windows) for building web apps by pointing at the running app instead of editing code. An embedded browser shows your dev server; a side panel hosts any ACP-compatible coding agent (Claude Code, Codex, Kimi Code, Grok Build, or your own). Press `Mod+K` to point at a component and describe a change, or `Mod+D` to edit the page visually and hand the agent the diff.

## Documentation

- [docs/PLAN.md](docs/PLAN.md): product summary, stack decision, architecture, full feature specification, ADRs.
- [docs/BUILD_STAGES.md](docs/BUILD_STAGES.md): stage-by-stage build instructions, gotchas, acceptance criteria and progress tracking.
- [AGENTS.md](AGENTS.md): conventions and commands for coding agents working in this repo.

## Development

Requirements: Node 22.12+ and pnpm 10 (`corepack enable` picks up the pinned version).

```bash
pnpm install
pnpm dev                  # run the desktop app with hot reload
pnpm dev -- /path/to/app  # open a project directly
```

| Command          | What it does                                                                |
| ---------------- | --------------------------------------------------------------------------- |
| `pnpm typecheck` | `tsc -b` over every package (project references)                            |
| `pnpm lint`      | ESLint and Prettier check                                                   |
| `pnpm test`      | Vitest unit tests                                                           |
| `pnpm e2e`       | Builds without minification and runs the Playwright-for-Electron smoke test |
| `pnpm package`   | Builds unsigned installers for the current OS into `apps/desktop/dist/`     |

Run `pnpm typecheck && pnpm lint && pnpm test` before pushing.

### Layout

```
apps/desktop               Electron app (electron-vite: main, preload, browser-preload, renderer)
packages/shared            zod IPC channels, settings schemas, keybindings, command registry
packages/acp-client        ACP client (Stage 3)
packages/browser-bridge    page instrumentation (Stage 1+)
packages/mcp-browser-server  browser control MCP server (Stage 5)
fixtures/vite-react        React 19 + Vite + Tailwind test app
fixtures/plain-html        static HTML test app (`node fixtures/plain-html/server.js`)
```

### Settings and keybindings

App settings live in `settings.json` under Electron's userData directory (`~/.config/arbora` on Linux); run **Open Settings (JSON)** from the command palette to edit them. Changes are picked up live. Per-project settings live in `<project>/.arbora/project.json` and override app settings.

`Mod` is Ctrl on Linux and Windows and Cmd on macOS. Defaults:

| Chord         | Command                                 |
| ------------- | --------------------------------------- |
| `Mod+Shift+P` | Command palette                         |
| `Mod+K`       | Agent mode (placeholder until Stage 4)  |
| `Mod+D`       | Design mode (placeholder until Stage 6) |
| `Esc`         | Exit the active mode                    |
| `Mod+O`       | Open project                            |
| `Mod+B`       | Toggle sidebar                          |
| `Mod+J`       | Toggle bottom panel                     |

Rebind or unbind (with `null`) in `settings.json`:

```json
{
  "keybindings": { "arbora.agentMode": "mod+shift+k", "arbora.designMode": null },
  "terminalPassthrough": true
}
```

`terminalPassthrough` (default on) lets plain Ctrl chords such as `Ctrl+K` and `Ctrl+D` reach the shell when a terminal has focus.

### Environment variables

- `ARBORA_FLAGS`: extra Chromium switches appended at startup, space-separated, for example `ARBORA_FLAGS="--disable-gpu-sandbox"` for NVIDIA on Hyprland. `--enable-features` values are merged with Arbora's own.
- `ARBORA_USER_DATA_DIR`: use a different userData directory (handy for testing with clean settings).

On Linux Arbora runs natively on Wayland (`ozone-platform-hint=auto`) and reports its app id as `arbora`.
