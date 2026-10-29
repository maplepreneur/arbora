# arbora

Arbora is a cross-platform desktop app (Linux, macOS, Windows) for building web apps by pointing at the running app instead of editing code. An embedded browser shows your dev server; a side panel hosts any ACP-compatible coding agent (Claude Code, Codex, Kimi Code, Grok Build, or your own). Press `Mod+K` to point at a component and describe a change, or `Mod+D` to edit the page visually and hand the agent the diff.

## Development

Requires Node.js 22.12+ and pnpm 10 (`corepack enable`).

```bash
pnpm install                                  # also downloads Electron and rebuilds native deps
pnpm dev                                      # run the app with HMR
pnpm dev -- "$PWD/fixtures/vite-react"        # open a project on launch (absolute path)
pnpm typecheck && pnpm lint && pnpm test      # what CI runs on Linux, macOS and Windows
pnpm e2e                                      # build once, then Playwright-for-Electron smoke tests
pnpm package                                  # unsigned installers in apps/desktop/dist/
```

`Mod` is Ctrl on Linux and Windows and Cmd on macOS. Defaults: `Mod+Shift+P` command palette, `Mod+K` agent mode, `Mod+D` design mode, `Esc` exits a mode, `Mod+,` opens `settings.json`. Override any binding in `settings.json` (`"keybindings": { "arbora.agentMode": "mod+i" }`, `null` unbinds) or per project in `.arbora/project.json`.

Environment variables: `ARBORA_FLAGS` appends Chromium switches at startup (for example `--disable-gpu-sandbox` on NVIDIA + Hyprland, or `--ozone-platform=x11`); `ARBORA_USER_DATA_DIR` points the app at a different settings directory (used by the e2e tests).

Repository layout: `apps/desktop` (electron-vite app: `src/main`, `src/preload`, `src/renderer`), `packages/shared` (zod IPC channel registry, commands, keybindings, settings schemas), `packages/acp-client`, `packages/browser-bridge`, `packages/mcp-browser-server` (filled in by later stages), `fixtures/` (sample apps for e2e).

## Documentation

- [docs/PLAN.md](docs/PLAN.md): product summary, stack decision, architecture, full feature specification, ADRs.
- [docs/BUILD_STAGES.md](docs/BUILD_STAGES.md): stage-by-stage build instructions, gotchas, acceptance criteria and progress tracking.
