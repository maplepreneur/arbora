# Arbora FAQ

## Why are the shortcuts on Ctrl and not Super?

`Mod` is Ctrl on Linux and Windows and Cmd on macOS. Super is never used by default because the desktop takes it first: Omarchy binds `Super+K` to its keybindings viewer, Hyprland and GNOME grab dozens of Super chords, and Windows owns `Win+K` and `Win+D`. Those keys never reach an app. Ctrl is free in those defaults. Settings → Keyboard warns when you record a Super chord on Linux or Windows.

While a terminal has focus, plain Ctrl chords (`Ctrl+K`, `Ctrl+D`, `Ctrl+1`) go to the shell, because they are line-editing keys there. Turn that off in Settings → Keyboard (**Send Ctrl chords to the focused terminal**).

## An agent or `node` is "not found" when Arbora starts from the Dock or app launcher

GUI apps on macOS, and on Linux desktop launchers, do not inherit your shell's PATH. Arbora runs your login shell once at startup (`$SHELL -ilc 'echo $PATH'`) and gives that PATH to agents, terminals and git. If a tool still does not resolve, make sure your login shell sets it (`~/.zprofile`, `~/.bash_profile`, or `~/.config/fish/config.fish`), not only an interactive one, then restart Arbora. Settings → Agents → **Check** shows whether each agent's command was found.

## Windows SmartScreen says "Windows protected your PC"

The installer is not signed with a code-signing certificate yet. Click **More info**, then **Run anyway**. The warning goes away once releases are signed (see [RELEASING.md](./RELEASING.md)). The installer is per user and needs no admin rights, which is also what lets Arbora update itself.

## macOS says Arbora "cannot be opened because the developer cannot be verified"

That is an unsigned build. Right-click Arbora in Applications, choose **Open**, then **Open** again. Signed and notarized builds open normally.

## Hyprland, Wayland and blurry text

Arbora runs natively on Wayland: it passes `--ozone-platform-hint=auto` itself, so you do not need `ELECTRON_OZONE_PLATFORM_HINT`. Check with `hyprctl clients -j | jq '.[] | select(.class=="arbora") | .xwayland'`, which should print `false`. If text is blurry with fractional scaling, Arbora is running under XWayland; check that nothing forces `--ozone-platform=x11`.

Extra Chromium switches go in `ARBORA_FLAGS`, for example:

- NVIDIA with a blank or black window: `ARBORA_FLAGS="--disable-gpu-sandbox"`
- A Wayland problem you want to rule out: `ARBORA_FLAGS="--ozone-platform=x11"`

The AUR package's `arbora` command also reads `~/.config/arbora-flags.conf`, one switch per line. To bind Arbora to a Hyprland key, use `omarchy-launch-or-focus arbora` or `exec arbora`; the window class is `arbora`.

## "The SUID sandbox helper binary was found, but is not configured correctly"

Chromium's sandbox helper (`chrome-sandbox`) must be owned by root with mode `4755`. The AUR package and the `.deb` set that up. For the tarball run `sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox` in the unpacked folder. Some AppImage setups need `--no-sandbox` because the AppImage is mounted without setuid; prefer the AUR package or the tarball on Arch.

## The AppImage does not start

It needs FUSE 2 (Arch: `sudo pacman -S fuse2`; Debian/Ubuntu: `sudo apt install libfuse2`). The tarball needs no FUSE.

## Notifications do not appear on Linux

Electron needs a notification daemon (mako, dunst, swaync; Omarchy ships mako). Without one Arbora still shows the count on the title-bar bell and plays sounds. Notifications are also skipped while Arbora has focus unless Settings → Notifications & sounds → **Also while Arbora has focus** is on, and the thread you are reading never notifies.

## Does Arbora send anything anywhere?

No telemetry, no crash upload. Crash dumps and `logs/main.log` stay in the user-data folder. **Export Diagnostics…** writes a zip you can attach to a bug report yourself; it removes agent environment values, tokens and your home folder path. Update checks ask GitHub Releases and can be turned off in Settings → Updates & diagnostics.

## Where are settings, threads and screenshots?

- App settings: `settings.json` in the user-data folder (`~/.config/arbora`, `~/Library/Application Support/arbora`, `%APPDATA%\arbora`).
- Per project, committed: `.arbora/project.json` (dev command, default agent, MCP tool permissions, keybinding overrides).
- Per project, machine-local (keep them out of git, for example with `.arbora/*` and `!.arbora/project.json` in `.gitignore`): `.arbora/threads/`, `.arbora/agent-groups.json`, `.arbora/screenshots/`, `.arbora/design-sessions/`.
