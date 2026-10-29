# arbora

Arbora is a cross-platform desktop app (Linux, macOS, Windows) for building web apps by pointing at the running app instead of editing code. An embedded browser shows your dev server; a side panel hosts any ACP-compatible coding agent (Claude Code, Codex, Kimi Code, Grok Build, or your own). Press `Mod+K` to point at a component and describe a change, or `Mod+D` to edit the page visually and hand the agent the diff. A second workspace, Grove, is specified in the plan (Stage 10) for managing several ACP agents at once. It is not built yet.

## Running Arbora locally

### 1. Install the prerequisites

| Tool    | Version | Install                                                                                         |
| ------- | ------- | ----------------------------------------------------------------------------------------------- |
| Git     | any     | your package manager                                                                            |
| Node.js | 22.12+  | [nodejs.org](https://nodejs.org), `fnm`/`nvm`, or `sudo pacman -S nodejs` on Arch               |
| pnpm    | 10.x    | `corepack enable` (ships with Node; picks the version pinned in `package.json`) or `npm i -g pnpm@10` |

Electron is downloaded as a prebuilt binary. The terminal uses `node-pty`, a native module: macOS and Windows use its bundled prebuilt binaries, while Linux compiles it during `pnpm install`, so Linux needs Python 3, `make` and a C++ compiler (Arch: `sudo pacman -S --needed base-devel python`; Debian/Ubuntu: `sudo apt install build-essential python3`). Platform notes:

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

`fixtures/` contains two small apps for trying Arbora (and for the e2e tests):

```bash
pnpm --filter @arbora-fixtures/vite-react dev    # http://localhost:5173
pnpm --filter @arbora-fixtures/plain-html dev    # http://localhost:5500 (PORT=... to change)
```

With the Vite fixture running, open `fixtures/vite-react` in Arbora and type `localhost:5173` in the browser panel's address bar (`Mod+L`), or click **Open http://localhost:5173** on the empty panel (the default comes from `devUrl` in `.arbora/project.json`). The panel remembers the last URL, viewport preset and zoom per project. The fixture's **Log error** and **Request missing API** buttons fill the **Problems** tab with a console error and a 404.

You can also start the dev server from Arbora itself. The **Terminal** tab (`Ctrl+\``) opens your shell in the project folder. Run `pnpm dev` there, and the first local URL it prints (`localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]` or `*.local`) loads in the browser panel if nothing is loaded yet. Otherwise a toast offers to open it. Set `"autoOpenDevUrl": false` in `.arbora/project.json` to always ask. The ▷ button (**Run Dev Server**) does the same in a dedicated `dev` terminal. On first use it infers the command from `package.json` (`dev`, `start` or `serve`) and the lockfile, then saves it as `devCommand`. Restart and stop kill the whole process tree, so the port is freed. Terminals support tabs, splits, search (the magnifier button or **Find in Terminal**), and clickable links.

The browser panel loads React DevTools and Vue DevTools into the page's DevTools (`Mod+Alt+I`). `pnpm dev` and `pnpm e2e` download them from the Chrome Web Store on first run and check them against the SHA-256 pins in `apps/desktop/resources/extensions/extensions.json`; offline, they are skipped with a warning. `pnpm --filter @arbora/desktop extensions:update` re-pins them to the current store versions.

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

### 7. Use your checkout as an installed app (Linux)

```bash
scripts/install-local.sh
```

This adds **Arbora** to your app launcher (Omarchy: `Super+Space`) and an `arbora [project-dir]` command in `~/.local/bin`. Both run this checkout, not a packaged copy. On each launch the app rebuilds if the source in `apps/desktop` or `packages/shared` changed since the last build (about a second), and runs `pnpm install` if `pnpm-lock.yaml` changed. You therefore always get the code currently on disk, including uncommitted and branch work. It also rebuilds after `pnpm e2e`, which leaves a test-mode build in `out/`. A running window keeps its old code until you quit and relaunch. Launch output goes to `~/.local/state/arbora/launcher.log`, and failures show a desktop notification. Re-run the script after moving the checkout; `scripts/install-local.sh --uninstall` removes it.

### Where settings live

User settings are in `settings.json` under Electron's user-data directory:

- Linux: `~/.config/arbora/settings.json`
- macOS: `~/Library/Application Support/arbora/settings.json`
- Windows: `%APPDATA%\arbora\settings.json`

Open the file from the app with `Mod+,`. The app picks up hand edits immediately. Set `ARBORA_USER_DATA_DIR=/tmp/arbora-test` to start with a clean profile without touching your real settings.

Browser panel settings live under `"browser"`: `devToolsExtensions` (default `true`) loads React/Vue DevTools, and `trustLocalhostCertificates` (default `true`) accepts self-signed certificates for HTTPS dev servers on local hosts only (`localhost`, `*.localhost`, `127.x.x.x`, `[::1]`). Each project's page gets its own persistent browser profile (cookies, storage, history) under the user-data directory's `Partitions/` folder. Screenshots are saved to `<project>/.arbora/screenshots/`, which Arbora git-ignores.

Terminal settings live under `"terminal"`: `shell` (default: `$SHELL` on macOS and Linux, else PowerShell 7, Windows PowerShell or `cmd.exe` on Windows) and `fontSize` (default `13`). Terminals and dev servers get the PATH from your login shell, so tools installed by `mise`, `nvm` or `~/.local/bin` resolve even when Arbora is started from a desktop launcher.

### Troubleshooting

- **Blank or black window on Linux with NVIDIA:** `ARBORA_FLAGS="--disable-gpu-sandbox" pnpm dev`. If Wayland misbehaves, try `ARBORA_FLAGS="--ozone-platform=x11"`.
- **AppImage will not start:** your system may lack FUSE 2 (Arch: `sudo pacman -S fuse2`). The tar.gz needs no FUSE.
- **`Mod+K` does nothing:** check that your window manager or desktop does not bind it globally, and check `settings.json` for an override. Arbora never uses Super in its default bindings.
- **Stale build output:** delete `apps/desktop/out` and rerun `pnpm dev`.
- **"Could not load the page" in the browser panel:** `ERR_CONNECTION_REFUSED` means the dev server is not running on that port; start it and press Retry. For certificate errors on an HTTPS dev server, check that `browser.trustLocalhostCertificates` is on and that you are using a localhost address.
- **Prompt icons show as boxes in the terminal:** the terminal asks for `JetBrainsMono Nerd Font` and similar fonts, but fontconfig rules can override that choice. A `<match>` that prepends a font to every `monospace` request (with `binding="strong"`) wins over the Nerd Font, and Chromium then renders tofu. Check with `fc-match "JetBrainsMono Nerd Font"`.
- **`pnpm install` fails building `node-pty` on Linux:** install the compiler toolchain from step 1, then rerun `pnpm install`.
- **React DevTools tab missing:** run `pnpm --filter @arbora/desktop extensions` and check its output; a pin mismatch means the store published a new version (`extensions:update`).

## Development reference

`Mod` is Ctrl on Linux and Windows and Cmd on macOS. Defaults: `Mod+Shift+P` command palette, `Mod+K` agent mode, `Mod+D` design mode, `Esc` exits a mode, `Mod+,` opens `settings.json`. Browser panel: `Mod+L` address bar, `Alt+Left`/`Alt+Right` back/forward, `Mod+R` reload, `Mod+Shift+R` hard reload, `Mod+=`/`Mod+-`/`Mod+0` zoom, `Mod+Alt+I` page DevTools; these work while the page has focus. Terminal: `Ctrl+\`` shows and focuses the terminal, `Ctrl+Shift+\`` opens a new one, and `Ctrl+Shift+5` splits it. Copy is `Ctrl+Shift+C`, or `Ctrl+C` while text is selected, and paste is `Ctrl+Shift+V` or `Ctrl+V` (`Cmd+C`/`Cmd+V` on macOS). Plain `Ctrl` chords such as `Ctrl+K` and `Ctrl+D` go to the shell while the terminal has focus. Viewport presets, screenshots and "Clear Problems" are in the palette. Override any binding in `settings.json` (`"keybindings": { "arbora.agentMode": "mod+i" }`, `null` unbinds) or per project in `.arbora/project.json`.

Environment variables: `ARBORA_FLAGS` appends Chromium switches at startup (for example `--disable-gpu-sandbox` on NVIDIA + Hyprland, or `--ozone-platform=x11`); `ARBORA_USER_DATA_DIR` points the app at a different settings directory (used by the e2e tests).

Repository layout: `apps/desktop` (electron-vite app: `src/main`, `src/preload`, `src/renderer`), `packages/shared` (zod IPC channel registry, commands, keybindings, settings schemas), `packages/acp-client`, `packages/browser-bridge`, `packages/mcp-browser-server` (filled in by later stages), `fixtures/` (sample apps for e2e).

## Documentation

- [docs/PLAN.md](docs/PLAN.md): product summary, stack decision, architecture, full feature specification, ADRs.
- [docs/BUILD_STAGES.md](docs/BUILD_STAGES.md): stage-by-stage build instructions, gotchas, acceptance criteria and progress tracking.
