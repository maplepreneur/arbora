# arbora

Arbora is a cross-platform desktop app (Linux, macOS, Windows) for building web apps by pointing at the running app instead of editing code. An embedded browser shows your dev server; a side panel hosts any ACP-compatible coding agent (Claude Code, Codex, Kimi Code, Grok Build, or your own). Press `Mod+K` to point at a component and describe a change, or `Mod+D` to edit the page visually and hand the agent the diff.

## Running Arbora locally

### 1. Install the prerequisites

| Tool    | Version | Install                                                                                         |
| ------- | ------- | ----------------------------------------------------------------------------------------------- |
| Git     | any     | your package manager                                                                            |
| Node.js | 22.12+  | [nodejs.org](https://nodejs.org), `fnm`/`nvm`, or `sudo pacman -S nodejs` on Arch               |
| pnpm    | 10.x    | `corepack enable` (ships with Node; picks the version pinned in `package.json`) or `npm i -g pnpm@10` |

No compiler toolchain is needed: Arbora has no native Node modules yet, and Electron is downloaded as a prebuilt binary. Platform notes:

- **Linux (including Arch/Omarchy/Hyprland):** Wayland works out of the box. The app passes `--ozone-platform-hint=auto` itself, so you do not need to set `ELECTRON_OZONE_PLATFORM_HINT`. Native dialogs need an xdg-desktop-portal (`xdg-desktop-portal-hyprland` or `-gtk`), which Omarchy already ships.
- **macOS:** no extra setup. Packaged builds are unsigned, so right-click and choose Open the first time.
- **Windows:** use PowerShell or Windows Terminal. Git must check files out with LF endings; the repo's `.gitattributes` handles this.

### 2. Clone and install

```bash
git clone https://github.com/maplepreneur/arbora.git
cd arbora
corepack enable          # once per machine, if you use corepack
pnpm install
```

`pnpm install` installs every workspace package and then downloads the Electron binary (the `postinstall` step in `apps/desktop`). If you see `Electron failed to install correctly`, rerun `pnpm install`, or run `pnpm --filter @arbora/desktop exec install-electron` on its own. Behind a proxy or mirror, set `ELECTRON_MIRROR` first.

### 3. Run the app

```bash
pnpm dev
```

This starts electron-vite with hot reload for the renderer. Changes to the main process or preload need a restart: stop with Ctrl+C and run `pnpm dev` again. The window opens on the Welcome screen, where you can open a folder with **Open project folder…** (or `Mod+O`), drag a folder onto the window, or pick a recent project.

To open a project straight away, pass an **absolute** path after `--`:

```bash
pnpm dev -- "$PWD/fixtures/vite-react"      # macOS / Linux
pnpm dev -- "$PWD\fixtures\vite-react"      # Windows PowerShell
```

Per-project settings (`devCommand`, `devUrl`, `defaultAgent`, keybinding overrides) live in `.arbora/project.json` inside the project folder. Run **Open Project Settings (JSON)** from the command palette (`Mod+Shift+P`) to create and edit it.

### 4. Try the sample projects

`fixtures/` contains two small apps that later stages will drive from inside Arbora. You can already run them on their own:

```bash
pnpm --filter @arbora-fixtures/vite-react dev    # http://localhost:5173
pnpm --filter @arbora-fixtures/plain-html dev    # http://localhost:5500 (PORT=... to change)
```

### 5. Check your changes

```bash
pnpm typecheck        # tsc -b across all packages
pnpm lint             # ESLint + Prettier check (pnpm format to fix formatting)
pnpm test             # Vitest unit tests (pnpm test:watch while developing)
pnpm e2e              # builds once, then runs the Playwright-for-Electron smoke tests
```

CI runs all four on Linux, macOS and Windows. On a headless Linux box, run the e2e tests under a virtual display: `xvfb-run -a pnpm e2e`.

### 6. Build installers (optional)

```bash
pnpm package
```

This writes unsigned installers for the current OS to `apps/desktop/dist/`: AppImage, deb and tar.gz on Linux, dmg and zip on macOS, and an NSIS installer on Windows. Building the deb needs `fakeroot` and `dpkg` (on Arch: `sudo pacman -S fakeroot dpkg`). The tar.gz is the quickest to test: extract it and run `./arbora /path/to/project`.

### Where settings live

User settings are in `settings.json` under Electron's user-data directory:

- Linux: `~/.config/arbora/settings.json`
- macOS: `~/Library/Application Support/arbora/settings.json`
- Windows: `%APPDATA%\arbora\settings.json`

Open the file from the app with `Mod+,`. The app picks up hand edits immediately. Set `ARBORA_USER_DATA_DIR=/tmp/arbora-test` to start with a clean profile without touching your real settings.

### Troubleshooting

- **Blank or black window on Linux with NVIDIA:** `ARBORA_FLAGS="--disable-gpu-sandbox" pnpm dev`. If Wayland misbehaves, try `ARBORA_FLAGS="--ozone-platform=x11"`.
- **AppImage will not start:** your system may lack FUSE 2 (Arch: `sudo pacman -S fuse2`). The tar.gz needs no FUSE.
- **`Mod+K` does nothing:** check that your window manager or desktop does not bind it globally, and check `settings.json` for an override. Arbora never uses Super in its default bindings.
- **Stale build output:** delete `apps/desktop/out` and rerun `pnpm dev`.

## Development reference

`Mod` is Ctrl on Linux and Windows and Cmd on macOS. Defaults: `Mod+Shift+P` command palette, `Mod+K` agent mode, `Mod+D` design mode, `Esc` exits a mode, `Mod+,` opens `settings.json`. Override any binding in `settings.json` (`"keybindings": { "arbora.agentMode": "mod+i" }`, `null` unbinds) or per project in `.arbora/project.json`.

Environment variables: `ARBORA_FLAGS` appends Chromium switches at startup (for example `--disable-gpu-sandbox` on NVIDIA + Hyprland, or `--ozone-platform=x11`); `ARBORA_USER_DATA_DIR` points the app at a different settings directory (used by the e2e tests).

Repository layout: `apps/desktop` (electron-vite app: `src/main`, `src/preload`, `src/renderer`), `packages/shared` (zod IPC channel registry, commands, keybindings, settings schemas), `packages/acp-client`, `packages/browser-bridge`, `packages/mcp-browser-server` (filled in by later stages), `fixtures/` (sample apps for e2e).

## Documentation

- [docs/PLAN.md](docs/PLAN.md): product summary, stack decision, architecture, full feature specification, ADRs.
- [docs/BUILD_STAGES.md](docs/BUILD_STAGES.md): stage-by-stage build instructions, gotchas, acceptance criteria and progress tracking.
