# Arbora: Build Stages and Progress

This document breaks [PLAN.md](./PLAN.md) into stages a coding agent can execute one at a time. Each stage has a goal, scope, step-by-step instructions, gotchas, acceptance criteria and a progress checklist. Feature IDs (`F-...`) refer to PLAN.md section 4.

## How to use this document

- Work one stage at a time, in order. Each stage ends with a usable app.
- Land it through a pull request into `beta` (see [AGENTS.md](../AGENTS.md#shipping)): a draft while it changes, ready once it passes locally. Do not mix stages. A large stage can be several PRs, one sub-part each. Promote `beta` into `main` only when that line is ready to release; that merge publishes the installers.
- Before starting a stage, read its gotchas. Most of them cost hours when discovered the hard way.
- Before pushing code: `pnpm typecheck && pnpm lint && pnpm test`. Keep the `fixtures/` apps green.
- Record new gotchas you discover in the stage's "Gotchas" list so the next agent benefits.
- Pin dependency versions when first adding them. Check the current latest at that time; versions named here are a starting point, not a contract.
- At the end of every piece of work, update the **Progress** table and the stage checklist in this file, and the **Current phase** section in [PLAN.md](./PLAN.md), in the same commit. See [AGENTS.md](../AGENTS.md#end-of-work-update-progress) and `.cursor/rules/update-stage-progress.mdc`. Do not leave this for a follow-up.

## Progress

**Now:** Stages 0–9 are `Done`. Stage 9 (Distribution and polish) is `Done` for now as of 6 Nov 2026 (`v0.0.5`, [PR #77](https://github.com/maplepreneur/arbora/pull/77)). Launch checks stay open until we ship: **Cut a beta**, the packaged memory budget, a macOS `.dmg` open check, fresh installs per OS, and `arch-ok`. Stage 10 (Grove) stays `In progress (PR #76, merged)` and is not `arch-ok`. **Now (Stage 11):** the stretch items landed on `beta` in [PR #88](https://github.com/maplepreneur/arbora/pull/88) (Linux CI [run 42239297446](https://github.com/maplepreneur/arbora/actions/runs/42239297446), green): the dev plugin ([PR #81](https://github.com/maplepreneur/arbora/pull/81)), worktrees ([PR #82](https://github.com/maplepreneur/arbora/pull/82)), Tailwind write-through ([PR #83](https://github.com/maplepreneur/arbora/pull/83)), design session history ([PR #84](https://github.com/maplepreneur/arbora/pull/84)), MCP action traces ([PR #85](https://github.com/maplepreneur/arbora/pull/85)), the opt-in TypeScript language server ([PR #86](https://github.com/maplepreneur/arbora/pull/86)) and source maps ([PR #87](https://github.com/maplepreneur/arbora/pull/87)). Local check of the combination on 6 Nov 2026: `pnpm typecheck`, `pnpm lint`, 812 unit tests, and e2e 56 passed / 1 skipped (the packaged memory budget). Not `arch-ok`. Dependabot [#64](https://github.com/maplepreneur/arbora/pull/64) stays open. **Now (Stage 12):** draft [PR #91](https://github.com/maplepreneur/arbora/pull/91) has the extension store (1Password, React DevTools, Vue DevTools), tabs, grants, the design-match loop, cross-project send, and CLI 1Password (fill from the address bar, save after submit, a one-time code, and `browser_login`). A plain `window.open` becomes a reference tab on `persist:arbora-web`; an OAuth popup (`popup=yes`) is a child window on that partition and closes with its opener. Hovering a tab shows its memory and CPU. Each design-compare round is saved under `.arbora/screenshots/<thread>/` and the Matching design card lists the scores and that path. Problems keeps a buffer per tab and defaults to the app tab. Settings and the onboarding wizard can check for the `op` command without installing it. A focused login field shows a 1Password key when that provider is on. The agent guide teaches the design-match loop, and Always on an agent login remembers that site. Extension mode stays off (Electron 45 has no `connectNative`). A canvas stand-in (`fixtures/design-reference/figma.html`) is opened in a background tab, navigated with `node-id`, read from its inspect text, screenshotted (viewport and full page), and compared on the frame only (`side_by_side`, `overlay`, `diff`); the full tab stays under 0.92 because of the chrome. Filled password and one-time-code fields are painted over in screenshots. An agent-opened tab closes when that session ends, unless it is pinned. The agent-mode project picker lists that project's threads, last used first. Still open: a full 1Password install, the manual Figma matrix, and `arch-ok`. Stages 13–17 stay specified and not started.

| Stage | Name | Status | Notes |
| --- | --- | --- | --- |
| 0 | Foundation | Done (PR #2) | Built in [PR #2](https://github.com/maplepreneur/arbora/pull/2). Omarchy fixes came in [PR #7](https://github.com/maplepreneur/arbora/pull/7), both merged 29 Oct 2026. `arch-ok` on 29 Oct 2026 (Hyprland 0.56.2, Electron 45.1.0): native Wayland with class `arbora` in dev and packaged builds, tiling, floating and workspace moves, the portal file dialog, and the sandboxed packaged tarball. The narrow 687px column works, and title-bar drag was tested by hand. The Windows e2e failures on `main` (settings write race) are fixed. `scripts/install-local.sh` installs an app-launcher entry that, on each launch, fast-forwards a clean checkout to `origin/main` (`scripts/update-to-main.sh`) and rebuilds when the source changed. |
| 1 | Browser panel | Done (PR #4) | Built in [PR #4](https://github.com/maplepreneur/arbora/pull/4). Omarchy fixes came in [PR #7](https://github.com/maplepreneur/arbora/pull/7), both merged 29 Oct 2026. `arch-ok` on 29 Oct 2026: rect sync through tiling, floating and workspace moves; fractional-scale screenshots; chords with the page focused; `shell.openExternal`. A background page load no longer takes keyboard focus, which on Windows needed a guard that outlives the load. The toolbar collapses in narrow columns. |
| 2 | Terminal panel | Done (PR #7) | [PR #7](https://github.com/maplepreneur/arbora/pull/7) merged 29 Oct 2026 (`8ccbe38`), and `main` CI is green ([run 40931674159](https://github.com/maplepreneur/arbora/actions/runs/40931674159)). Covers F-TERM-01..04 and F-BROWSER-03; F-TERM-05 (read-only `agent` tabs with a badge) is wired for Stage 3. 127 unit tests and 17 e2e pass on all three OSes. `arch-ok` on 29 Oct 2026 in `pnpm dev` and the packaged tarball. Open: the macOS e2e clipboard copy is flaky (see the Stage 2 gotchas); fix it opportunistically. |
| 3 | Agent panel (ACP) | Done (PR #10) | [PR #10](https://github.com/maplepreneur/arbora/pull/10) merged 29 Oct 2026 (`ed9a233`) with CI green on all six jobs ([run 40952136622](https://github.com/maplepreneur/arbora/actions/runs/40952136622)). Covers F-AGENT-01..09 and F-TERM-05. Manual matrix (Appendix B): Kimi Code 2.3.1, Grok Build 1.0.70 and OpenCode 2.1.4 `ok`; Claude Code (adapter 0.16.2) and Codex (adapter 2.5.0) are not tested: you don't use them, so they stay built-ins without matrix runs (their auth cards and the pending-prompt flow were checked with the CLIs logged out). `arch-ok` 29 Oct 2026, in the same Omarchy/Hyprland session as Stage 4: the agent panel was docked through the tiling, floating and scaling checks, and the packaged build ran agent threads. Stage 4 replaced the agent panel's native `<select>`s with a themed, searchable `Picker` and fixed one Stage 3 display bug: `resource_link`s whose `file://` URI is percent-encoded (paths with spaces) now show project-relative in the transcript. |
| 4 | Agent mode (`Mod+K`) | Done (PR #11) | [PR #11](https://github.com/maplepreneur/arbora/pull/11) merged 29 Oct 2026 (`65efb82`); `main` CI is green ([run 40983255309](https://github.com/maplepreneur/arbora/actions/runs/40983255309)). PR CI history: [run 40969942207](https://github.com/maplepreneur/arbora/actions/runs/40969942207) was red on Windows `Check` (portability of `source-paths.test.ts`) and on macOS/Windows `E2E smoke` (the popover covered the element in CI's ~400 px-tall browser panel). Placement now tries the element's sides before pinning. [run 40971281943](https://github.com/maplepreneur/arbora/actions/runs/40971281943) is green on all six jobs. Covers F-INSPECT-01..06. **`packages/browser-bridge`:** the overlay (`overlay/inspector.ts`: closed shadow root on `<html>`, box model, label, breadcrumb), refs and selectors (`descriptor.ts`), `detect.ts`, React/Vue chains (`components.ts`) injected into the page's main world (`main-world.ts`), and the composer (`prompt.ts`). `@arbora/browser-bridge` exports only the DOM-free composer for main; the preload imports `@arbora/browser-bridge/page`. **Main:** `agent-mode/` has `AgentModeService` (clean capture, outline burn-in, ≤1568 px, `image` or file link), `source-paths.ts` and `source-search.ts` (ripgrep or a Node walk). **Renderer:** `mode.ts` state machine and `panels/agent-mode/AgentModeLayer.tsx` (frozen frame, outline, popover). `fixtures/vite-react` is now React 18; `fixtures/next` (React 19) and `fixtures/nuxt` are new. 305 unit tests (91 new) and 25 e2e (6 new) pass locally; the agent-mode spec also passes at `--force-device-scale-factor=1.5` with a pixel check of the outline in the image the agent gets. The packaged tarball build runs agent mode end to end, driven over CDP: sandboxed, `class: arbora`, `xwayland: false`. Manual matrix 29 Oct 2026 (Appendix B): OpenCode 2.1.4 on the free `opencode/deepseek-v4.1-flash-free`, Kimi Code 2.3.1 and Grok Build 1.0.70 `ok`; Claude Code and Codex `blocked` (not logged in). Latest CI: [run 40982462758](https://github.com/maplepreneur/arbora/actions/runs/40982462758) green on all six jobs. `arch-ok` 29 Oct 2026: the user's hand checks on Omarchy/Hyprland (window tiling, floating and scaling with agent mode) passed. Stage 5 added a `NameForm` to `fixtures/vite-react`, so the spec now expects the Counter card at `src/App.tsx:14`. On 4 Nov 2026 Dependabot's [PR #19](https://github.com/maplepreneur/arbora/pull/19) went into `beta` with its CI run cancelled. It moved this fixture's `react-dom` to 19 while `react` stayed on 18, so the page never hydrated and the 10 e2e tests that load it timed out (agent mode on Vite, browser, design and MCP). [PR #62](https://github.com/maplepreneur/arbora/pull/62) (merged 4 Nov 2026, CI green in [run 41818131114](https://github.com/maplepreneur/arbora/actions/runs/41818131114)) pins it back to 18.3.1 and keeps Dependabot out of `fixtures/vite-react`; with it, those 20 tests in the four specs pass locally. |
| 5 | Browser control MCP server | Done (PR #12) | [PR #12](https://github.com/maplepreneur/arbora/pull/12) merged 29 Oct 2026 (`cc53d07`); `main` CI is green on all six jobs ([run 40990500463](https://github.com/maplepreneur/arbora/actions/runs/40990500463)). PR CI: green on all six jobs from the first run ([run 40987130430](https://github.com/maplepreneur/arbora/actions/runs/40987130430)); the last code commit is green too ([run 40988237983](https://github.com/maplepreneur/arbora/actions/runs/40988237983)). Covers F-MCP-01..05. **`packages/mcp-browser-server`** (Electron-free): `BrowserMcpServer` is stateless Streamable HTTP on `127.0.0.1:0` with a per-session bearer token. `tools.ts` holds the 23 tools (navigation, observation, CDP interaction, dev server, `terminal_run`), each with an optional `target`, and `ToolContext` holds the permission checks, snapshot refs and in-flight request counter. `snapshot.ts` formats the AX tree like Playwright MCP, and `refs.ts`/`input.ts`/`page.ts` are CDP-only. The stdio shim (`shim.ts`) is built to `out/main/mcp-shim.js` and runs on Arbora's executable with `ELECTRON_RUN_AS_NODE=1`; `ARBORA_MCP_TRANSPORT=stdio` forces it. **Main:** `mcp/browser-tool-host.ts` implements the host over `BrowserService` (new `cdp()`, `waitForLoad()`, `setViewportOverride()`), `DevServer` and `TerminalService`. `AgentService` attaches one server per agent process, passes it to `session/new`/`load`/`resume`, raises its own permission cards (off-origin navigation once per origin; `browser_evaluate`/`terminal_run` once per session, or `browserTools` in `.arbora/project.json` for "Always"/"Never"), mirrors screenshots as `browser_preview` thumbnails, and warns when an agent never lists the tools. The preface gains the verify loop, and `.arbora/SKILL.md` is written. **Tests:** 334 unit tests (29 new) and 29 e2e (4 new in `e2e/mcp.spec.ts`: a click over HTTP and over the shim, a sweep of every tool against the real page, and `devserver_restart` following a port change, plus `devserver_logs` and an "Always allow" for `terminal_run` that is saved to `.arbora/project.json` and holds for the next session). The fake agent is an MCP client. Manual matrix on 29 Oct 2026 (Appendix B), with free OpenCode models only: OpenCode 2.1.4 on `opencode/deepseek-v4.1-flash-free` `ok` over HTTP and over the shim, and for the unaided verify loop. Kimi Code and Grok Build were not run. The packaged `--dir` shim works from inside `app.asar`. `arch-ok` 29 Oct 2026: your hands-on checks on Omarchy/Hyprland passed. Hand-off to Stage 6: `browser_screenshot` and `browser_get_element_source` are what the design-mode verify step needs, and `AgentService.requestToolPermission`/`addBrowserPreview` let Arbora add its own cards to a thread. |
| 6 | Design mode (`Mod+D`) | Done (PR #13) | [PR #13](https://github.com/maplepreneur/arbora/pull/13) merged 30 Oct 2026 (`c502fae`). `arch-ok` 30 Oct 2026: you signed Stage 6 off as done on Omarchy/Hyprland. `main` CI is green with Stage 6 and the macOS label fix ([run 41083870967](https://github.com/maplepreneur/arbora/actions/runs/41083870967), Linux). PR CI [run 41061605095](https://github.com/maplepreneur/arbora/actions/runs/41061605095): red on `E2E smoke (macos-latest)` only (the thread-keys test expected `Shift+Tab`/`Alt+P` labels; macOS shows ⇧Tab/⌥P), fixed in [PR #14](https://github.com/maplepreneur/arbora/pull/14) (merged 30 Oct 2026, `3a6750b`), which also makes CI Linux-only unless a PR has the `ci:all-os` label; the other five jobs were green. Complete for now (30 Oct 2026): Appendix B's design-save row stays empty until a real agent run; the stage stays Done. Covers F-DESIGN-01..09. **Design mode:** `packages/browser-bridge/src/overlay/design.ts` (closed shadow root, Arbora-green hover and selection, spacing handles, Shift multi-select, double-click text editing, drag to move with drop indicators) on `overlay/ops.ts` (`OpLog`: style/text/attr/move/insert/delete, undo/redo, switch-off and delete of single changes, and a rebuild that reverts to the original then re-applies). The renderer's `panels/design/DesignPanel.tsx` replaces the agent panel while design mode is on: a breadcrumb, a Style tab (segmented layout controls, a box-model spacing widget, drag-to-scrub values, colour swatches, structure inserts), a Changes tab (click a change to edit its element, hover to highlight it, eye to switch it off, trash to delete), Compare, and a send bar ("Send N changes to <agent>" with agent and model pickers). Main's `design/design-mode-service.ts` takes the before/after screenshots, mirrors a crash draft to `.arbora/design-sessions/draft.json`, detects the styling approach (`design/styling.ts`; Tailwind mapper in `packages/shared/src/design.ts`), reverts the live DOM before the agent starts, and returns the thread at once so the right panel shows the agent working. Sessions can be resent. **Agents:** a Settings page (`Mod+,`, in place of the browser pane) with a sign-in check (`agent.verify`, `main/agent/agent-probe.ts`), a current default (agent plus model), and agent and model visibility. Pickers (design send bar, new-thread picker) offer only signed-in, visible agents; models sort default, favourites, rest. **Threads:** "New thread" starts the default agent on its default model; the dropdown and `Mod+Shift+N` open a keyboard picker (Enter starts, → picks a model); Shift+Tab, Alt+T, Alt+P and Alt+M rotate modes and thinking and open the model and mode menus while the agent panel has focus. **Tests:** 359 unit tests and e2e for design mode, Settings, the picker and the thread keys pass locally (`agent-mode.spec` "new thread when none is open" failed once with the page closing and passed three reruns). Open: agent mode's target picker is not filtered by sign-in yet. |
| 7 | Files and editor | Done (PR #15) | [PR #15](https://github.com/maplepreneur/arbora/pull/15) merged to `main` 30 Oct 2026 (`75590e4`). `arch-ok` 1 Nov 2026 on Hyprland 0.56.2: `pnpm dev` and the packaged `dist/linux-unpacked/arbora` from `pnpm package` (tarball `dist/arbora-0.0.1-linux-x64.tar.gz`) are `class: arbora`, `xwayland: false`, tiled. A throwaway window floated (1261×1390 to 1280×1404) and returned to tiled. DP-5 scale 1 to 1.25 resized the open window to 2024×1102 and still `xwayland: false`; scale restored to 1 and every monitor matched the prior layout. `Ctrl+P` and `Ctrl+Shift+P` opened quick open and the palette. The Open Project dialog was `xdg-desktop-portal-gtk` and Escape closed it. The packaged window moved from workspace 4 to workspace 3. PR CI with `ci:all-os` was green ([run 41094772508](https://github.com/maplepreneur/arbora/actions/runs/41094772508)). Covers F-FILES-01..03, F-EDITOR-01..03 and the F-GIT-04 viewer. |
| 8 | Git and GitHub | Done (`786031d`) | Git panel, `GitService`, explorer letters, editor gutter, agent changes, and `gh` pull requests. `arch-ok` 1 Nov 2026, same Hyprland session as Stage 7 (native Wayland, float, scale, chords, portal dialog, packaged binary, workspace move). Unit tests and `e2e/git.spec.ts` pass. Manual GitHub run: the panel committed and pushed `edit` on private `maplepreneur/arbora-stage8-scratch` and opened [PR #1](https://github.com/maplepreneur/arbora-stage8-scratch/pull/1). `git.checks` was empty because that repo has no workflow. The `gh` token cannot delete the repo, so it is still on the account. Device flow is not shipped; there is no OAuth client id. |
| 9 | Distribution and polish | Done (v0.0.5) | `Done` for now (6 Nov 2026). `v0.0.5` is published ([PR #77](https://github.com/maplepreneur/arbora/pull/77), [Release run 42046095073](https://github.com/maplepreneur/arbora/actions/runs/42046095073)). Onboarding, Settings, update channels, unsigned GitHub Releases, diagnostics, the feedback round ([PR #54](https://github.com/maplepreneur/arbora/pull/54)–[PR #60](https://github.com/maplepreneur/arbora/pull/60); #49 stays open), the Projects page, agent groups, and attention. Revisit at launch: **Cut a beta**, the packaged memory budget, a macOS `.dmg` open check, fresh installs per OS, and `arch-ok`. Those checklist rows stay open. |
| 10 | Grove | In progress (PR #76, merged) | Not `arch-ok`. Unified shell is on `beta`: [PR #72](https://github.com/maplepreneur/arbora/pull/72), [PR #73](https://github.com/maplepreneur/arbora/pull/73), [PR #74](https://github.com/maplepreneur/arbora/pull/74) and [PR #76](https://github.com/maplepreneur/arbora/pull/76) (Linux CI [run 42044716087](https://github.com/maplepreneur/arbora/actions/runs/42044716087)). One window: project tree, chat, content pane and side column. Session list, launcher, orchestration and several projects are merged ([PR #61](https://github.com/maplepreneur/arbora/pull/61), [PR #70](https://github.com/maplepreneur/arbora/pull/70)). Left: `arch-ok` on Omarchy/Hyprland and the Appendix B Grove row with a real agent. |
| 11 | Stretch | In progress (PR #88, merged) | Not `arch-ok`. Landed on `beta` in [PR #88](https://github.com/maplepreneur/arbora/pull/88) (Linux CI [run 42239297446](https://github.com/maplepreneur/arbora/actions/runs/42239297446), green). Dev plugin [PR #81](https://github.com/maplepreneur/arbora/pull/81). Worktrees, own port, merge or pull request, best-of-N [PR #82](https://github.com/maplepreneur/arbora/pull/82). Tailwind write-through [PR #83](https://github.com/maplepreneur/arbora/pull/83). Design session compare and Markdown export [PR #84](https://github.com/maplepreneur/arbora/pull/84). MCP action traces [PR #85](https://github.com/maplepreneur/arbora/pull/85). Opt-in TypeScript language server [PR #86](https://github.com/maplepreneur/arbora/pull/86). Source maps for production bundles [PR #87](https://github.com/maplepreneur/arbora/pull/87). #82–#87 closed when #88 merged. Local check on 6 Nov 2026: `pnpm typecheck`, `pnpm lint`, 812 unit tests, and e2e 56 passed / 1 skipped (the packaged memory budget). |
| 12 | Tabs, cross-tab agent work and passwords | In progress (PR #91) | Draft [PR #91](https://github.com/maplepreneur/arbora/pull/91). In: tabs, the store (1Password 8.12.44.33, React DevTools, Vue DevTools), send-tab grants, hidden-tab compare, the design-match loop, cross-project "Open project and send" (that project's own threads, last used first; Open thread focuses that window and Stay here does not), CLI fill (address-bar key, `Mod+Shift+L` while the page is focused), save, OTP, `browser_login`, and `pnpm setup:1password` (`--check`, `--yes`, `--uninstall` covered by unit tests; no install was run). Settings and onboarding can open that script in a terminal and do not call sudo. Hovering a tab shows that renderer process's memory and CPU (`F-TABS-07`); Discard is in the tab menu and the command palette. Each tab shows its page title and a role icon (the app tab no longer replaces the title with the word App). The tab menu sends the clicked tab; the strip button still sends the active one. Browser tool results start with `Tab: <id> (role)`. Grant chips show the tab favicon. The Windows setup script fetches the pinned extension. Use project session is covered by an e2e that moves a cookie onto that tab and back. Debian and Fedora setup prints 1Password's repository commands and does not run them. Each `browser_compare` round is written to `.arbora/screenshots/<thread>/round-N.png` and linked from the Matching design card, which also lists the score history, the round, and the latest side-by-side (`F-XTAB-07`). Problems lists one tab at a time and defaults to the app tab, so a reference tab's console does not replace the app's (`F-TABS-03`). e2e on 6 Nov 2026: chords, restore (only the active tab loads), grant and revoke, compare scores below then at or above 0.92 with both round files on disk, cross-project send, a shared-partition tab versus an OAuth child window, a login that fills a one-time code, a save whose password reaches `op` on stdin and not the window, and the memory hover card. Extension mode stays off (no `connectNative`). A canvas stand-in (`fixtures/design-reference/figma.html`) is opened in a background tab, navigated with `node-id`, read from its inspect text, screenshotted (viewport and full page), and compared on the frame only (`side_by_side`, `overlay`, `diff`); the full tab stays under 0.92 because of the chrome. Filled password and one-time-code fields are painted over in screenshots. An agent-opened tab closes when that session ends, unless it is pinned. The agent-mode project picker lists that project's threads, last used first. Still open: a full 1Password install, the manual Figma matrix, and `arch-ok`. Local: `pnpm typecheck`, 838 unit tests, and `e2e/tabs.spec.ts` (13 passed, including the canvas-frame compare, the app-tab Problems filter, and the login-field key). The login e2e now chooses Always: the origin is remembered and Remove in Settings clears it. The agent skill teaches the design loop (frame screenshot, `node-id`, Dev Mode text, compare, stop at 0.92 or 5 rounds) and stays under 400 words. The onboarding wizard's password step checks for `op`. Settings → Project sets the design-match stop score and round cap, and `browser_compare` returns them. `pnpm setup:1password --check` prints a pass/fail table and does not install. CI skipped while the PR is a draft. |
| 13 | Themes | Not started | Specified 30 Oct 2026 (PLAN § 4.16). Colour packs in `theme.json` on top of the existing light/dark/system switch. Not the next stage. It only needs the CSS variables in `styles.css` and the Settings page, so it can be pulled forward. |
| 14 | Extensions | Not started | Specified 30 Oct 2026 (PLAN § 4.17, ADR 0007). The store itself lands in Stage 12 with 1Password, React DevTools and Vue DevTools. Still to add: Svelte DevTools, Bitwarden and coding tools such as Robocop. Not the next stage. Coding tools need Stage 7's Problems panel. |
| 15 | Accounts and membership | Not started | Specified 1 Nov 2026 (PLAN § 4.18, ADR 0008, [MONETIZATION.md](./MONETIZATION.md)). Required sign-in through the system browser, Arbora Pro at $5/month or $50/year with a 14-day trial (Stripe Billing), signed entitlements verified offline, and the Free/Pro gates per stage. Three sub-parts: 15a sign-in, 15b billing and entitlements, 15c gates. Needs the account server next to the website, and Stage 9's Settings and onboarding. |
| 16 | Usage, cost and time | Not started | Specified 5 Nov 2026 in [PR #80](https://github.com/maplepreneur/arbora/pull/80) (PLAN § 4.19, ADR 0009). Not the next stage. 16a writes input, output and cache tokens, the model, list-price cost and working time to `.arbora/usage/` and the app reads that. 16b copies the same rows into the account database (`usage_turns`) when the user turns on **Save usage to my account**; the website reads the database. Depends on Stages 3, 8 and 10. 16b also needs Stage 15. |
| 17 | Publish | Not started | Specified 5 Nov 2026 in [PR #80](https://github.com/maplepreneur/arbora/pull/80) (PLAN § 4.20, ADR 0010). Not the next stage. Vercel and Cloudflare Pages for a developer, and a `site` audience so a non-developer can preview and publish a website. Depends on Stages 1, 6, 8 and 9. The host token uses the Stage 15 keychain pattern when that stage has landed, and the same `safeStorage` call before that. |

Status values: `Not started`, `In progress` or `In progress (PR #N)` / `In progress (PR #N, merged)`, `Blocked (reason)`, `Done` or `Done (PR #N)`. Work from the direct-to-main period (30 Oct to 1 Nov 2026) names its commit on `main`; new work names its PR. Never mark `Done` from CI alone; `arch-ok` on Omarchy/Hyprland is required.

## Code conventions for the builder agent

- TypeScript `strict` everywhere; no `any` without a comment explaining why.
- All IPC goes through zod-validated channels in `packages/shared`. The renderer never imports from `electron`.
- Imports at the top of the file; no inline `import()` except documented lazy boundaries in `src/main/lazy/` and `React.lazy` panel entries.
- Exhaustive `switch` over unions and enums with a `never` default.
- Services in main are plain classes with explicit `dispose()`; no module-level singletons holding process handles.
- Child processes (agents, terminals, git, tooling) always receive the cached login-shell PATH and the project cwd.
- Every new tool, command or setting gets a unit test or an e2e step in the stage it lands in.
- One PR per logical change into `beta`, opened as a draft until it is ready (see [AGENTS.md](../AGENTS.md#shipping)). A large stage can be several PRs, one sub-part each. `main` receives a promotion PR from `beta` when the result is ready to release.

## Cross-cutting gotchas (read before any stage)

- **Actions minutes are billed.** Since 2 Nov 2026 feature pull requests go into `beta`, and a pull request from `beta` into `main` publishes a release. CI stays small: Linux only, drafts and docs-only changes skip, a new push cancels the PR's running job, merges do not rerun CI (a weekly Monday run and manual dispatch cover `main`), and `ci:all-os` only for platform-specific changes right before merge. Push when the work is tested locally, not per commit. Each release costs about 60 minutes.
- **Dependabot's starter file fails twice.** An empty `package-ecosystem` is not a valid config (the `.github/dependabot.yml` check stays red after lint is green), and Prettier's `singleQuote` rejects the template's double quotes, so `pnpm lint` fails on that file alone. This repo's weekly config is `npm` at `/` (pnpm lockfile) and `github-actions` at `/`. Run `pnpm exec prettier --write .github/dependabot.yml` before pushing.
- **Merge a Dependabot PR only after a green run.** [PR #19](https://github.com/maplepreneur/arbora/pull/19) went into `beta` with its run cancelled and broke `fixtures/vite-react` for every later PR (Stage 4 gotchas). Re-run a cancelled or skipped run before merging, and keep fixtures that pin an old major out of Dependabot with `exclude-paths`.
- **A Dependabot label cancels the pull request's CI run.** The open event starts Linux CI, then Dependabot adds `dependencies` and `javascript`. That `labeled` event shares the concurrency group, so it cancels the open run, and the job skips every label except `ci:all-os`. The checks then show cancelled and skipped, which is not a green run. On 5 Nov 2026, [#63](https://github.com/maplepreneur/arbora/pull/63), [#65](https://github.com/maplepreneur/arbora/pull/65), [#66](https://github.com/maplepreneur/arbora/pull/66) and [#67](https://github.com/maplepreneur/arbora/pull/67) were merged after typecheck, lint, 731 unit tests and 52 e2e passed locally on the combined lockfile. Their four diffs do not overlap, so the squashes applied in that order without a lockfile conflict.
- **Keep `@types/node` on a major the runtime actually has.** CI uses Node 22 and `engines` is `>=22.12.0`. Electron 45's main process is Node 24. [@types/node 26](https://github.com/maplepreneur/arbora/pull/64) (still open) types APIs neither runtime has. Do not merge that jump.
- **`paths-ignore` does not skip docs-only pushes to a PR that has code.** For `pull_request` events GitHub compares the whole PR diff with the base, so a docs commit on a code PR runs the full CI again, on every OS if `ci:all-os` is still set. Remove the label once the all-OS run is green. This matters again when PRs resume.
- **Do not push and mark a PR ready in the same breath.** The draft push's run is skipped, but it is in the same concurrency group, so it cancels the `ready_for_review` run, and no CI runs. Re-run the cancelled run, or mark the PR ready first and push afterwards.
- **CI minutes are billed (private repo): macOS at 10x and Windows at 2x Linux.** `ci.yml` runs one Linux job (typecheck, lint, unit, e2e) on PRs and on pushes to `main`, skips drafts and docs-only changes, and caches the Electron download. Add the `ci:all-os` label to a PR, or use "Run workflow" with "all_os", to also run macOS and Windows; do that before merging anything platform-specific (paths, shells, keyboard labels, packaging). A full three-OS run was about 60 billed minutes, the Linux job about 4.
- **`Mod` is Ctrl on Linux and Windows, Cmd on macOS. Never Super.** Omarchy binds `Super+K` (keybindings viewer), `Super+P`, `Super+Shift+D` and dozens of other Super chords at the Hyprland level; Windows owns `Win+K`/`Win+D`; GNOME grabs many Super chords. Those are consumed before the app sees a keydown, and `globalShortcut` does not work on Wayland at all. Ctrl is free in Omarchy's defaults. Make every binding configurable from day one.
- **Mode chords must beat the embedded page and respect the terminal.** Many web apps bind `Ctrl+K` to their own command palette (cmdk and friends). When the `WebContentsView` has focus the renderer gets no keydown, so intercept `Mod+K`/`Mod+D`/`Esc` in main with `webContents.on('before-input-event')` and `event.preventDefault()` for both the browser view and the app window. The Grove chords (Stage 10: `Mod+Alt+G` everywhere; `Mod+1`–`Mod+9`, `Mod+Alt+N`, `Mod+Alt+Up/Down` and `Mod+Alt+W` inside Grove) are intercepted the same way. When an xterm terminal is focused, plain `Ctrl` chords go to the shell by default (`isTerminalPassthroughChord`); a setting flips that. `Ctrl+K` and `Ctrl+D` are the ones people notice. `Ctrl+digit` is not in that set since PR #58 (panel focus).
- **macOS GUI apps do not inherit your shell PATH.** `kimi`, `grok`, `node`, `pnpm`, `git` may not resolve when Arbora is launched from Finder/Dock. On startup, spawn the user's login shell (`$SHELL -ilc 'echo -n "$PATH"'`) once, cache the result, and use it for every child process (agents, terminals, git). Linux desktop launchers have the same problem with user-local bins (`~/.local/bin`, nvm, volta).
- **Windows path and shell differences.** Spawn `npx` as `npx.cmd` (or use `shell: true` with careful quoting). Use `PowerShell` or `pwsh` as the default terminal. Normalise paths with `path.posix` before sending to agents and MCP tools; ACP agents expect absolute paths, and Codex/Claude Code handle `C:\...` but prompts read better with forward slashes.
- **Native modules must be rebuilt for Electron.** `node-pty` (and anything else with a `.node` binary) must be compiled against Electron's Node ABI. Use `electron-builder install-app-deps` (or `@electron/rebuild`) in `postinstall`, and never import native modules from the renderer.
- **Electron security defaults are not enough.** Set `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true` on every `BrowserWindow` and `WebContentsView`. Call `setWindowOpenHandler` and deny by default. The user's dev server is untrusted content.
- **Use `WebContentsView`, not `<webview>`.** `<webview>` is deprecated-in-spirit, slow, and has broken focus and sizing behaviour. `WebContentsView` is a native view you position from main; the renderer sends layout rects over IPC.
- **CDP and DevTools fight over the debugger.** `webContents.debugger.attach()` detaches when the user opens DevTools on the same `webContents`, and vice versa. Listen for `detach` and re-attach when DevTools closes; disable inspector/design overlays while DevTools is open, or show a warning.
- **Agent CLIs change weekly.** Pin adapter versions in the registry (`npx -y pkg@x.y.z`) and expose an "update adapters" action. Always read `agentCapabilities` and `promptCapabilities` from `initialize` instead of hard-coding what an agent can do.
- **Keep secrets out of logs.** The ACP log viewer must redact `env` values and auth tokens. The MCP bearer token must never appear in prompts.

## Local testing on Arch Linux (Omarchy + Hyprland)

The primary development machine is Arch Linux running Omarchy with Hyprland on Wayland. Every stage is verified there with `pnpm dev` and, from Stage 0 onward, with the packaged tarball. Do not mark a stage done on CI results alone.

### One-time setup

```bash
# Omarchy ships most of this; install what is missing
sudo pacman -S --needed base-devel git nodejs npm python make gcc \
  libarchive rpm-tools fakeroot xdg-desktop-portal-hyprland xdg-desktop-portal-gtk
corepack enable && corepack prepare pnpm@latest --activate

# Native Wayland for Electron. Omarchy already exports this in its Hyprland env config;
# confirm it, otherwise Electron runs under XWayland and text is blurry with fractional scaling.
echo "$ELECTRON_OZONE_PLATFORM_HINT"    # expect: auto
```

Hyprland uses Super for everything, so Arbora's Ctrl-based chords do not collide. Do not add Hyprland rebinds for Arbora.

### Per-stage verification (run before ticking a stage done)

1. `pnpm dev` starts under Hyprland and `hyprctl clients -j | jq '.[] | select(.class|test("arbora|electron";"i")) | {class, xwayland, size}'` shows `"xwayland": false`.
2. Tiling: move the window between tiled/floating (`Super+T` on current Omarchy), resize with `Super+-`/`Super+=`, send it across workspaces, and confirm the `WebContentsView` tracks the panel rect with no stale offsets or black bands.
3. Fractional scaling: change scaling with `Super+/` (Omarchy monitor scaling up/down) while running; confirm overlays, popovers and screenshot `dpr` stay correct.
4. Keyboard: `Ctrl+K`, `Ctrl+D`, `Ctrl+Shift+P`, `Ctrl+P`, `Esc` work with focus in the app chrome, in the embedded page, and (where appropriate) are passed through in the terminal.
5. Native dialogs (open project, save) appear via the xdg portal and return paths; `shell.openExternal` opens Omarchy's default browser; clipboard copy/paste works in the terminal and editor.
6. Packaged build: `pnpm package` then run the Linux tarball or AppImage from `dist/`; the same checks pass without `--no-sandbox`. If the AppImage needs `--no-sandbox`, record it in Stage 9 and fix the chrome-sandbox permissions or prefer the tarball/AUR path.
7. Record the result in the Progress table notes as `arch-ok`, `arch-partial (note)` or `arch-fail (note)`.

### Hyprland and Wayland gotchas

- **XWayland fallback is silent.** If `ELECTRON_OZONE_PLATFORM_HINT` is unset, Electron picks X11 and everything still works but blurry on fractional scaling, and Wayland-only behaviours differ. Also call `app.commandLine.appendSwitch('ozone-platform-hint', 'auto')` in main so packaged builds do not depend on the env var, and enable `WaylandWindowDecorations` in `enable-features`.
- **No server-side decorations.** Hyprland does not draw titlebars, so Arbora uses a frameless window with its own title bar on Linux (as on Windows). Window dragging works via `-webkit-app-region: drag`; test that the drag region does not cover the URL bar or tabs.
- **Tiling WMs ignore saved window bounds.** `BrowserWindow.setBounds` on restore is pointless under Hyprland and can fight the compositor; only restore bounds when the window is floating (or skip on Linux). Expect many rapid `resize` events; the view-rect sync must be rAF-throttled and never loop.
- **Omarchy's default scrolling column is narrow.** `column_width` 0.49 on the 2880×1920 laptop at scale 2 is about 687px; a half-width dwindle tile there is about 701px. The main row's minimums must fit inside that width: the 44px activity rail plus sidebar 160, center 240 and agent 200 make 644px. The window's `minWidth` is 640, because a larger minimum makes Hyprland overflow the column. With the old minimums (center 320, agent 240, 764px in total) the collapsible sidebar dropped to width 0. Panel chrome has to survive a ~280px center column, so the browser toolbar uses container queries to drop the screenshot, external, DevTools and viewport controls (all still in the palette).
- **Hyprland re-tiles a new window when the previous e2e window closes.** The first frames of a launch can have the old size. `e2e/app.ts` waits until `innerWidth`×`innerHeight` holds steady for 400ms before a test starts, because assertions that compare panel pixels across launches flaked without it.
- **Window class.** With `--class=arbora`, both dev and packaged builds report `class: arbora`, `xwayland: false` in `hyprctl clients` (Hyprland 0.56.2, Electron 45.1.0). Older notes saw `electron` in dev; probes still match both. `omarchy-launch-or-focus arbora` waits on the packaged `.desktop` (`desktopName: arbora.desktop`).
- **Hyprland 0.56 uses a Lua config.** `hyprctl dispatch` takes Lua, for example `hyprctl dispatch 'hl.dsp.window.float({ action = "toggle", window = "class:arbora" })'` or `hl.dsp.send_shortcut({ mods = "CTRL", key = "grave", window = "class:arbora" })`. The stubs in `/usr/share/hypr/stubs/hl.meta.lua` list every dispatcher. `send_shortcut` goes through the real keymap, so Chromium sees the correct `KeyboardEvent.code`; `wtype` builds its own keymap, so chords it sends can have the wrong `code`. On this machine `send_shortcut` answers "key not found" for some letters (`k`, `a`).
- **`Super+/` rewrites `~/.config/hypr/monitors.lua`.** `omarchy-hyprland-monitor-scaling` edits the catch-all `omarchy_monitor_scale`, so it changes nothing live on monitors with their own `hl.monitor` rule, and it persists across sessions. To test fractional scaling, use a live-only rule, for example `hyprctl eval 'hl.monitor({ output = "DP-5", mode = "2560x1440@144", position = "1440x1120", scale = 1.25 })'`, then `hyprctl reload`. Never run the script from an agent.
- **Omarchy's universal clipboard sends `Ctrl+C`/`Ctrl+V` to Arbora.** `Super+C`/`Super+V` send `Ctrl+Insert`/`Shift+Insert` only to windows tagged `terminal`. Arbora isn't tagged, so its xterm copies on `Ctrl+C` while text is selected and pastes on `Ctrl+V`, as VS Code and Windows Terminal do.
- **`globalShortcut` is a no-op on Wayland.** Do not use it for anything, including probes.
- **Portals.** File dialogs go through `xdg-desktop-portal` (`-hyprland` for screen things, `-gtk` for file chooser). If dialogs never appear, check `systemctl --user status xdg-desktop-portal*`.
- **NVIDIA.** Electron on Hyprland with proprietary NVIDIA drivers may need `--disable-gpu-sandbox` or fall back to software rendering; expose `ARBORA_FLAGS` (space-separated Chromium switches appended at startup) and document it.
- **Screen capture is not needed for screenshots.** `webContents.capturePage` renders from Chromium's own compositor and works regardless of Wayland screen-capture permissions. Only the Stage 9 "export diagnostics" video/recording features (if ever added) would need the portal.
- **Omarchy updates Hyprland frequently.** If something breaks after `omarchy-update`, check Hyprland's and Electron's release notes before debugging Arbora; keep Electron on the latest stable.

---

## Stage 0: Foundation

**Goal.** A runnable Electron app that opens a project folder and shows an empty, resizable panel layout, with the tooling and CI that every later stage relies on.

**Features.** `F-SHELL-01` to `F-SHELL-06`, `F-NFR-01`, `F-NFR-03` (partial).

**In scope.** pnpm monorepo, electron-vite app, TypeScript strict, ESLint + Prettier, zod IPC layer, settings store, project open/recent, panel layout skeleton with persisted sizes, command palette, keybinding service (Ctrl/Cmd chords with main-process interception), Wayland-native startup flags, GitHub Actions matrix (typecheck, lint, unit), electron-builder producing unsigned artifacts.

**Out of scope.** Any real panel content, signing, updater.

### Instructions

1. Initialise the pnpm workspace: `apps/desktop`, `packages/shared`, `packages/acp-client`, `packages/browser-bridge`, `packages/mcp-browser-server`, `fixtures/*`. Add `pnpm-workspace.yaml`, root `package.json` scripts (`dev`, `build`, `typecheck`, `lint`, `test`, `e2e`, `package`), `.npmrc` with `node-linker=hoisted` (electron-builder and native modules misbehave with the default isolated layout).
2. Scaffold `apps/desktop` with `electron-vite` (React + TypeScript template). Three entry points: `main`, `preload`, `renderer`. Add a fourth build entry `browser-preload` now (empty) so the Vite config is right before Stage 1.
3. TypeScript: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, project references per package. ESLint flat config with `typescript-eslint` strict, `react-hooks`, `import/no-cycle`, and a rule banning inline imports (`no-restricted-syntax` on `ImportExpression` outside `src/main/lazy/`).
4. IPC layer in `packages/shared`: define each channel as `{ name, request: z.ZodType, response: z.ZodType }` and each event as `{ name, payload: z.ZodType }`. Write `defineHandler` (main) and `createClient` (preload) helpers that validate both directions. Expose the client through `contextBridge.exposeInMainWorld('arbora', ...)`. The renderer must never call `ipcRenderer` directly.
5. Settings store in main (`electron-store` or a hand-rolled JSON file under `app.getPath('userData')`), with a zod schema and migrations table. Per-project settings live in `<project>/.arbora/project.json`.
6. Window management: one `BrowserWindow` per project, `titleBarStyle: 'hiddenInset'` on macOS, frameless with a custom title bar on Linux/Windows (Hyprland draws no decorations anyway). Remember bounds per project but only restore them when not under a tiling compositor (skip restore on Linux unless the window is floating). Call `app.setName('arbora')` before `ready` and append `ozone-platform-hint=auto` plus `enable-features=WaylandWindowDecorations` so Linux runs natively on Wayland; append any switches from `ARBORA_FLAGS`.
7. Project open: native dialog, recent projects list (most recent 10), drag-and-drop a folder onto the welcome screen, CLI argument `arbora <path>`.
8. Layout: `react-resizable-panels` with the layout from PLAN section 4.1. Persist sizes and collapsed state per project. Lazy-load panel components with `React.lazy` so Stage 0 ships placeholders.
9. Command palette with `cmdk`, command registry in `packages/shared` (`{ id, title, keybinding?, run }`). Every later feature registers commands here.
10. Keybinding service: parse chords like `mod+k`, resolve `mod` to `Meta` on macOS and `Control` elsewhere. Two dispatch paths: (a) renderer `keydown` for everything inside the app chrome; (b) main-process `webContents.on('before-input-event')` on the app window and (from Stage 1) on the browser `WebContentsView`, which `preventDefault()`s the mode chords (`Mod+K`, `Mod+D`, `Esc` while a mode is active, `Mod+Shift+P`) and forwards them to the command registry so they work even when the embedded page has focus or binds the same keys. Add a `terminalPassthrough` setting (default on) so `Ctrl+K`/`Ctrl+D` reach the shell when a terminal is focused. Never use `globalShortcut`.
11. Theme: Tailwind with CSS variables for dark/light, follow `nativeTheme`, toggle command.
12. CI: `.github/workflows/ci.yml` matrix `ubuntu-latest`, `macos-latest`, `windows-latest` running `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test`. A separate `package.yml` on tags running `electron-builder --publish never` and uploading artifacts.
13. electron-builder config: `appId: dev.arbora.app`, targets AppImage + deb (Linux), dmg + zip (macOS, unsigned for now), nsis (Windows). `asarUnpack` native modules.
14. Fixtures: `fixtures/vite-react` (React 19 + Vite + Tailwind), `fixtures/plain-html` (static server). Next and Nuxt fixtures come in Stage 4.
15. Unit tests with Vitest for the IPC helpers, keybinding parser and settings migrations. One Playwright-for-Electron smoke test: launch, open `fixtures/vite-react`, assert the layout renders.
16. Local setup guide in `README.md`: prerequisites per OS, clone and install, `pnpm dev` (including opening a project on launch), running the fixtures, checks and e2e, packaging, where settings live, and troubleshooting.

### Gotchas

- electron-vite externalises Electron and Node built-ins in `main` and `preload` by default but bundles everything else. Native modules (`node-pty` later) must be listed in `build.rollupOptions.external` and kept in `dependencies` (not `devDependencies`) so electron-builder packages them.
- With `sandbox: true` the preload cannot `require` arbitrary modules. Keep preloads tiny: `contextBridge` + `ipcRenderer` only. Everything else lives in main.
- `electron-builder` on Linux needs `libarchive-tools`, `rpm` (if you add rpm) and `fakeroot`; on CI install them in the Linux job. The AppImage needs `--no-sandbox` on some Arch setups unless the AppImage's chrome-sandbox is setuid; document this rather than fighting it.
- `before-input-event` fires for every key in every `webContents`; keep the handler a cheap table lookup and only `preventDefault()` on exact chord matches, or typing in the embedded page and in xterm will lag.
- Frameless windows on Linux lose the native resize border; add an 8px CSS resize region or rely on the compositor (Hyprland handles resize for tiled and floating windows itself, so only Windows needs the CSS fallback).
- `react-resizable-panels` needs explicit `id` and `order` on every panel when panels are conditionally rendered, or layouts get corrupted on persist/restore.
- Playwright for Electron requires `electron.launch({ args: [path/to/main.js] })` against the built output; add a `pnpm build:test` script that builds once without minification.
- Electron 45 no longer downloads its binary in a postinstall hook; `apps/desktop` runs `install-electron` in its own `postinstall`, otherwise `electron` fails with a missing `dist/`.
- `typescript-eslint` 8.x supports TypeScript `<6.1`, so TypeScript is pinned to 6.0.x (the TypeScript 7 native compiler is not usable with the linter yet).
- Vite 8 renamed `build.rollupOptions` to `build.rolldownOptions`, and electron-vite 6 replaced `externalizeDepsPlugin` with `build.externalizeDeps`. Workspace packages export TypeScript source, so they are excluded from externalisation in main and live in `devDependencies`. Sandboxed preloads are built with `externalizeDeps: false`, `isolatedEntries: true` and CommonJS output (`out/preload/*.cjs`).
- `File.path` is gone; dropped folders are resolved with `webUtils.getPathForFile` in the preload (exposed as `window.arbora.getPathForFile`).
- The renderer's `<title>` overwrites `BrowserWindow.setTitle` unless `page-title-updated` is prevented.
- Playwright's `page.keyboard` (CDP `Input.dispatchKeyEvent`) bypasses `before-input-event`. The renderer therefore also dispatches intercepted bindings it receives (a keydown that reaches the renderer was not consumed by main, so nothing fires twice); e2e tests use `webContents.sendInputEvent` to prove the main-process interception.
- `react-resizable-panels` v4 renamed the API (`Group`/`Panel`/`Separator`, `orientation`, `panelRef`). Layouts are persisted per project from `onLayoutChanged` using `meta.requestedLayout`; a collapsed panel is stored as size `0` and restores collapsed. Groups remount (via a key) to reset the layout.
- electron-builder derives installer names from the scoped workspace package (`dist/@arbora/desktop-...`, invalid deb name); `extraMetadata.name: arbora` plus `artifactName` fix it, and `desktopName: arbora.desktop` with `linux.syncDesktopName` keeps the Wayland app_id / WM_CLASS in sync with the `.desktop` file.
- GitHub's Ubuntu runners block unprivileged user namespaces, so Electron needs `--no-sandbox` there; the e2e launcher adds it only when `CI` is set on Linux. The packaged tarball runs sandboxed on a normal desktop.
- Stage 4 acceptance expects `fixtures/vite-react` to be a React 18 dev build (for `_debugSource`), but Stage 0 specifies React 19. The fixture is React 19; Stage 4 should add a React 18 fixture (or variant) rather than downgrading this one.
- On Omarchy's scrolling layout the default column is about 687px wide (see the Hyprland gotcha). The layout minimums now fit inside it, and launches wait for Hyprland to stop resizing the window before tests run.
- Chromium's `second-instance` argv can put switches before the app entry: `electron --class=arbora --enable-features=… . -- /path`. Skipping a fixed `argv[1]` in default-app mode read `.` as the project and opened `apps/desktop` in a second window. `parseProjectArg` skips the first positional argument instead.
- `SettingsStore.update()` must re-read the file first. A hand edit that lands just before an in-app change, and before the watcher reloads it, was otherwise overwritten. On Windows, `rename` over a file that another handle (the watcher, antivirus) has open fails with `EPERM`/`EBUSY` for a moment, so the atomic write retries a few times. This fixed the red Windows e2e jobs (green on PR #7).
- `pnpm build` and `pnpm build:test` (run by `pnpm e2e`) write to the same `out/`, so code that runs `out/` directly must not trust it blindly. `scripts/arbora-local` stores the mtime of `out/main/index.js` after its own build and rebuilds whenever that changes or the source is newer. On each launch it reads the update channel from `settings.json` (`scripts/checkout-channel.mjs`) and runs `scripts/update-checkout.sh main` (Stable) or `beta` (Beta), which fetches that branch and moves a clean `main` or `beta` checkout onto its tip; the Development channel and `ARBORA_UPDATES=off` skip this. A feature branch, a detached HEAD, edits to tracked files, or commits that are not on `origin` are not moved (before 2 Nov 2026 the script was `update-to-main.sh` and switched any clean branch whose commits were on `origin/main` back to `main`). Untracked files stay. Desktop launchers start with the session's PATH, not the login shell's, so the script runs `pnpm` and `git` through `bash -lc`.

### Acceptance

- `pnpm dev` opens the app on Linux, macOS and Windows; opening `fixtures/vite-react` shows the empty layout with persisted sizes after restart.
- On Omarchy/Hyprland the window is native Wayland (`xwayland: false`), tiles and floats correctly, and the custom title bar drags the window.
- `Ctrl+Shift+P` opens the palette; `Ctrl+K` and `Ctrl+D` dispatch placeholder commands from the app chrome, and the bindings are editable in the settings JSON.
- CI matrix is green; `package.yml` produces AppImage, deb, tarball, dmg, exe artifacts; the tarball runs on Arch.

### Checklist

- [x] Monorepo, scripts, `.npmrc`, workspace packages
- [x] electron-vite app with four build entries
- [x] TypeScript strict + ESLint + Prettier
- [x] zod IPC layer and `window.arbora` bridge
- [x] Settings store with migrations; `.arbora/project.json`
- [x] Window management, frameless custom title bar, Wayland flags, `ARBORA_FLAGS`
- [x] Project open: dialog, recents, drag-and-drop, CLI arg
- [x] Panel layout with persistence and lazy panels
- [x] Command palette and command registry
- [x] Keybinding service with `before-input-event` interception and terminal passthrough
- [x] Verified locally on Omarchy/Hyprland (see checklist above)
- [x] Theme
- [x] CI matrix and package workflow
- [x] electron-builder config
- [x] Fixtures `vite-react`, `plain-html`
- [x] Unit tests and Playwright smoke test
- [x] README guide for setting up and running the app locally

---

## Stage 1: Browser panel

**Goal.** Load the user's dev server inside Arbora with the instrumentation every later stage depends on: CDP, console/network capture, screenshots, DevTools extensions, and a preload channel into the page.

**Features.** `F-BROWSER-01` to `F-BROWSER-08`.

**Out of scope.** Multiple tabs (Stage 11), overlays (Stage 4/6), MCP tools (Stage 5).

### Instructions

1. `BrowserService` in main: creates one `WebContentsView` per window with `webPreferences: { partition: 'persist:arbora-browser-<projectHash>', preload: browserPreloadPath, contextIsolation: true, sandbox: true, nodeIntegration: false }`. Attach it to `win.contentView`. The renderer sends the browser panel's rect on every layout change (`ResizeObserver` -> IPC, throttled with rAF), and main calls `view.setBounds`.
2. Navigation API: `navigate(url)`, `back`, `forward`, `reload`, `hardReload` (`reloadIgnoringCache`), `stop`, `openExternal`, `toggleDevTools`, `setZoom`. Emit `navigation-state` events (url, title, canGoBack, canGoForward, loading, favicon). Register the Stage 0 keybinding interceptor on the view's `webContents` (`before-input-event`) so `Ctrl+K`/`Ctrl+D`/`Esc` reach Arbora even when the page binds them.
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
- Electron's `webContents.capturePage` returns the visible area at device scale. On HiDPI screens the PNG is 2x; store `dpr` with every screenshot so element rects can be mapped back. Hyprland fractional scaling (1.25, 1.5, 1.666...) produces non-integer `dpr`; round rects when burning in highlights and test with Omarchy's `Super+/` scaling toggle.
- Under Hyprland the window is resized by the compositor on every tiling change; `view.setBounds` must be driven by the renderer's `ResizeObserver`, not by `BrowserWindow` `resize` events, or the view lags one frame behind and leaves black bands.
- Attaching the debugger after DevTools is open throws "Another debugger is already attached". Wrap `attach` in try/catch, listen for `devtools-closed` and retry.
- `Network.enable` with large pages can flood the main process. Set `maxTotalBufferSize` and drop bodies; only metadata goes in the ring buffer.
- If the dev server redirects to `0.0.0.0` or an IPv6 host, Chromium may refuse. Normalise `0.0.0.0` to `localhost` in the URL bar.
- Self-signed HTTPS dev servers (Vite with `https: true`) trigger certificate errors. Add `session.setCertificateVerifyProc` that trusts localhost origins only, behind a setting.
- Do not use `setCertificateVerifyProc` for the localhost rule after all: Chromium caches verifier results per certificate for the session, so toggling the setting does not apply to certificates already seen (in either direction), and `closeAllConnections()` does not clear it. `app.on('certificate-error')` fires on every failed verification, cached or not, so the rule lives there and reads the setting live.
- Electron does not exit while a `WebContentsView`'s webContents is still open. Close it first in `dispose()`, before anything that can throw (such as saving state). The bug showed up as `app.close()` hanging: a save on window close emitted a settings change, the listener read `webContents` on the destroyed window, and the throw skipped the close. `ProjectWindow` now leaves the manager before disposing.
- `BrowserWindow.capturePage()` does not include child `WebContentsView`s. Capture the view's own webContents for page screenshots; for whole-window artifacts, use an OS-level capture.
- The DevTools webContents shares the page's session. Code that finds "the page" by session or partition (tests, diagnostics) must skip `devtools://` URLs.
- Opening DevTools emits `Network.loadingFailed` (`net::ERR_CACHE_MISS`) for requests the page never sent. Only report failures for request IDs seen in `requestWillBeSent`.
- React DevTools and Vite's client both wrap `console`, so the top stack frame of a page `console.error` is `installHook.js` or `@vite/client`. Problems uses the first frame that is not tooling (`chrome-extension://`, `/@vite/`, `/@react-refresh`, `/node_modules/`).
- Chrome Web Store CRX files contain a `_metadata/` folder (verified contents) that Electron refuses to load ("Cannot load extension with file or directory name _metadata"). Skip it when unpacking. The store serves only the latest version, so the SHA-256 pins drift when React/Vue DevTools publish; `pnpm --filter @arbora/desktop extensions:update` re-pins them, and `pnpm dev`/`e2e` treat a failed fetch as a warning (`--optional`) while `pnpm package` fails.
- React DevTools (MV3) works in Electron 45: its hook is injected before React boots, and the Components/Profiler panels appear in the page's DevTools, which opens detached because the view has no room to dock it.
- Vite's SPA fallback answers missing paths (including `/favicon.ico`) with `index.html` and status 200 unless the request sends `Accept: application/json`. The fixture's 404 card sends that header, and the URL bar hides favicons that fail to decode.
- Chromium zoom is per origin, so after a cross-origin navigation the panel re-applies its own zoom factor on `did-finish-load`.
- Display scaling leaks into screenshots even at "100%": the Linux test VM reports `devicePixelRatio` 0.984375, so PNG sizes are `round(css * dpr)`. Never assume integer `dpr` in tests or rect math.
- DOM over the view (command palette, error and empty states) only shows if the view is hidden, so the renderer sends a `null` rect for those states, and main moves focus back to the app window when it hides a focused view. Toasts are fixed bottom-right, normally over the agent or bottom panel; with both collapsed they fall behind the view (move them into the panel chrome when that matters).
- The renderer's CSP must allow `img-src http: https:` for page favicons in the URL bar.
- Unpackaged Electron (dev, e2e) logs "Electron Security Warning (Insecure Content-Security-Policy)" into the user's page when it has no CSP. This was seen on macOS and Windows CI but not on Linux. It arrives through CDP `Log.entryAdded` as well as the console, so Problems drops it in both mappers. Reproduce locally with `ELECTRON_ENABLE_SECURITY_WARNINGS=true pnpm e2e`.
- CI windows are smaller than a desktop session, so e2e layout assertions pick a viewport preset first instead of relying on the window size.
- In a half-width Hyprland tile (~700px), the toolbar hides the screenshot, external and DevTools buttons. Tests that click them collapse the sidebar first (`roomForToolbar`), before any measurement that depends on viewport width.
- Instruction deviations: highlights are drawn into the BGRA bitmap in main (no `sharp`, no canvas round-trip), element screenshots crop the viewport capture (one `dpr` source for both), and the "Open fixture" command is **Open Dev Server URL** (uses the project's `devUrl`, default `http://localhost:5173`).

### Acceptance

- Load `fixtures/vite-react`, navigate, hard reload, switch to a mobile preset and see the fixture's responsive layout.
- Console errors and failed requests appear in Problems with timestamps and source URLs.
- A screenshot command writes a PNG with correct dimensions; element screenshot works with a rect.
- React DevTools panel appears inside DevTools for the fixture.

### Checklist

- [x] `BrowserService` with `WebContentsView` and rect sync
- [x] Navigation API and events
- [x] URL bar and chrome
- [x] Viewport presets with CDP emulation
- [x] CDP attach, ring buffers, Problems tab
- [x] Screenshot API (viewport, element, full page, highlight)
- [x] Bundled React/Vue DevTools extensions
- [x] `browser-preload` bootstrap and private channel
- [x] Localhost certificate handling (setting)
- [x] e2e tests
- [x] Verified locally on Omarchy/Hyprland (rect sync while tiling, `Super+/` scaling and screenshot `dpr`, chords with the page focused)

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
- `node-pty` 1.1.0 ships prebuilt binaries for macOS and Windows only, so Linux compiles it during `electron-builder install-app-deps`. A space in the checkout path ("Voxel North") only causes a warning. pnpm 10 skips dependency build scripts unless the package is in `onlyBuiltDependencies`. On macOS the prebuilt `spawn-helper` can lose its exec bit, so `scripts/fix-node-pty.mjs` restores it, and `asarUnpack` keeps it outside the asar.
- `Ctrl+Shift+\`` arrives as `key: '~'`, so chords match the backquote by `code === 'Backquote'`.
- Electron 45's `clipboard.readText`/`writeText` return Promises; await them in IPC handlers, or the lint rule for floating promises fails.
- The `WebContentsView` draws over the DOM, so terminal and tab context menus are native (`Menu.popup` behind the `contextMenu.show` channel); a DOM menu would be hidden under the page.
- xterm instances live in a module-level session map keyed by terminal id, not in React state. Tab switches and splits re-parent the same instance, so scrollback and WebGL context survive. `detach` takes the container, so an unmounting old pane can't detach a terminal that a new pane already holds.
- Chromium focuses a `WebContentsView` when it loads its first page. A dev URL auto-opened from the terminal therefore took the keyboard from the shell, and the next `Ctrl+C` never reached the dev server. `BrowserService.suggestUrl` hands focus back to the app UI during the load and for 1s after it stops, because on Windows the focus can land after `did-stop-loading`. A mouse click in the page or the Focus Page action ends the guard early. Playwright's `page.keyboard` sends input over CDP and ignores OS focus, so e2e tests have to assert `webContents.isFocused()` from main.
- On Windows, starting the first `node` under ConPTY can take longer than vitest's default 5s test timeout, so the real-shell `TerminalService` tests use 20s. node-pty prints `Error: AttachConsole failed` from `conpty_console_list_agent.js` when a terminal is killed. That message is noise, not a failure.
- **Known flake (open):** on macOS CI, `terminal.spec.ts` › "tabs, splits, search and clipboard" sometimes reads an empty clipboard after Find selects the match and `Meta+C` is pressed. It failed twice in [run 40931674159](https://github.com/maplepreneur/arbora/actions/runs/40931674159) on `main` and passed on rerun; the same code passed twice on PR #7. It hasn't been reproduced, and it is only suspected to involve Playwright's macOS `copy:` editing command or the Edit-menu Copy role racing the xterm key handler's async IPC write. Linux and Windows have never failed this step.
- PowerShell's `-Command` exits 1 whenever a native command fails, which hides the dev server's real exit code. `shellCommandArgs` appends `if ($LASTEXITCODE) { exit $LASTEXITCODE }`.
- **Show Terminal** (`Ctrl+\``) must focus the xterm, not just switch tabs; otherwise a fresh window drops typing on the floor. The pane may still be lazy-loading, so focus is a `focusRequest` counter that the active pane consumes when it mounts.
- fontconfig can override the terminal's font list. On this machine `~/.config/fontconfig/fonts.conf` strongly prepends Operator Mono to every `monospace` request, so even an explicit `'JetBrainsMono Nerd Font'` renders Nerd Font icons (starship's U+EA71) as tofu. Powerline glyphs still render, because xterm's WebGL renderer draws them itself. Check with `fc-match "<family>"` before blaming xterm.

### Acceptance

- Open a terminal, run `pnpm dev` in the fixture, see the URL toast, click it, browser panel loads the app.
- "Run dev server" works on a fresh project with inferred command; `.arbora/project.json` is written.
- Splits, tabs, search and copy/paste work on all three OSes.

### Checklist

- [x] `TerminalService` with ring buffer
- [x] Shell detection and login-shell PATH
- [x] xterm UI with tabs, splits, addons
- [x] URL detection and open-in-browser
- [x] Dev command inference, `project.json`, run/restart
- [x] Process-tree kill on all OSes (Linux locally; macOS and Windows unit tests green in [CI run 40924587823](https://github.com/maplepreneur/arbora/actions/runs/40924587823))
- [x] Tests
- [x] Verified locally on Omarchy/Hyprland (`pnpm dev` and packaged tarball)

---

## Stage 3: Agent panel (ACP)

**Goal.** Talk to any ACP agent from Arbora: Claude Code, Codex, Kimi Code, Grok Build, OpenCode, or a custom command. Full streaming UI, permissions, client-side fs/terminal, persistence.

**Features.** `F-AGENT-01` to `F-AGENT-09`, `F-TERM-05`.

**Out of scope.** The Grove workspace (Stage 10). This stage ships the docked panel only. Build the transcript so Grove can mount it later; do not build the title-bar switch here.

### Instructions

1. `packages/acp-client`:
   - `AgentRegistry`: built-in definitions `{ id, name, command, args, env, installHint, docsUrl }` for the five agents (commands in PLAN section 2), plus custom entries from settings. `detect()` checks `which`/`where` for binaries and `npx` availability.
   - `AgentProcess`: spawns the command with the cached login-shell PATH, pipes stdio, wraps `stdout`/`stdin` into an ACP `Stream` (`ndJsonStream` from the SDK), forwards `stderr` to the log viewer. Restart with backoff on crash; surface exit codes.
   - `AcpSession`: uses `client({ name: 'arbora' })` from `@agentclientprotocol/sdk` (stable v1 entrypoint). Register client handlers: `session/request_permission`, `fs/read_text_file`, `fs/write_text_file`, `terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill`, `terminal/release`, and `session/update` notifications. Call `initialize` with `clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true }`, then `authenticate` if `authMethods` is non-empty and the agent returns auth-required, then `session/new { cwd, mcpServers }`.
   - `UpdateNormalizer`: converts `session/update` variants (`agent_message_chunk`, `agent_thought_chunk`, `user_message_chunk`, `tool_call`, `tool_call_update`, `plan`, `available_commands_update`, `current_mode_update`) into a flat, append-only event log the renderer renders. Store raw messages for the log viewer.
2. `AgentService` in main: one `AcpSession` per thread, thread persistence in `.arbora/threads/<id>.json` (metadata + normalized events, not raw blobs beyond a cap), `prompt(threadId, blocks)`, `cancel(threadId)`, `setMode`, `setModel`, `loadOrResume` when `agentCapabilities.loadSession` / `sessionCapabilities.resume` are advertised.
3. Permissions: show a card with the tool title, kind, locations and raw input; buttons map to the agent's `options` (`allow_once`, `allow_always`, `reject_once`, `reject_always`). Remember "always" choices per agent + tool kind in settings. Add a per-thread "auto-approve edits in project" toggle.
4. Client fs handlers: resolve path, ensure it is inside the project root (`path.relative` not starting with `..`, and `realpath` check), read/write UTF-8, emit `file-changed` events that Stage 8 will consume for "Agent changes".
5. Client terminal handlers: back them with `TerminalService` (Stage 2). Show agent terminals as read-only tabs with an "agent" badge; `terminal/output` returns the buffered output with `truncated` flag honouring `outputByteLimit`.
6. Renderer agent panel: thread list, new thread (agent picker), message list (markdown with code highlighting, images inline), thoughts collapsible, tool call cards with status icon and diff view (reuse CodeMirror merge later; a simple unified diff component now), plan checklist, slash command autocomplete from `available_commands_update`, mode/model dropdowns, cancel button, composer with attachments (files via `resource_link`, images via `image`). Put the transcript, composer, permission card and tool cards in `apps/desktop/src/renderer/src/panels/agent/`. They take a thread id and must not assume they live in the right-hand dock. The docked panel is one layout of those components. Grove (Stage 10) is the other.
7. ACP log viewer: raw JSON-RPC both directions with redaction of `env` and `token`-like values; export to file.
8. First-prompt instruction block (Stage 5 will extend it): a short system-style preface describing Arbora, the project cwd, and the dev URL.
9. Tests: unit tests for the normalizer and path scoping; an integration test that runs a tiny fake ACP agent (from the SDK examples) end to end; manual matrix against the real agents recorded in the Progress notes (Kimi Code, Grok Build and OpenCode; Claude Code and Codex are built-ins but not part of the matrix on this machine).

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
- **SDK 2.1 dispatches notifications late.** `@agentclientprotocol/sdk` resolves a response promise synchronously but runs `session/update` handlers through async hops, so the last chunks of a turn can arrive *after* `session/prompt` resolves, and an agent-initiated request (`session/request_permission`) can run *before* the `tool_call` notification that preceded it on the wire. `AcpSession` counts received vs dispatched updates and `drainUpdates()` after prompt/load/resume and before every incoming request handler. Without it the transcript order is wrong and the permission card appears above its tool call.
- **Handler errors cross the wire as "Internal error".** A plain `Error` thrown from a client handler is sent to the agent with no message. `AcpSession` wraps handlers and rethrows a `RequestError` carrying the message, so a refused `fs/write_text_file` tells the agent `Access denied: … is outside the project folder` and Kimi/Grok report it as a failed tool call instead of a dead turn.
- **`session/new` is not where auth fails for every agent.** Codex's adapter returns `-32000` from `session/new`; Claude Code's adapter accepts `session/new` and returns `-32000` from the first `session/prompt`. Handle auth-required in both places: set `auth_required`, show the `authMethods` from `initialize`, keep the prompt and send it after `authenticate` succeeds.
- **Two model-picker shapes are in the wild.** Kimi returns `configOptions` with `category: 'model'` (plus `thought_level` and `mode`), which is the SDK 2.x API. Claude Code's adapter (0.16.2) and Grok (1.0.70) still return the pre-2.x `models: { availableModels, currentModelId }` from `session/new`/`session/load` and switch models with `session/set_model`, which is not in the stable v1 method table. `sessionConfigOptions()` in `acp-client` synthesises a model option (`arbora:legacy-model`) from `models`, and `AcpSession.setModel` sends the raw request.
- **Grok sends a command line, not `command` + `args`.** Its `terminal/create` is `{ command: "/usr/bin/bash -lc '…'" }` with no `args`. Exec'ing that string as a file name fails with `execvp(3) failed`. When `args` is absent or empty, run `command` through the shell; only exec directly when `args` is given (Kimi, Claude Code).
- **ACP `signal` must be `null`, not `"0"`.** node-pty reports "no signal" as `0`; Grok treats any non-null `signal` in `terminal/output`/`wait_for_exit` as a failed command even with `exitCode: 0`. Map `0`/`undefined` to `null` and real signals to names (`SIGTERM`).
- **Keep tab-only text out of `terminal/output`.** The `[process exited with code N]` footer that `TerminalService` writes into the tab must not reach ACP subscribers, or agents quote it back as command output. Subscribers register through `CreateTerminalOptions.onData` before the process starts, so no output is missed either.
- **Agents title threads from the first prompt, which is our preface.** Kimi's `session_info_update` set the title to "You are working inside Arbora…". `isPrefaceTitle()` drops such titles; other agent titles (Grok's "Add comment to App.tsx") are kept.
- **Zustand selectors must return stable references.** `useAgents((s) => s.attachments[id] ?? [])` creates a new array every render and loops React (`Maximum update depth exceeded`, which blanks the whole window in the packaged build). Use a module-level `NO_ATTACHMENTS` constant for fallbacks.
- **Auto-approve edits needs a location.** Permission requests often omit `toolCall.locations`; fall back to the locations announced by the earlier `tool_call`. With no location at all the card is shown, because the scope cannot be checked.
- **node-pty does not search PATH.** Agent terminals exec `command` directly; resolve it with the login-shell PATH first (`findExecutable` in `shell-env.ts`, which also honours `PATHEXT` on Windows).
- **Cursor's sandbox blocks `forkpty`.** Run `TerminalService` and `AgentService` tests outside the sandbox or they fail with `forkpty(3) failed`.
- **`exactOptionalPropertyTypes` vs zod `_meta`.** Arbora's zod-inferred `ContentBlock` allows `_meta: undefined`; the SDK's types do not. `toAcpBlocks()` strips undefined `_meta` before `session/prompt`.
- **Node runs the fake agent as TypeScript.** `packages/acp-client/src/testing/fake-agent.ts` is executed with `process.execPath` directly (Node type stripping), so the integration tests and the e2e spec need no build step for it. Register it as a custom agent with `command: process.execPath, args: [FAKE_AGENT_PATH]`.
- **OpenCode v2 keeps fs, shell and permissions on its side.** `opencode acp` advertises `loadSession`, image prompts and `configOptions` (one `model` select listing every provider/model pair), but it never calls `fs/*` or `terminal/*` and applies its own `permission` config instead of `session/request_permission`, so there is no agent terminal tab and no Arbora permission card unless the user sets OpenCode to ask. Its default model may be blocked by the OpenCode workspace privacy setting ("This Go model trains on request data"); the error surfaces in the thread and the model picker fixes it.
- **A runtime without a session is still a runtime.** `ensureRuntime` keyed "running" on `runtime.sessionId`, so while an agent sat in `auth_required` every prompt spawned a fresh process and dropped the old one. Windows caught it (`EBUSY` removing the project dir the orphan had as cwd); Linux and macOS leaked silently. Treat `auth_required` with a live runtime as "wait for `authenticate`", and never assign `record.runtime` without stopping the previous one.
- **Unit tests must be portable too.** macOS `tmpdir()` is a symlink (`/var` → `/private/var`), so compare against `realpathSync(root)` when the code canonicalises paths. On Windows, `file://` URIs come from `pathToFileURL` (`file:///C:/…`, `~` percent-encoded), PowerShell treats a command line starting with a quoted path as a string literal (use an unquoted `node -e …`), and `rmSync` of a directory a just-killed child process used needs `maxRetries`/`retryDelay` to dodge `EBUSY`.
- **`pnpm lint` includes `prettier --check`.** Its findings are printed as `[warn] path` lines, not errors, so filtering lint output for "error" hides them; run `pnpm format` before pushing or CI's `Check` jobs go red while eslint, typecheck and tests are green.

### Acceptance

- For each of Claude Code, Codex, Kimi Code, Grok Build and OpenCode: create a thread, send "add a comment to `fixtures/vite-react/src/App.tsx`", approve the permission, see the diff and the file change on disk.
- An agent command runs in the Terminal panel as a read-only tab.
- Restarting Arbora restores the thread list and transcript; `session/load` works where advertised.
- Log viewer shows redacted traffic.

### Checklist

- [x] `AgentRegistry` with five built-ins (Claude Code, Codex, Kimi Code, Grok Build, OpenCode), custom entries, detection
- [x] `AgentProcess` with PATH handling, stderr capture, restart
- [x] `AcpSession` with client handlers and capability negotiation
- [x] `UpdateNormalizer` and persisted event log
- [x] `AgentService`, thread persistence, load/resume
- [x] Permission UI with remembered choices
- [x] Client fs handlers with path scoping and change events
- [x] Client terminal handlers on `TerminalService`
- [x] Agent panel UI (threads, transcript, tool cards, plan, slash commands, mode/model, composer) in `panels/agent/`, mountable outside the dock
- [x] ACP log viewer with redaction
- [x] Fake-agent integration test (unit + e2e)
- [x] Manual matrix recorded (Kimi, Grok and OpenCode `ok`; Claude Code and Codex not tested because the user does not use them, see Appendix B)
- [x] `arch-ok` on Omarchy/Hyprland for the per-stage checks (tiling, scaling, packaged build) with the agent panel (29 Oct 2026, together with Stage 4)

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
7. Prompt popover: rendered by the renderer, anchored at the element rect (converted from page CSS px to window coordinates using the view bounds and zoom). Multiline textarea, Enter submits, `Shift+Enter` newline, chips for attachments with toggles, agent/thread picker defaulting to the thread open in the agent panel, else a new thread with the default agent (project `defaultAgent`, then `settings.agents.defaultAgent`, then the first detected agent). If the popover would overlap the `WebContentsView`, shrink the view's bounds temporarily (view-over-DOM gotcha).
8. Screenshot: hide the overlay, `captureViewport()`, burn in a 2px outline at the element rect (scaled by `dpr`), restore the overlay.
9. Prompt composer (`packages/browser-bridge/prompt.ts`): deterministic template with sections: Request, Target (framework, tier, component chain, file path:line if known), Context (HTML, styles, console errors since last navigation), Instructions (edit the source, wait for HMR, verify via browser tools when available, report what changed). Blocks: `text` for the body, `image` for the screenshot (or a path when unsupported), `resource_link` for each known file.
10. Mode state machine in the renderer: `idle -> inspecting -> selected -> prompting -> idle`. Entering design mode (Stage 6) from agent mode is a transition, not a reload.
11. Add fixtures `fixtures/next` (App Router) and `fixtures/nuxt`; e2e tests select a known component on each fixture and assert the chain and (for Vite React 18 and Vue) the file path.

### Gotchas

- **React 19 removed `_debugSource`.** Only React <= 18 development builds provide file:line per fiber. On React 19, you get owner stacks and component names; file resolution falls to tier 3 or the Stage 11 dev plugin. Say this clearly in the prompt payload (`tier: 3`) so the agent greps.
- **Fibers on DOM nodes point at host components.** The first interesting ancestor is the nearest function/class component; the user usually means that one, but offer the breadcrumb so they can pick `Card` instead of `CardHeader`.
- **Production builds minify names.** If `displayName` looks minified (one or two characters), label it "anonymous component" and rely on HTML descriptors.
- **Shadow DOM and iframes.** `document.elementFromPoint` stops at shadow hosts; use `composedPath()` from the event to find the deepest element. Cross-origin iframes are opaque; highlight the iframe element and say so.
- **Overlay must survive HMR.** Frameworks re-render the body; keep the host element attached to `document.documentElement` (not `body`) and re-append on `MutationObserver` if removed.
- **Capture-phase listeners can break the page's own hotkeys.** Only intercept while the mode is active and release everything on exit. Restore `document.activeElement` focus.
- **Coordinates.** Page CSS px -> view px (zoom factor, scroll) -> window px (view bounds) -> screen px (window position). Write one helper and unit test it; off-by-DPR bugs are the main source of misplaced popovers and outlines.
- **Huge `outerHTML`.** A selected `<main>` can be megabytes. Depth-limit and size-cap before sending over IPC.
- **Screenshots and image sizes.** Agents have input limits; downscale to max 1568px on the long edge and JPEG-quality PNG optimisation before sending.
- **The preload's isolated world cannot see framework internals.** React's `__reactFiber$…` and Vue's `__vueParentComponent` expandos and globals such as `__REACT_DEVTOOLS_GLOBAL_HOOK__` exist only in the page's main world. `detect.ts` and `components.ts` therefore run there through `webFrame.executeJavaScript(mainWorldInstallScript())`, which inlines them with `Function.toString`. Each one must be self-contained, with no imports or module-level helpers in its body. `main-world.test.ts` evals the script to enforce that. The overlay itself stays in the isolated world, where the page cannot reach it.
- **Vue's expandos are non-enumerable.** `Object.keys(el)` never lists `__vueParentComponent` or `__vnode`, so check them with `in`. React's keys carry a random suffix (`__reactFiber$x1y2`), so they are found by prefix through `Object.keys`.
- **React 19 owner stacks point at transformed code.** `_debugStack` frames carry the served URL (Vite `/src/...?t=…`, or a Turbopack chunk such as `/_next/static/chunks/_1ntv8a._.js`), and their line numbers belong to the transformed output, so the lines are dropped. Turbopack also flattens library paths into chunk names (`…_next_dist_compiled_react-dom_…js`); the library filter matches `next[/_]dist[/_]` and `react-dom[/_.-]` as well as `node_modules`.
- **React replays server stacks as `about://React/Server/file:///…`.** Those paths point into `.next/dev/server/chunks/…`, which exist on disk. `isProjectSource()` rejects anything under a dot-directory or `node_modules`, or the agent gets a build chunk as "the source". Server components come only from the fiber's `_debugInfo` (`{ name, env: 'Server' }`) and are listed by name.
- **The popover swaps the view for a frozen frame instead of shrinking it.** Shrinking the `WebContentsView` reflows a responsive page, so the element moves away from the anchor. While prompting, the view is hidden and the renderer shows the clean capture at the view rect, the outline and the popover. `capturePage()` on a hidden view is empty, so main captures during `selected`, before the renderer hides the view.
- **Capture-phase listeners must run before the page's own.** The inspector adds its `window` capture listeners when the preload starts, before any page script, and they do nothing unless the mode is active. Listeners added at `Mod+K` time run after the page's own `window` capture listeners, so the page would still see the click.
- **Mode chords must toggle without a page.** The Stage 0 smoke tests expect `Mod+K` to enter agent mode even when the browser is empty. The banner then says to load the page, and the inspector starts when the page's preload reports `ready`.
- **Agent-mode threads need a title hint.** The composed prompt starts with `## Request`, which became the thread title. `AgentService.prompt(…, { title })` names new threads after the user's request, and the hint survives the `auth_required` pending-prompt path.
- **Next 16 writes into the fixture.** `next dev` creates `AGENTS.md`, `next-env.d.ts` and `.next/` in `fixtures/next`; they are git-ignored, and the Next and Nuxt fixtures are excluded from ESLint (their types only exist after `next dev`/`nuxt prepare`). With the hoisted `node-linker`, the CLIs live at `node_modules/next/dist/bin/next` and `node_modules/@nuxt/cli/bin/nuxi.mjs`. On Windows, `taskkill /T` is needed to stop their child servers.
- **Playwright's `electron.launch` hangs on the packaged build.** It attaches the inspector, but the launch never resolves against the packaged ESM main. For packaged checks, start the binary with `--remote-debugging-port`, then use `chromium.connectOverCDP`. The page's `WebContentsView` is in another partition, so attach to it with `Target.attachToTarget` (`flatten: false`).
- **Native `<select>` popups do not follow the theme.** On Linux, Chromium draws them as a light, unthemed list, which is unusable for OpenCode's 115 `provider/Model` entries. The mode, model, config and "Send to" pickers use `components/Picker.tsx` instead. It is themed, searchable above eight options, groups `provider/Model` names by provider, and is keyboard-driven. Its popover is a DOM element, so it stays inside the nearest `[data-picker-bounds]` panel, because the browser's native view would paint over anything that strays onto it. The global `:focus-visible` rule is unlayered and beats Tailwind's `outline-none`, so the picker turns the outline off inline. e2e picks with a click on `[data-testid="<id>-option"][data-value=…]` and asserts `data-value`, not `selectOption`/`toHaveValue`. The browser toolbar's viewport preset stays a native `<select>`: its list drops over the page, where only a native popup can draw.
- **Agent mode sends to the open thread.** At first the popover preferred the last thread agent mode had used, so feedback landed in a thread the user was not looking at. It now defaults to the thread open in the agent panel. With no thread open, it uses a new thread with the default agent (`defaultAgentModeTarget`, unit-tested). Sending to a thread that is mid-turn is refused in the popover ("still working; stop it first"); it used to fail silently in main.
- **Stop must not depend on the agent.** `session/cancel` is a request the agent may ignore, and an agent that is still starting (an `npx` download) has no turn to cancel. `AgentService.stop()` cancels, waits `STOP_GRACE_MS` (3 s), then stops the process. A start in flight then ends as `idle`, a waiting prompt resolves as `cancelled`, and the killed turn's transcript ends with `turn_end: cancelled` rather than an error. The `stopRequested` flag is read through a method: `stop()` sets it while an `await` is pending, and TypeScript's narrowing (and lint) cannot see that. The fake agent's `stubborn` prompt and `FAKE_AGENT_SLOW_START` cover both paths.
- **Auto-growing textareas show a scrollbar if the border is ignored.** `scrollHeight` excludes the border, but a border-box `height` includes it, so a composer sized to `scrollHeight` is 2 px short and always scrolls. Add `offsetHeight - clientHeight`, and keep `overflow-y: hidden` until the maximum height is reached.
- **Agent settings patches are explicit.** `settings.update`'s `agents` patch uses `agentSettingsPatchSchema` and `mergeAgentSettings()`, so omitted fields keep their value and `defaultAgent: null` clears it. `.partial()` on a schema with `.default()` fields is not a safe patch type.
- **CI windows are small.** On the macOS and Windows runners the browser panel is about 400 px tall, so the popover fits neither above nor below the element. `placePopover()` then tries right and left, and otherwise pins to the edge that covers less of the element. The e2e checks the geometry for whichever side was chosen.
- **Windows tests need drive letters.** `fileURLToPath` and `path.resolve` add `D:`, while `join('/', …)` does not. Build fake project roots with `resolve()`.
- **ripgrep is often not on PATH.** On this machine only Cursor's bundled `rg` exists. `findCandidates()` uses `rg` from the login-shell PATH when present and otherwise falls back to a bounded Node walk (5000 files, 1 MB each, 3 s).
- **`fixtures/vite-react` pins React 18, and `react-dom` with it.** The hoisted `node-linker` puts the fixture's own `react` 18 in `fixtures/vite-react/node_modules`, but a `react-dom` at the root's version resolves to the root's copy, which loads the root's React 19. The page then has two Reacts and renders nothing, and every spec on it times out at 60 s in `waitForHydration` or a counter check (Dependabot's PR #19, 4 Nov 2026). Dependabot skips the fixture (`exclude-paths`). Bump `react` and `react-dom` together and by hand, and only while the `_debugSource` tier still has a React 18 page to test.

### Acceptance

- On `fixtures/vite-react` (React 18 dev build) clicking the button inside `Card` shows chain `Button <- Card <- App` and the path `src/components/Card.tsx:LINE`.
- On `fixtures/nuxt` the chain shows Vue component names and `.vue` paths.
- On `fixtures/next` (React 19) the chain shows names and the payload declares tier 3 with grep candidates.
- Submitting "make this button red" produces a thread where the agent edits the right file and the page updates.
- Agents without image support receive a file path and still succeed.

### Checklist

- [x] Inspector overlay with shadow root, box model, label, breadcrumb
- [x] Element refs and selector fallback
- [x] Framework detection
- [x] React and Vue component chain resolution
- [x] Tier 3 descriptor and ripgrep candidates
- [x] Source path normalisation
- [x] Prompt popover anchored to element, view-overlap handling (frozen frame instead of shrinking the view; see Gotchas)
- [x] Screenshot with highlight
- [x] Prompt composer and block assembly, image fallback
- [x] Mode state machine
- [x] `fixtures/next`, `fixtures/nuxt`, e2e tests
- [x] Agent panel follow-ups: Stop always available (`F-AGENT-10`); default agent, default model and favourite models (`F-AGENT-11`); agent mode targets the open thread
- [x] Manual matrix: OpenCode, Kimi Code and Grok Build `ok` (Claude Code and Codex not tested; the user does not use them)
- [x] `arch-ok` on Omarchy/Hyprland (29 Oct 2026): native Wayland, `Mod+K`/`Esc` with the page focused, the packaged build, DPR 1.5 (forced), and your hand checks of tiling/floating moves and scaling

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
- **Run the HTTP server stateless.** Each POST gets a fresh `McpServer` and `StreamableHTTPServerTransport` (no `sessionIdGenerator`, `enableJsonResponse: true`; GET answers 405). State that must outlive a request, such as snapshot refs, allowed origins and the in-flight request counter, lives in `ToolContext`, one per agent process. With `exactOptionalPropertyTypes`, passing `sessionIdGenerator: undefined` does not compile; leave the key out.
- **OpenCode 2.1.4 calls MCP tools from its own code tool.** It advertises `mcpCapabilities.http` and lists the tools at `session/new`, but runs them as `tools["arbora-browser"].browser_screenshot(…)` inside an `execute` tool call. Its cards therefore say "execute", not the tool name, and the screenshot thumbnails are what shows the user what it saw. It reads `.arbora/SKILL.md` when the preface points at it.
- **React splits text into several nodes.** `Hello, {name} ({size})` becomes four `StaticText` siblings, so a naive snapshot prints four `text:` lines and `text: "Hello, nobody"` never matches. `formatSnapshot` joins adjacent text nodes, as Playwright does.
- **The stdio shim runs on Arbora's own executable.** The entry is `{ command: process.execPath, args: [out/main/mcp-shim.js, url], env: [ELECTRON_RUN_AS_NODE=1, ARBORA_MCP_TOKEN] }`. The token is in the env, not argv, so `ps` does not show it, and the log viewer redacts every `env` value. Electron in Node mode reads the script from inside `app.asar`; no Electron fuse disables `RunAsNode` today, and if Stage 9 adds fuses, keep that one on or ship the shim unpacked. The SDK's `StdioServerTransport` does not notice stdin closing, so the shim listens for `end` itself. `ARBORA_MCP_TRANSPORT=stdio` forces the shim for every agent (it is how the shim was tested with OpenCode).
- **The fake agent is a real MCP client now.** It connects to every `mcpServers` entry at `session/new` (HTTP, or stdio with `FAKE_AGENT_NO_HTTP_MCP=1`) and lists the tools, as real agents do. Otherwise `AgentService` would warn "has not loaded Arbora's browser tools" in every fake-agent e2e. Its "tool sweep" prompt calls every tool once against `fixtures/vite-react`, and the e2e reads the raw message text through `agent.getThread`, because the transcript renders Markdown and joins single newlines.
- **Fixture line numbers are pinned in e2e.** The Stage 4 spec expects the Counter `<Card` at `src/App.tsx:14`. Adding the form for `browser_type`/`browser_select_option` moved it, so the form lives in `components/NameForm.tsx`, and the import cost one line, which the spec now expects.
- **`pnpm e2e` tests the bundle.** `mcp-browser-server` is compiled into `out/main`, so `playwright test` on its own after a source change runs the old code. Run `pnpm build:test` first (`pnpm e2e` does). `scripts/arbora-local` now watches every `packages/*/src` for the same reason; it used to watch only `packages/shared`.

### Acceptance

- With any of the four agents: "Change the primary button to red and confirm visually" results in the agent editing the file, taking a screenshot, and replying with a confirmation and the image, without user intervention beyond permissions.
- `browser_snapshot` output includes refs that `browser_click` accepts; the fixture counter increments.
- Navigating to `https://example.com` via the tool prompts for permission once.
- `devserver_restart` brings the server back and the browser reloads on the new URL.

### Checklist

- [x] MCP server with HTTP transport, token auth, start/stop per session
- [x] ACP registration (http) and stdio shim fallback
- [x] Navigation, observation, interaction, dev-server tools
- [x] CDP-based input and ref resolution
- [x] Permission surfacing and origin check (permission cards; screenshots mirrored as thumbnails, not as duplicate tool cards)
- [x] Agent instructions and `.arbora/SKILL.md`
- [x] Tests and manual matrix (OpenCode on a free model only, at the user's request; Kimi Code and Grok Build not run)
- [x] `arch-ok` on Omarchy/Hyprland (29 Oct 2026): your hands-on checks passed

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
- **Do not set `textContent` on a component root.** That deletes its children, and React then throws on the next render. Text edits (the panel field and double-click) go to the element itself when it is a leaf, otherwise to its first text-only descendant (the card title, not the whole card).
- **`AgentService.prompt` resolves when the turn ends, not when it starts.** Design save and resend create the thread, return its id, and deliver the prompt in the background (as agent mode does), or the panel stays on the design view until the agent has finished.
- **Switching off or deleting a change in the middle of the list.** A style op's `inlineBefore` is the value the previous op left, so reverting one op on its own can leave a stale inline style behind. `OpLog` always rebuilds: revert every applied op newest first (that ends on the original), then re-apply the ones that are switched on. Undo, compare, switch-off and delete all go through that path, and Save sends only the switched-on ops.
- **"Installed" is not "signed in".** Claude Code and Codex run through `npx`, so they look available wherever `npx` exists. Pickers use the sign-in check instead. Some agents only refuse an unsigned user on the first prompt, so `ready` means "opened a session", not "will answer". e2e profiles set `agents.autoVerify: false`, so CI never starts the built-in `npx` adapters.
- **Panel inputs commit on blur only.** Committing on Enter and again on the blur that follows records the same edit twice before the page reports the new computed value.
- **Design mode replaces the agent panel.** A resend has to leave design mode before the thread is on screen; the transcript is not mounted while the properties panel is.

### Acceptance

- Change text, padding and background on the fixture card, undo one step, redo, save. The agent receives two images and a bullet list, edits source, and the resulting page matches the after screenshot (manual visual check plus `browser_screenshot` from the agent).
- Discard restores the original page without reload.
- Reopening Arbora shows the session in a "Design sessions" list and resend works.

### Checklist

- [x] Design overlay, selection, handles
- [x] Op recorder with apply/revert, undo/redo, crash-safe mirroring
- [x] Live preview and re-apply after re-render
- [x] Properties panel groups and controls
- [x] Inline text editing
- [x] Structure ops and insert palette
- [x] Styling-approach detection and Tailwind mapper
- [x] Save flow (screenshots, change list, sources, instructions), discard
- [x] Session storage and resend
- [x] Tests
- [x] `arch-ok` on Omarchy/Hyprland (signed off 30 Oct 2026)
- [x] Appendix B design-save row deferred for now

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
- **chokidar 6 is a rewrite.** It is ESM-only and needs Node ≥ 22.22. `usePolling`/`interval` are deprecated in favour of `backend: 'polling'` and `pollingInterval`. `ignored(path, stats)` is called first without `stats`, so ignore only what is ignored as both a file and a folder until it asks again with `stats`. With `node-linker=hoisted`, the root `node_modules/chokidar` is an older copy other packages pull in; v6 lives in `apps/desktop/node_modules`. Unreadable folders raise `EACCES` for each folder; skip those quietly.
- **ripgrep and `.gitignore`.** `rg` ignores `.gitignore` outside a git repository unless given `--no-require-git`. `--json` submatch offsets are UTF-8 bytes; convert them to UTF-16 columns for CodeMirror.
- **ESLint 9+ reports files no config covers** as a warning ("File ignored because no matching configuration was supplied"). Drop it, or every unconfigured file shows a problem.
- **`tsc` gets 30 s, not 10 s.** Prettier and ESLint keep the 10 s timeout. A cold `tsc --noEmit` on a mid-sized project takes longer than 10 s, and type-check on save is off by default anyway.
- **cmdk with `shouldFilter={false}` and async results.** cmdk does not select the first item when results arrive later, and Enter pressed before the new results arrive picks the old top item. Control `value` and make Enter wait for the query in flight.
- **Search results can arrive before `search.start` resolves.** Buffer events for unknown search ids and replay them once the id is known.
- **Editor tabs replace the browser pane**, as Settings does. Unmounting `BrowserPanel` hides the `WebContentsView`. Agent and design mode, Focus URL and Open Dev URL switch back to the Browser tab first. CodeMirror's `Mod+D` (select next occurrence) is shadowed by design mode, which main intercepts.
- **CodeMirror in tests.** `.cm-activeLineGutter` matches one element per gutter (line numbers, fold, lint); scope it to `.cm-lineNumbers`. Renderer unit tests cannot import modules that create the app store (it reads `window.arbora`), so pure editor helpers live in `panels/editor/text-utils.ts` and `language-id.ts`.
- **Driving the packaged build.** Playwright's `_electron.launch` hangs on the packaged binary. Start it with `--remote-debugging-port` and use `chromium.connectOverCDP` instead.
- **macOS menu roles own their accelerators.** The File menu's `role: 'close'` took `Cmd+W` before the renderer saw it, so `Cmd+W` closed the window instead of the editor tab. Any menu role whose chord Arbora binds needs a different accelerator (`Shift+Cmd+W` here) or `registerAccelerator: false`.
- **Paths in tests.** macOS temp folders live under `/var`, a symlink to `/private/var`, so compare with `realpathSync`. On Windows, `join('/x', '')` is `\x`, and directory symlinks need `'junction'`. Terminal e2e commands must work in bash, zsh and PowerShell: `echo`, not `printf`.
- **A tall `.xterm-screen` is not the fitted row grid.** The screen element can be much taller than the rows xterm fitted (the Grove content pane left a 1278 px screen over 24 row divs). Clicking `box.height / rowCount` lands below the first line, so a file link never opens. Walk the top of `[data-terminal-id] .xterm-screen` in line-sized steps. The link layer is a canvas (`.xterm-link-layer`).

### Acceptance

- Open, edit, save `src/App.tsx` in the fixture; Prettier formats; ESLint diagnostics show in the gutter and Problems tab.
- Quick open finds files in under 100 ms on a 10k-file repo; search streams results.
- The diff viewer renders a change with word-level highlighting in both layouts.

### Checklist

- [x] `WorkspaceService` and watcher with ignore rules
- [x] Explorer tree with rename/move/context menu
- [x] Quick open with fuzzy index
- [x] Ripgrep search panel
- [x] CodeMirror editor, tabs, save, external change detection
- [x] Prettier on save via utility process
- [x] ESLint/tsc diagnostics on save (settings)
- [x] Diff viewer component
- [x] Open-at-line wiring from terminal and agent locations
- [x] `arch-ok` on Omarchy/Hyprland (1 Nov 2026)

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
- **`GitService` spawns `git` with `execFile`.** The login-shell env is applied on each call, with `GIT_TERMINAL_PROMPT=0` and `LANG=C`. `simple-git` is not a dependency.
- **GitHub auth is the `gh` CLI.** There is no OAuth client id in the app, so the device flow is not implemented. When `gh` is missing or logged out, the panel says to run `gh auth login`.

### Acceptance

- Stage a hunk, commit with an agent-generated message, push, open a PR, see CI status, all from the panel, against a scratch GitHub repo.
- After an agent turn, the Agent changes group lists exactly the files it touched; Revert restores them.
- Explorer and editor gutters show git state.

### Checklist

- [x] `GitService` with status/diff/stage/hunks/commit/branches/log/push/pull/stash
- [x] Git panel UI and hunk staging
- [x] Agent changes group with review/accept/revert
- [x] Explorer decorations and gutter markers
- [x] Generate commit message via agent
- [x] GitHub auth (`gh` CLI) and PR create/list/status
- [x] Tests and manual GitHub run (1 Nov 2026, private `maplepreneur/arbora-stage8-scratch` PR #1; no CI checks on that repo)

---

## Stage 9: Distribution and polish

**Goal.** Installable, signed, auto-updating builds for all three OSes, an onboarding flow that gets a new user to a working agent-mode prompt, and a settings UI.

**Features.** `F-ONBOARD-01`, `F-ONBOARD-02`, `F-NFR-02`, `F-NFR-03`, `F-NFR-04`, and the polish added on 1 Nov 2026: `F-SHELL-07` (Projects page, project groups, project switcher), `F-AGENT-12` (agent groups, pinned threads) and `F-AGENT-13` (attention, notifications, sounds).

**Ship path (2 Nov 2026).** No AUR package. Users download from GitHub Releases on `maplepreneur/arbora`, or from the website, which links to that releases page. `aur/` stays in the repo and is not part of `release.yml`.

### Instructions

1. Signing and notarization: macOS Developer ID certificate in CI secrets, `electron-builder` `notarize` with an App Store Connect API key, hardened runtime entitlements (`com.apple.security.cs.allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation` for native modules). Windows: Azure Trusted Signing or an EV certificate via `signtool`; if neither is available yet, ship unsigned with SmartScreen documentation. Linux: no signing; publish checksums.
2. Targets: AppImage and `.deb` (Debian/Ubuntu), a `.tar.gz` plus an AUR `PKGBUILD` (`arbora-bin`) in a separate `aur/` directory with a release script that bumps `pkgver` and `sha256sums`; `.dmg` universal (arm64 + x64) or separate; NSIS `.exe` with per-user install.
3. Auto-update: `electron-updater` with GitHub Releases provider, channels `latest` and `beta` plus Development (`off`, 2 Nov 2026), "check for updates" command, release notes dialog. Builds not made by `release.yml` never update. Betas come from `beta` through the hand-run **Cut a beta** workflow. AppImage updates in place; `.deb` and AUR users get a notification with instructions instead.
4. Release workflow: a merge to `main` tags the next `x.y.z` -> matrix build -> sign -> notarize -> upload -> publish. A hand tag or **Run workflow** rebuilds an existing tag.
5. Onboarding wizard: welcome, open project, detect dev command (editable), start dev server, detect agents (with install hints and "test connection" that runs `initialize`), show the mode chords for this OS (`Ctrl+K`/`Ctrl+D` or `Cmd+K`/`Cmd+D`) with a "press it now" check and a link to the keybinding editor, finish with a guided `Mod+K` on the running page. Do not add a Grove step here. Stage 10 adds the default-agent choice and a one-time press of the workspace chord.
6. Settings UI: agents (add/edit custom, env overrides, adapter versions and "update adapters"), keybindings editor with conflict detection, the light/dark/system theme control, browser (partition reset, trust localhost certs, the bundled React/Vue DevTools toggle), MCP tool permissions, dev server, screenshots folder, diagnostics toggles, LSP opt-in (Stage 11 ships it). Do not add a Grove page here. Stage 10 adds `notify` and the fallback agent. Colour packs (`theme.json`) are Stage 13. The approved extension catalog is Stage 14.
7. Performance budget in CI: launch the packaged app on Linux, load the fixture, measure RSS after 10 s and screenshot latency; fail if over budget (350 MB, 300 ms). Lazy-load CodeMirror languages and xterm addons.
8. Accessibility: keyboard navigation across panels, focus rings, ARIA on custom controls, reduced-motion support.
9. Crash handling: `crashReporter` disabled (no telemetry); local crash dumps and an "Export diagnostics" command that zips logs and settings (redacted).
10. Docs: `README.md` install instructions per OS, FAQ (why Ctrl instead of Super, macOS PATH, Windows SmartScreen, Hyprland/Wayland flags, Arch sandbox), agent setup pages.

### Gotchas

- **Notarization fails on unsigned native binaries inside `node_modules`** (node-pty's spawn-helper, ripgrep). `electron-builder` signs nested binaries when they are not in `asar`; keep them in `asarUnpack` and verify with `codesign --verify --deep --strict`.
- **Universal macOS builds need both architectures of every native module.** Either build arm64 and x64 separately (simpler, two downloads) or use `@electron/universal` and ensure prebuilt binaries exist for both.
- **AppImage on Arch and Wayland.** Some setups need `--no-sandbox`; the Wayland flags are already baked in from Stage 0 and `ARBORA_FLAGS` covers the rest. Prefer the AUR package for Omarchy users: install to `/opt/arbora`, ship a `.desktop` file with `StartupWMClass=arbora` and a wrapper script, and test `omarchy-launch-or-focus arbora` style launching from a Hyprland bind.
- **Windows per-user NSIS installs and auto-update** work without admin; per-machine installs break `electron-updater`. Keep per-user.
- **`electron-updater` requires `latest.yml` / `latest-mac.yml` / `latest-linux.yml`** in the release; publishing from a draft requires `GH_TOKEN` with `repo` scope in CI.
- **Keybinding editor must prevent trapping `Esc`** and the exit-mode chords; reserve them. Warn when a user picks a Super chord on Linux, since the compositor usually takes it first.
- **`safeStorage` on Linux** depends on a keyring (gnome-keyring/kwallet). Fall back to a warning and plaintext-with-consent if `isEncryptionAvailable()` is false.
- **Zod 4 fills defaults inside `.partial()`.** `browserSettingsSchema.partial().parse({ devToolsExtensions: false })` returns `trustLocalhostCertificates: true` too, so every `settings.update` patch silently reset the fields it left out (found when onboarding's `completed: true` wiped `checkedChords`; it also affected the Stage 7 editor toggles). Patch schemas are built with `patchSchema()` in `packages/shared/src/settings.ts`, which strips the defaults. Use it for any new settings object.
- **A bundled ESM dependency can collide with electron-vite's `require` shim.** `fflate`'s `esm/index.mjs` declares `var require = createRequire('/')`, and the main bundle already has `const require` from the shim: the app dies with "Identifier 'require' has already been declared" before any window opens, and e2e only shows a `firstWindow` timeout. `fflate` is therefore a runtime `dependency` (externalised), like `electron-updater`.
- **Zustand selectors must not build new arrays.** `useApp((s) => s.settings.recentProjects.slice(0, 4))` returns a new array every render; React 19 loops and the whole window goes white. Select the array and slice outside the selector. `ErrorBoundary` now keeps one broken dialog from blanking the app.
- **Mode chords never reach a renderer keydown.** Main intercepts `Mod+K`/`Mod+D` in `before-input-event` even when the app chrome has focus, so onboarding's "press it now" check hooks the command (`setChordProbe` in `commands.ts`), and the shortcut editor sets `recording` on the keybinding context so main lets every key through while it records.
- **Window focus in the renderer.** `window.stateChanged` can fire before the renderer subscribes, and `document.hasFocus()` is false while the embedded page has focus. `App.tsx` re-asks main (`window.getState`) on DOM focus and blur. "The thread is on screen" for attention means: window focused, Settings closed, the agent panel showing that thread.
- **Playwright cannot attach to the packaged build.** `_electron.launch({ executablePath })` fails with "Runtime.evaluate: session closed" on the packaged ESM main. Drive the packaged binary over CDP instead (`--remote-debugging-port`, `chromium.connectOverCDP`), as Stage 4 did; `e2e/perf.spec.ts` does that when `ARBORA_APP` is set and sums PSS over the app's own process tree from `/proc` (shells from the terminal panel are excluded by executable).
- **Idle memory, measured.** Plain-html fixture, 10 s after load, Xvfb with software GL, PSS from `/proc/<pid>/smaps_rollup` (summed working sets count shared pages once per process and read ~890 MB). Three cuts brought the production `out/` build from ~394 MB to ~345 MB: the React and Vue DevTools extensions load the first time page DevTools opens (`browser.devToolsExtensionsLoad`, default `onDemand`; each MV3 service worker kept a 22 MB renderer alive, and Electron has no API to stop one), the MCP server (the SDK plus three Zod builds, ~570 KB) and `electron-updater` load through `src/main/lazy/`, and the transcript (`ThreadView`, with Markdown and highlight.js) is a lazy chunk. The packaged binary, measured over CDP from its whole process tree, was ~374 MB: Electron's `getAppMetrics()` leaves out the two zygotes (~26 MB), and its GPU process is ~10 MB larger. The `v0.0.4` release job measured 442 MB, then 418 MB on retry, with screenshots at 25 ms ([run 41831669114](https://github.com/maplepreneur/arbora/actions/runs/41831669114)): `browser` ~116 MB, `gpu-process` ~115 MB, two renderers ~109 MB and ~44 MB, `utility` ~31 MB, zygotes ~15 MB and ~13 MB. The JS heaps are small (renderer ~22 MB, main ~17 MB), so the rest is Chromium's baseline. Decide whether the budget counts zygotes and software GL, or measure on real hardware with `ARBORA_APP=… pnpm perf`. Tried and not adopted: `--enable-features=NetworkServiceInProcess2` folds the network service into the browser process and saves ~14 MB (packaged ~361 MB), still over budget and at the cost of the network service's crash isolation; `NetworkServiceInProcess` (without the 2) changes nothing. Further cuts would mean in-process GPU or dropping the zygote, which needs `--no-sandbox`, so they are not options.
- **Run electron-builder through pnpm.** `npx electron-builder` detects npm, cannot find the hoisted workspace dependencies ("cannot find path for dependency"), and packs an app whose `app.asar` has only `chokidar`; it then dies at startup. Use `pnpm package` or `pnpm exec electron-builder`.
- **React DevTools registers its hook from its service worker.** After loading the extensions on demand, wait until each extension's worker is running (`session.serviceWorkers.getAllRunning()`) before reloading the page, or the reload races the hook registration and React DevTools sees no renderer.
- **electron-builder writes `resources/package-type` (`deb`) into `linux-unpacked`.** The tarball built before the deb does not contain it, which is what `detectInstallKind` relies on to tell a `.deb` from a tarball. Keep `tar.gz` before `deb` in `linux.target`. The AUR package is detected by its `/opt/arbora` path.
- **A GitHub 504 during packaging fails every OS at once.** electron-builder downloads Electron and its tool archives from GitHub releases (`got`, via `@electron/get`) and already retries a 5xx three times. On 5 Nov 2026 those downloads returned 504 on Linux, macOS and Windows together ([run 42046095073](https://github.com/maplepreneur/arbora/actions/runs/42046095073)), before any draft release existed. The assets answered again within minutes. Recovery is `gh run rerun <run-id> --failed` on that tag: the workflow that runs is the one in the tag, so a retry wrapper added later only helps the next tag. Do not push a hardening commit to `main` just to retry; that starts another full release.
- **The packaged memory job waits for the shell root.** `e2e/perf.spec.ts` used `[data-testid="workspace"]`, which lived on the old browser workspace. The unified shell renders `[data-testid="grove"]` instead, so the `v0.0.5` budget job sat until the 120 s test timeout (both attempts) and never printed a PSS number. The job is `continue-on-error` and did not block publish. `v0.0.4` still measured (442 MB, retry 418 MB) because that build had the old root. `e2e/perf.spec.ts` now waits for `grove`.
- **An empty `CSC_LINK` is not the same as an unset one.** The release workflow passes `secrets.MAC_CSC_LINK` through, and when that secret does not exist the value is `""`. electron-builder then treats it as a certificate path, resolves it to `apps/desktop`, and fails with `apps/desktop not a file` before any `.dmg` is packed. Unset `CSC_LINK` and `WIN_CSC_LINK` when they are empty, and set `CSC_IDENTITY_AUTO_DISCOVERY=false`. Found on the first `v0.0.1` release build (macOS job, 2 Nov 2026). That run left a draft and did not publish.
- **`CSC_IDENTITY_AUTO_DISCOVERY=false` alone ships an unsealed macOS app.** electron-builder 26 only ad-hoc signs when `mac.identity` is exactly `-`. With no identity it logs `skipped macOS application code signing` and packs the bundle with no `_CodeSignature`, and a quarantined download then fails with "Arbora is damaged and can't be opened" and no Open Anyway. `v0.0.2` (2 Nov 2026) shipped that way on both arm64 and x64. The release and package workflows pass `-c.mac.identity=-` when there is no certificate and run `codesign --verify --deep --strict` on every macOS build. Keep the flag out of `electron-builder.yml`, where it would override a Developer ID. Ad-hoc plus the hardened runtime needs `com.apple.security.cs.disable-library-validation`, which the entitlements already have. `codesign -dv` reports `TeamIdentifier=not set` for ad-hoc, so the update check still shows the download notice.
- **Unsigned macOS builds cannot update themselves.** Squirrel.Mac refuses an update unless the app has a Developer ID signature, so `UpdateService` only self-updates on macOS when `codesign -dv` reports a `TeamIdentifier`; otherwise the `.dmg` gets the same "download the new version" notice as a `.deb`. `codesign -dv` prints its report on stderr even on success, so read both streams (`spawnSync`). Gatekeeper on macOS 15+ no longer honours right-click → Open: users click **Open Anyway** in System Settings → Privacy & Security.
- **The Ubuntu 24.04 `.deb` leaves `chrome-sandbox` without setuid.** electron-builder's postinst relies on unprivileged user namespaces and installs an AppArmor profile instead; the sandboxed app starts that way. Do not add `--no-sandbox` for Debian.
- **Setting `autoUpdater.channel` turns on `allowDowngrade`.** electron-updater's `channel` setter does that silently, so a user who moved from Beta to Stable would have been "updated" from `0.0.4-beta.1` back to `0.0.3`. `UpdateService` sets `allowDowngrade = false` after the channel, so leaving Beta waits for the next stable release, as `pickRelease` already did for manual installs.
- **Local packaged builds must not update.** A `pnpm package` AppImage of `0.0.2` would replace itself with the published `0.0.3`. Only `release.yml` builds set `ARBORA_RELEASE_BUILD=true`; electron-vite `define`s it into `out/main/index.js`, and rolldown emits `var RELEASE_BUILD = true;` (not `const`, even unminified), which is what the release job greps for so a broken flag cannot ship builds that never update.
- **The checkout launcher used to leave feature branches.** `update-to-main.sh` checked out `main` whenever the tree was clean and `HEAD` was an ancestor of `origin/main`, so a fresh branch (or another agent's branch in the same checkout) was switched away on launch. `update-checkout.sh` only moves a checkout that is already on `main` or `beta`, and never one with commits that are not on `origin`.
- **`workflow_dispatch` workflows only appear in Actions once they are on the default branch.** **Cut a beta** could not be run until `release-beta.yml` reached `main`. It is on `main` as of `v0.0.4` ([PR #68](https://github.com/maplepreneur/arbora/pull/68)). Run it with **Use workflow from** set to `beta`.
- **No AUR package (2 Nov 2026).** Downloads are GitHub Releases on `maplepreneur/arbora`. The website links to that releases page. `aur/` is kept and `release.yml` does not build or push it. The tarball still needs a setuid `chrome-sandbox` when unpacked as a normal user (`chmod 4755`); the `.deb` handles that in its postinst.
- **Electron 45's clipboard is async and has no `readImage`.** `clipboard.read()` returns `ClipboardItem`s; take the first `image/*` type and `getType()` it to a `Blob`. Write test images the same way (`clipboard.write([new ClipboardItem({ 'image/png': blob })])` from `app.evaluate`); a Playwright `Control+V` into the composer then fires a real paste with them under Xvfb.
- **A `.gitignore` does not untrack committed files.** `.arbora/.gitignore` only hides new files; projects that committed `.arbora/` before keep tracking it until `git rm -r --cached .arbora`, which the Git panel offers.
- **The window zoom factor does not reach the browser view.** `webContents.setZoomFactor` scales the app UI, but the `WebContentsView` is positioned in window DIPs while the renderer reports CSS pixels, so `ProjectWindow` multiplies the browser rect by the zoom (`scaledBrowserRect`). Reapply the factor on `did-finish-load`: a reload resets it.
- **Check synthesized sounds offline.** Render a cue with `OfflineAudioContext` (bundle `sounds.ts` with esbuild and run it in the Electron renderer), write a WAV, and look at `ffmpeg … showspectrumpic`; bird chirps that are too short or too low read as clicks long before you hear them in the app.
- `@codemirror/merge` underlines changed words with a `linear-gradient` background in its base theme, which outranks a plain theme rule. Override `.cm-changedText` / `.cm-deletedText` with `background: … !important` (and `.cm-collapsedLines`, which is light-only by default) or the dark diff stays striped (#41).
- One-shot agent work (commit messages, PR text) must not open a thread: `AgentService.runTask` starts its own ACP session, rejects every permission and terminal request, and serves only read-only project files, so a model that tries to run `git diff` gets the diff from the prompt instead of dumping it into the UI (#48). Keep generated-text parsing tolerant (`parseGeneratedText` strips code fences and a leading `Title:`).
- Skill and MCP tests must not touch the real home folder: `ARBORA_SKILLS_HOME` replaces the home for the skill library, the agent skill folders and the MCP import, `ARBORA_SKILLS_API` points the search at a stub, and `ARBORA_SKILLS_GIT_BASE` makes `owner/repo` clone from a local folder (a plain repository named `repo.git` clones fine). The fake agent's "list mcp servers" prompt reports every server `session/new` passed. The e2e launcher passes the runner's environment through, and `XDG_CONFIG_HOME`, `CLAUDE_CONFIG_DIR` and `GROK_HOME` move agents' folders out of that home. GitHub's Ubuntu runners set `XDG_CONFIG_HOME`, so `skills.spec.ts` clears all three; without that, OpenCode's link lands in the runner's own `~/.config` and the spec fails only in CI.
- e2e specs share `fixtures/vite-react`, and its `.arbora/threads` outlives a run. A spec that starts a thread there must delete it (`agent.deleteThread`) in `finally`, or a later spec that counts threads (agent mode's `titles` check, design mode) fails only in the full run.
- **Marked done for now on 6 Nov 2026, before launch.** The product work is in. Still open until we are ready to ship: **Cut a beta**, the packaged memory budget, a macOS `.dmg` open check, fresh installs per OS, and `arch-ok`. Do not treat those as the current stage.

### Acceptance

- Fresh install from a GitHub Release on Debian, Arch/Omarchy (AppImage or tarball), macOS and Windows reaches a working `Mod+K` prompt through onboarding without reading docs.
- Updates download and apply on macOS/Windows/AppImage; others get a notification.
- CI release pipeline produces signed and notarized artifacts from a tag.
- Performance budget job passes.

### Checklist

- [x] macOS signing and notarization config, entitlements (`electron-builder.yml`, `build/entitlements.mac.plist`; runs when the secrets exist, not yet run with a real certificate)
- [x] Windows signing (or documented unsigned path): `WIN_CSC_LINK` or Azure Trusted Signing in `docs/RELEASING.md`; unsigned until then, SmartScreen in `docs/FAQ.md`
- [x] Linux targets: AppImage, deb, tarball, AUR PKGBUILD and release script (`aur/`, `scripts/release-aur.mjs`); all three built locally on 1 Nov 2026
- [x] `electron-updater` with channels (`main/update-service.ts`; Stable/Beta; manual hints for deb, AUR, tarball)
- [x] Development channel and builder safety ([PR #30](https://github.com/maplepreneur/arbora/pull/30)): `updatePolicy` in `packages/shared/src/updates.ts` (off when unpackaged, for local `pnpm package` builds without `ARBORA_UPDATES=on`, with `ARBORA_UPDATES=off`, and on Development), the reason in Settings → Updates, and the checkout launcher following the channel (`scripts/checkout-channel.mjs`, `scripts/update-checkout.sh`)
- [ ] A beta prerelease published from `beta` with **Cut a beta** (`release-beta.yml`, [PR #30](https://github.com/maplepreneur/arbora/pull/30)) and a Beta-channel AppImage or Windows install updating to it. The workflow is on `main` as of `v0.0.4`. A person still has to run it (about 60 billed minutes). Deferred until launch (6 Nov 2026).
- [x] Release workflow from tags (`.github/workflows/release.yml`: draft, checksums, budget, then publish). `.github/workflows/release-main.yml` tags and starts it on every merge to `main` (2 Nov 2026). The AUR job was removed. `v0.0.1` was tagged and the macOS job failed (`CSC_LINK` empty, `not a file`); the release stayed a draft. Linux and Windows had not finished.
- [x] Onboarding wizard (`panels/onboarding/Onboarding.tsx`)
- [x] Settings UI (Agents with custom agents, env overrides and adapter versions; General; Notifications & sounds; Editor; Browser with reset; Project; Keyboard editor with conflicts; Updates & diagnostics)
- [ ] Performance budget job passes: `e2e/perf.spec.ts` (`pnpm perf`) and the release `budget` job run, and screenshots pass (~25 ms against 300). Memory passes on the production `out/` build (~345 MB PSS by Electron's process list) but not on the packaged binary (~374 MB earlier; 442 MB, retry 418 MB, on the `v0.0.4` release job, which also counts the two zygote processes Electron's metrics omit), on Xvfb with software GL. Needs a decision or a real-GPU measurement (gotchas). Deferred until launch (6 Nov 2026).
- [x] Accessibility pass (focus rings, reduced motion, F6 / Shift+F6 landmarks, dialog focus trap, ARIA on the new controls)
- [x] Diagnostics export (local crash dumps, `logs/main.log`, redacted zip)
- [x] User docs (README install table, `docs/FAQ.md`, `docs/AGENT_SETUP.md`, `docs/RELEASING.md`)
- [x] Notifications, sounds, badge and taskbar flash, **Show Agent That Needs You** (`F-AGENT-13`)
- [x] Agent groups and pinned threads (`F-AGENT-12`)
- [x] Projects page, project groups and **Switch Project…** (`F-SHELL-07`)
- [x] Unit tests (attention, projects, keybinding editor, updates, settings patches, registry overrides, redaction, agent groups) and `e2e/polish.spec.ts`
- [ ] Fresh installs on Debian, Arch/Omarchy (AppImage or tarball), macOS and Windows reach a `Mod+K` prompt through onboarding (`arch-ok`). Deferred until launch (6 Nov 2026). An AUR install is not required (2 Nov 2026). Debian-family done 1 Nov 2026: the `.deb` from current `main` installed with `apt` on Ubuntu 24.04 (Xvfb, sandbox on, `installKind: deb`), and onboarding detected `npm run dev`, started it, registered `Ctrl+K`, and Finish entered agent mode on `http://localhost:5500/`. The AUR layout was checked without pacman (no Arch container here): `aur/PKGBUILD`'s `package()` run in bash on the current tarball gives `/opt/arbora` with `chrome-sandbox` 4755, `/usr/bin/arbora` and a valid `.desktop` file, and the installed copy started through the wrapper sandboxed with `installKind: aur`. The AppImage from current `main` also starts (with `--appimage-extract-and-run`, since the VM has no FUSE), sandboxed, with `installKind: appimage`, so it takes the in-place update path. Still not checked: the tarball or AppImage on Arch/Omarchy, plus macOS and Windows. An AUR helper is not part of the ship path.
- [x] A release published from `main`. Decided 2 Nov 2026: no AUR package, and no Apple or Windows signing accounts. Unsigned downloads are GitHub Releases on `maplepreneur/arbora`; the website links to that page ([WEBSITE_DOWNLOADS.md](./WEBSITE_DOWNLOADS.md), [RELEASING.md](./RELEASING.md)). [PR #68](https://github.com/maplepreneur/arbora/pull/68) merged on 4 Nov 2026 (7:42 AM ET) and published [`v0.0.4`](https://github.com/maplepreneur/arbora/releases/tag/v0.0.4) at 7:47 AM ET ([Release run 41831669114](https://github.com/maplepreneur/arbora/actions/runs/41831669114), workflow success). The packaged memory job reported 442 MB (retry 418 MB) and did not block publish. [PR #77](https://github.com/maplepreneur/arbora/pull/77) published [`v0.0.5`](https://github.com/maplepreneur/arbora/releases/tag/v0.0.5) on 5 Nov 2026 after a rerun of [Release run 42046095073](https://github.com/maplepreneur/arbora/actions/runs/42046095073) (first attempt: HTTP 504 on all three builds). The `v0.0.5` memory job timed out and did not block publish.

### Feedback round (GitHub issues #31–#53, 3 Nov 2026)

User feedback from the first macOS installs, landed as a stack of pull requests into `beta`, one per theme. Each item names its issue; tick it when its PR is open with local checks green, and note the merge in Progress.

- [x] [#53](https://github.com/maplepreneur/arbora/issues/53) `.arbora/` stays out of git: Arbora writes `.arbora/.gitignore` (`*`) whenever it uses the folder (`ensureArboraGitignore` in `main/project-settings.ts`; project open, threads, `SKILL.md`, `project.json`, pasted images), never edits the project's `.gitignore`, and leaves a user-written file alone. The Git panel offers **Stop tracking** (`git rm -r --cached .arbora`) when files there were committed before. [PR #54](https://github.com/maplepreneur/arbora/pull/54)
- [x] [#50](https://github.com/maplepreneur/arbora/issues/50) macOS quits when the last window closes (`quitOnLastWindowClose`, default on, Settings → General on macOS). [PR #54](https://github.com/maplepreneur/arbora/pull/54)
- [x] [#31](https://github.com/maplepreneur/arbora/issues/31) Title bar: a tree mark replaces the green dot that read as a fourth traffic light, with more room after the traffic lights. [PR #54](https://github.com/maplepreneur/arbora/pull/54)
- [x] [#32](https://github.com/maplepreneur/arbora/issues/32) Shift+Tab mode cycling skips a mode the agent refuses (Claude Code's Bypass Permissions answered `Internal error`, so cycling stuck on Don't Ask), remembers it for the thread, and names it in one toast (`rotationOrder` in `thread-controls.ts`). [PR #54](https://github.com/maplepreneur/arbora/pull/54)
- [x] [#34](https://github.com/maplepreneur/arbora/issues/34) Tooltips: `components/Tooltips.tsx` replaces every native `title` tooltip with a larger, high-contrast one after 350 ms, with the chord as a key (`tooltip-text.ts`); the `title` attribute is restored when the pointer leaves. [PR #54](https://github.com/maplepreneur/arbora/pull/54)
- [x] [#35](https://github.com/maplepreneur/arbora/issues/35) Thread header: the title gets its own row; the agent name, pickers and a labelled **Auto-approve edits / Ask before edits** pill share the second; Stop is a compact icon (the composer has the main one). [PR #54](https://github.com/maplepreneur/arbora/pull/54)
- [x] [#36](https://github.com/maplepreneur/arbora/issues/36) Pasting an image into the composer attaches it: `agent.pasteImage` reads the clipboard (Electron 45's async `clipboard.read()`; `readImage` is gone) and saves `.arbora/pasted/paste-<time>.png`; copied files attach by path; text pastes stay text. [PR #54](https://github.com/maplepreneur/arbora/pull/54)
- [x] [#47](https://github.com/maplepreneur/arbora/issues/47) / [#48](https://github.com/maplepreneur/arbora/issues/48) Fonts and size: Settings → **Appearance** (`appearance` in settings) has an interface size (80–150 %, `webContents.setZoomFactor` in `ProjectWindow.applyZoom`, browser bounds scaled to match), an agent text size (default 14 px, `.agent-text` on messages and the composer), and interface, code and agent fonts as `--font-sans`, `--font-mono`, `--font-agent` (`appearanceCssVariables`). The code font defaults to Dank Mono when installed (its licence forbids bundling it), and editor and terminal text moved from 13 to 14 px (settings v4 migrates only untouched 13s). The giant "Generate commit message" diff thread from #48 is in the Git item below. [PR #55](https://github.com/maplepreneur/arbora/pull/55)
- [x] [#33](https://github.com/maplepreneur/arbora/issues/33) Nature sounds: seven synthesized cues (chickadee, robin, songbird trill, woodpecker, owl, water drop, rustling leaves) from oscillator chirps with vibrato and filtered noise in `sounds.ts`; the defaults are chickadee (needs you), robin (finished) and woodpecker (failed), and the old chime/ping/knock defaults migrate. The classic sounds stay under their own group. [PR #55](https://github.com/maplepreneur/arbora/pull/55)
- [x] [#39](https://github.com/maplepreneur/arbora/issues/39) Background sync: `GitAutoSync` (`main/git/git-auto-sync.ts`) fetches every `git.autoSyncMinutes` (default 5) and, in **Fetch and pull** mode, fast-forwards only a clean branch that is behind and not ahead (`shouldAutoPull`); it never merges, rebases or prompts for credentials (`GIT_TERMINAL_PROMPT=0`). Settings → **Git**; `git.synced` refreshes the panel. [PR #56](https://github.com/maplepreneur/arbora/pull/56)
- [x] [#40](https://github.com/maplepreneur/arbora/issues/40) Git panel redesign: branch picker with Fetch/Pull/Push icon buttons and ahead/behind counts, a status line, the message box with a sparkle **Write with AI** button and Commit / Stage all / PR buttons (labels collapse to icons in a narrow sidebar), and collapsible Staged / Changes / Untracked / Agent changes / Stash / History / Pull requests sections whose bulk actions are icon buttons with tooltips. History now shows in the sidebar too (collapsed). [PR #56](https://github.com/maplepreneur/arbora/pull/56)
- [x] [#41](https://github.com/maplepreneur/arbora/issues/41) Readable diffs: `@codemirror/merge`'s base theme draws changed text with a 2px `linear-gradient` underline; `styles.css` and `editor/theme.ts` override `.cm-changedText` / `.cm-deletedText` with a soft background (`--syn-diff-word`) and restyle `.cm-collapsedLines` for both themes. [PR #56](https://github.com/maplepreneur/arbora/pull/56)
- [x] [#43](https://github.com/maplepreneur/arbora/issues/43) Git shortcuts (intercepted, editable in Settings → Keyboard): `Mod+Alt+S` stage all, `Mod+Alt+C` commit (an empty message box gets a generated message to review), `Mod+Alt+P` push (publishes a branch without an upstream with `-u`), and a palette-only **Fetch and Pull Now**; `Mod+Enter` commits from the message box. [PR #56](https://github.com/maplepreneur/arbora/pull/56)
- [x] [#44](https://github.com/maplepreneur/arbora/issues/44) / [#48](https://github.com/maplepreneur/arbora/issues/48) AI commit and PR: `Mod+Alt+Shift+C` stages everything and commits with a generated message; `Mod+Alt+Shift+P` also moves work off the default branch onto `arbora/<slug>` (`branchNameFor`), pushes, and opens a pull request with a generated title and body through `gh`. The text comes from `AgentService.runTask` (`main/agent/agent-task.ts`): a throwaway ACP session with read-only, project-scoped file access and every tool/terminal permission rejected, so no thread is created and the giant diff dump from #48 never reaches a visible thread. The agent and model come from `settings.tasks.git` (Settings → Git, `TaskAgentPicker`, reusable for #45), falling back to the thread default. [PR #56](https://github.com/maplepreneur/arbora/pull/56)
- [x] [#42](https://github.com/maplepreneur/arbora/issues/42) Terminal tabs: every command an agent runs used to open its own "<thread title>: <command>" tab that stayed after it exited, so tabs piled up as "Can you … agent exited". Agent terminals now share one **Agent** tab (`AGENT_TAB_ID` in `terminal-store.ts`, kept last) with a count and a spinner while one runs; inside, a list shows each command (`agentCommandLabel`: program basename, shell `-c` wrappers unwrapped), its thread (new `TerminalInfo.thread`) and its status beside the selected output, with **Clear finished**. Shell tabs drop the "exited" label for a dimmed tab and tooltip, keep the close button visible on the active tab, and the strip scrolls sideways with the wheel, keeps the active tab in view and hides its scrollbar. [PR #57](https://github.com/maplepreneur/arbora/pull/57)
- [x] [#37](https://github.com/maplepreneur/arbora/issues/37) Panel hotkeys: `Mod+1`..`Mod+4` focus the sidebar, browser/editor, bottom panel and agent panel (expanding a collapsed one), and `Mod+Alt+arrows` move to the neighbouring panel like a tiling window manager (`neighbourPanel` in `packages/shared/src/commands.ts`; the embedded page counts as the centre). Each panel focuses its natural target: the file tree or commit box (`data-panel-focus`), the editor or page, the active terminal, the composer. All are intercepted and editable in Settings → Keyboard. `Ctrl+digit` is no longer a terminal passthrough chord, since shells do not use it. [PR #58](https://github.com/maplepreneur/arbora/pull/58)
- [x] [#38](https://github.com/maplepreneur/arbora/issues/38) Mode pills: a **Freestyle / Agent / Design** segmented control after the project name replaces the "Agent mode" badge; clicking runs the same toggles as `Mod+K` / `Mod+D` (so leaving design mode still asks about unsaved edits), the tooltips show the chords, and labels collapse to icons in a narrow window. [PR #58](https://github.com/maplepreneur/arbora/pull/58)
- [x] [#45](https://github.com/maplepreneur/arbora/issues/45) Defaults per task: `settings.tasks` has an agent and model for agent mode, design mode, Fix problems and Git (`TASK_IDS`). Settings → Agents shows them as **Defaults per task** (`TaskDefaults`), and onboarding has a **Task defaults** step after Agents. Agent mode's default "send to" becomes a new thread with the agent mode task's agent and model when no thread is open (`useTaskAgentId`, `taskModelFor`); design mode's send bar and `defaultDesignTarget` prefer the design task's agent and model; an open thread always keeps its own. "Default agent" falls back to the project's or the starred agent (`resolveTaskAgent`). [PR #59](https://github.com/maplepreneur/arbora/pull/59)
- [x] [#46](https://github.com/maplepreneur/arbora/issues/46) Fix problems: each row in Problems (page and code) gets a **Fix** button on hover, and the toolbar a **Fix all N** button for what the current filter shows. Both start a thread with the Fix problems task's agent and send a prompt from `fixPageProblemsPrompt` (repeated failures listed once with ×N, the page URL, and a note to name a server that is not running instead of changing code) or `fixDiagnosticsPrompt` (path:line:column, tool and rule; capped at 50). [PR #59](https://github.com/maplepreneur/arbora/pull/59)
- [x] [#51](https://github.com/maplepreneur/arbora/issues/51) / [#52](https://github.com/maplepreneur/arbora/issues/52) Skills and MCP manager, skills.sh search. Settings → **Skills** keeps one copy of each skill in `~/.arbora/skills` (`main/skills/skill-library.ts`) and symlinks it (junctions on Windows) into the skills folders the agents read, chosen per skill: Claude Code `~/.claude/skills`, Codex and Kimi `~/.agents/skills`, Grok `~/.grok/skills`, OpenCode `~/.config/opencode/skills`, Cursor `~/.cursor/skills` (paths as in the `skills` CLI; `SKILL_TARGETS` in `packages/shared/src/skills.ts`). Skills already in an agent folder are listed with **Add to library**, which moves them in and links them back; a different folder of the same name is never replaced. A search box queries `skills.sh/api/search`; **Install** shallow-clones the GitHub repository, copies the matching `SKILL.md` folder and links it for every installed agent (`~/.arbora/skills-lock.json` remembers the source). Settings → **MCP servers** (`settings.mcpServers`) lists stdio and HTTP servers with an on/off switch and an optional agent list; `AgentService` adds them to `session/new`/`load`/`resume` next to `arbora-browser` (`mcpServersFor`; HTTP only for agents with `mcpCapabilities.http`), and **Import** reads `~/.claude.json`, `~/.cursor/mcp.json`, `~/.gemini/settings.json` and the project's `.mcp.json`. Diagnostics drop MCP env values and headers. [PR #60](https://github.com/maplepreneur/arbora/pull/60)
- [ ] [#49](https://github.com/maplepreneur/arbora/issues/49) Mobile and desktop apps (deferred on 3 Nov 2026; the issue stays open)

---

## Stage 10: Grove

**Goal.** A second workspace, named Grove, that replaces the browser layout with a manager for every ACP agent in the project. The title-bar switch and `Mod+Alt+G` change the whole pane. A project can name the agent that opens. Sessions keep running when you go back to the page, and a lead agent can start and steer helper sessions.

**Features.** `F-GROVE-01` to `F-GROVE-12`. The look, the competitor survey, the status rules, the default-agent rules, the orchestration tools and the chord table are in [PLAN.md § 4.12](./PLAN.md#412-grove-f-grove). If a label here and there ever diverges, PLAN wins.

**Depends on.** Stage 3 (`AgentService`, thread persistence, the fake ACP agent, and the transcript components in `panels/agent/`), Stage 5 (the per-session MCP server that carries the orchestration tools), Stage 6 (the design-mode confirm), Stage 9 (the attention reducer and store, agent groups and pinned threads, the Settings page, the onboarding wizard) and PR #58 (panel focus chords and the keybinding contexts).

**Out of scope.** Agent TUIs, SSH, a second daemon binary, best-of-N (Stage 11), a board, issue intake, scratchpads, todos, prompt templates. On `grove-multi-project-design`, Grove does keep processes after the last window closes (the Electron process stays up; quit asks) and can start a git worktree as its own project. Adding a project does not start its dev server.

### Instructions

1. Keybindings (`packages/shared/src/keybindings.ts`). Add `'grove'` to `KeybindingWhen` and `workspace?: 'browser' | 'grove'` to `KeybindingContext`; `bindingApplies` returns `context.workspace === 'grove'` for it, in the exhaustive `switch`. `match()` prefers a binding whose `when` is not `'always'` over an `'always'` binding on the same chord, so a Grove chord beats PR #58's panel focus inside Grove and does nothing outside it. Terminal passthrough still wins first. In `keybinding-editor.ts`, `scopesOverlap('grove', 'always')` is false: the Grove binding shadows the other only inside Grove, which is the point. Add `workspace` to `keybindingContextSchema` (default `'browser'`), push it from the renderer's `useKeybindingContextSync`, and keep it in `WindowManager.setKeybindingContext` so main's interceptor matches the same way. `closeProject` resets it.
2. Commands (`packages/shared/src/commands.ts`): the PLAN chord table. Workspace commands are category `View`; session commands are category `Grove`; all are `intercept: true`. `selectSession1`..`9` are `hidden`. Handle every id in the exhaustive `switch` in `apps/desktop/src/renderer/src/commands.ts`, and add the toggle to main's `FOCUS_APP_COMMANDS` so the chord works while the page has focus.
3. Settings and threads (`packages/shared`).
   - `layoutStateSchema`: `workspace` (`'browser' | 'grove'`, default `'browser'`) and `groveThreadId` (string or null, default null). The list sizes go in `layout.groups['arbora.grove']`.
   - `projectSettingsSchema`: `startDefaultOnOpen` (optional boolean; missing means on), nullable in the patch schema to clear it. No `PROJECT_SETTINGS_VERSION` bump.
   - `appSettingsSchema`: `grove: { orchestration: boolean (default true), maxChildren: 1–10 (default 4) }`, with a `patchSchema()` entry in `appSettingsPatchSchema` and a line in `applySettingsPatch`. `SETTINGS_VERSION` becomes 5 with a `4 → 5` migration that only advances the version.
   - `threadSummarySchema`: `archivedAt` (number or null, default null) and `parentThreadId` (string or null, default null). Export `DEFAULT_THREAD_TITLE`.
4. `packages/shared/src/grove.ts`, pure and unit-tested: `deriveSessionStatus(status, attention)`, the status labels, `shouldStartDefaultSession({ sessionCount, defaultAgentId, defaultAgentDetected, startDefaultOnOpen, alreadyTriedThisVisit })`, `displayNames`, `groveRows` (sections, creation order, helpers under their lead), `reduceActivity` and `activityFromEvents` (current tool call, plan progress, last message, turn start and length, per-file diff stats), `overlaps` and `formatElapsed`. Export them from the package index.
5. Main: `AgentService`.
   - `createThread(agentId, { model?, groupId?, parentThreadId?, title?, autoApproveEdits? })`.
   - `stopProcess(threadId)` ends the runtime in any state (status `idle`, shown as Stopped). `setArchived(threadId, archived)` stops it first and stamps `archivedAt`. A prompt to an archived thread throws.
   - `waitForSettled(threadIds, { until, timeoutMs, signal, turnOf })`, which re-checks on every state, event and permission change and never blocks the main process. `turnOf` (the lead) ends the wait once that thread's turn is over. A lead's helpers are the threads whose `parentThreadId` is the lead; there is no separate index.
   - IPC: `agent.createThread` takes `title`; add `agent.stopProcess` and `agent.archiveThread`.
6. Main: orchestration.
   - `packages/mcp-browser-server` gets `GroveToolHost` (an Electron-free interface, exported from `index.ts` and `host-entry.ts`) and `grove-tools.ts`, which registers `grove_list_agents`, `grove_start_agent`, `grove_send`, `grove_wait`, `grove_read` and `grove_stop` on each request's `McpServer` when the server was created with a `grove` host. `grove_wait` defaults to 45 s (at most 300 s). `BrowserMcpServer` keeps an `AbortController` per in-flight JSON-RPC id so a client's `notifications/cancelled` aborts the request it names.
   - `apps/desktop/src/main/mcp/grove-tool-host.ts` implements it over `AgentService` for one calling thread: the spawn permission once per session through `requestToolPermission` (not persistent), the helper cap from `settings.grove.maxChildren`, own-helpers-only checks, and transcript text without raw tool input.
   - `WindowManager.openBrowserTools` passes the host when `settings.grove.orchestration` is on and the thread has no `parentThreadId`. The preface and `.arbora/SKILL.md` describe the tools only when they are on.
   - The fake agent gets a `grove delegate` trigger: list the agents, start a helper with "say hello from the helper", wait for it, read it, and quote the helper's reply.
7. Renderer: state.
   - `grove-store.ts`: the workspace actions (`showWorkspace`, and the pending browser-layout action that runs once `setWorkspaceController` registers), the Grove selection (`groveThreadId`, persisted through `updateLayout`), the auto-start "already tried" flag, the launcher, and per-thread activity (`reduceActivity` over the same `agent.threadEvents` stream the attention store reads).
   - `agent-store.ts`: `loadThread` (fetch without selecting), `createThread` options (title, lead, where to open it), `stopProcess`, `archiveThread`, and the docked list's filter for archived threads.
   - `attention-store.ts`: `isThreadVisible` uses the Grove selection while Grove shows, and a helper's finished turn is marked seen without a cue.
8. Renderer: UI.
   - `components/WorkspaceSwitch.tsx`, mounted in `TitleBar.tsx` immediately left of the bell (`data-testid` `workspace-browser`, `workspace-grove`, `grove-activity`).
   - `App.tsx` renders the lazy `panels/grove/GroveWorkspace.tsx` instead of `Workspace` when `layout.workspace === 'grove'`. The browser layout is not rendered in that branch.
   - `panels/grove/`: the session list (header, split button, sections, rows, Recent, footer, rail), the session pane (header, tabs, the shared `ThreadView`, Changes), the empty state and the launcher. `ThreadView` takes an optional header so Grove can replace the docked one, and pins pending permission cards above the composer in both places.
   - Settings → Grove (`panels/settings/GroveSection.tsx`): the project's default agent, start when empty, orchestration, helpers per lead, and the Grove chords. Onboarding gets a Grove step after Task defaults.
   - Pulsing dots use `motion-safe:animate-pulse`.
9. Switching. Entering Grove exits agent mode. Design mode with changes raises the Stage 6 confirm with `pending: 'grove'` (Send, then Grove; Discard reverts, then Grove; Stay). Then persist `workspace` and run the auto-start predicate. Leaving resets the "already tried" flag, and a pending browser-layout action runs after `Workspace` mounts. Do not dispose terminal sessions or kill ptys, and do not cancel ACP sessions. `Mod+K` and `Mod+D` from Grove switch first, then enter the mode. Opening a file or a diff from Grove switches first. Reset Layout resets the visible workspace only.
10. Tests.
    - Unit: the keybinding precedence and `grove` context (a Grove chord does not match in the browser workspace; `mod+1` is panel focus there and row 1 in Grove; the editor does not flag `grove` against `always`), the `grove.ts` helpers, the settings migration and patches, `AgentService` (create options, stop, archive, wait, and a lead starting a helper through the real MCP server with `grove delegate`), and the Grove MCP tools against a fake host (own helpers only, the cap, the spawn permission, wait timeout and abort).
    - e2e `apps/desktop/e2e/grove.spec.ts` with the fake agent: the switch and `Mod+Alt+G` (also with the page focused) hide `workspace` and show `grove`; the URL is unchanged on return; `browser_screenshot` works while Grove shows; auto-start starts one session, once; `Mod+1`/`Mod+2` and `Mod+Alt+Down` select rows; a permission shows Needs you, the bell counts it, and `Mod+Alt+A` lands on it in the visible workspace; the launcher starts a titled session with its task; archive moves the row to Recent and the docked list hides it, and Restore brings it back; `grove delegate` starts a helper under its lead after one permission, the lead quotes the helper, and the helper's finish leaves the bell clear. Every spec deletes the threads it created.

### Gotchas

- **The `WebContentsView` paints above the renderer.** Hiding Grove's sibling with CSS leaves the page on top of the session list. Park it from main, through the same `setBounds(null)` path Settings uses (`setVisible(false)`, bounds kept). Do not set the bounds to zero: a zero-size view captures empty screenshots, and agents in Grove still verify with `browser_screenshot`. On the way back, the rect sync has to run when the browser panel mounts, or the page stays hidden until the next resize.
- **The content pane's + menu is drawn in the renderer and floats.** A native menu cannot take the app theme, the tab icons, or the shortcut labels. The `WebContentsView` paints above DOM, so opening the menu over a live page captures `browser.screenshot` (`viewport`) first, parks the view with `setBounds(null)`, and shows that PNG letterboxed in the viewport. The menu then floats over the toolbar and the still frame. `capturePage` on a hidden view is empty, so the shot has to happen before the park. The still image stays for two frames after close, while the live view comes back, so the page does not flash empty. Skip the capture when the page is empty, errored, or already hidden (palette, overlay, a Grove dialog, content hidden, agent-mode prompt). Do not pad the pane: padding pushes the URL bar down.
- **Ctrl+Alt+Left / Right die on a focused browser unless main sees `rawKeyDown`.** On Linux the page's `WebContentsView` often delivers modified arrows as `rawKeyDown` with `code: ArrowLeft` and an empty `key`. The interceptor has to accept that event (and map the arrow `code`), `preventDefault` it, and focus the app window before the command runs. Playwright's `keyboard.press` never hits this hook; e2e sends the chord with `webContents.sendInputEvent`.
- **A parked browser view swallows pane chords.** Hiding the view for an error or empty tab (`setBounds(null)`) does not drop keyboard focus, and a hidden view does not deliver `before-input-event`, so `Ctrl+Alt+Left`/`Right` and `Mod+1`..`9` die until something focuses the app window. Hide first, then if the view is focused focus the host and send `browser.focusParked`. The renderer puts DOM focus in the content pane unless the page is only parked for a menu or dialog (`browserViewAcceptsFocus`: a url and no error). An error or empty browser still counts as the content pane, so `Mod+1`..`9` match. `focusPage` only runs when that view is showing. The shell pane that has the keyboard (tree, chat, content, side column), including a live page, draws a 2px accent inset shadow. Do not use a real border: 2px on each side becomes the collapsed column's minimum width, so Hide and Maximize stop at 4px. A click on plain pane chrome focuses that pane on the next frame only when focus has not already moved, or it steals the command palette.
- **Hiding the content pane must park the page.** Collapsing the panel to zero width leaves a `WebContentsView` that paints over the chat and captures empty screenshots. `layout.contentHidden` (default false, so old settings files stay open) hides the view with `setBounds(null)` and collapses the side column with it. `Mod+Shift+H` and the show button bring both back. `layout.rightView` and `layout.rightPanels` keep their names.
- **`Mod+1`..`Mod+4` already belong to panel focus (PR #58).** The Grove row chords are `when: 'grove'`. `match()` used to return the first applicable binding in registration order, which is the panel-focus one, so the specific `when` must win over `always`. The shortcut editor would also report every row chord as a conflict unless `grove` and `always` count as separate scopes.
- **Do not spawn on every toggle.** The auto-start predicate is the whole rule. A visit that already tried, including a failed try, does not try again until the user leaves Grove or presses Retry.
- **Stale interceptor context.** If main still thinks the workspace is Grove after you switch back, `Mod+1` selects an invisible row instead of focusing the sidebar, and `Mod+Alt+N` is stolen from the page. Push the workspace before the next key.
- **Unmounting the terminal panel must not dispose sessions.** The data subscription lives in `initTerminalSessions`, which is once-only. A cleanup that disposes xterm instances will look like the dev server died. After Browser → Grove → Browser, a running `pnpm dev` is still printing, and the xterm shows the lines that arrived while Grove was up.
- **Omarchy's narrow column.** Grove does not use the browser layout's 764px minimum. Below 520px of content width, force the 44px rail and do not persist that width, or the next full-size launch opens with a collapsed list the user did not choose.
- **Title-bar drag.** The switch is `app-no-drag`. On Linux the header is the drag region; a drag that starts on the switch must not move the window, and a double-click on the header must still maximize.
- **Shared threads.** Archiving in Grove removes the docked panel's row too. Selecting in one workspace does not change the other workspace's selected thread. `Mod+K` keeps using the docked panel's thread.
- **Permission card.** Pin the unanswered request above the composer. A long transcript will hide it otherwise, and the row will say Needs you while the pane looks idle. Render it once: pinned while pending, back in the scrollback once answered, so tests and screen readers find one card.
- **The bell is the only count.** The Grove segment shows activity (something is working), not a second attention count. Pulsing status dots are the only animation, and reduced motion stops them.
- **A helper's finish is not the user's.** Its lead reads it through `grove_wait`, and a lead with four helpers would otherwise ring the bell, play the sound and post a notification four times for work the user did not start. `attention-store.ts` marks a helper's finish seen without a cue, so its row says Idle. Its permission requests, sign-in prompts and failures still count.
- **Notifications.** Electron `Notification` on Linux needs a notification daemon (Omarchy has one). If `isSupported()` is false, keep the badge and skip the OS notification without throwing. Never put env or tokens in the body; a permission title is fine, a raw tool input is not.
- **Orchestration must not fork-bomb or hang.** Helpers never get the Grove tools, and the cap counts running helpers per lead. `grove_wait` resolves on its timeout, on the lead's abort signal (a cancelled turn), and when a helper is archived or deleted; it must never leave a promise that waits forever. A helper's `session/request_permission` goes to the user like any other, never to the lead.
- **`grove_wait` must finish under the client's own timeout.** The MCP SDK client gives up on a request after 60 s, and so does Codex's MCP client by default. A 60 s wait returns just after the client stopped listening, and the lead sees a timeout error instead of "still working". The default is 45 s; the tool text tells the lead to call it again.
- **Cancels do not reach a stateless request.** The SDK client cancels with a `notifications/cancelled` POST that names the request id. In stateless mode that POST gets a fresh `McpServer`, which has never heard of the id, so the waiting handler never aborts. `BrowserMcpServer` keeps its own map of in-flight ids to `AbortController`s, and the Grove tools combine that signal with the request's own. Do not cancel by closing the transport: with `enableJsonResponse` it drops the response without writing it.
- **Not every agent drops its MCP call when its turn is cancelled.** The fake agent, for one, keeps awaiting the tool call after `session/cancel`. `waitForSettled`'s `turnOf` ends a lead's wait as soon as its turn is over, so Stop never waits on a helper.
- **The fake agent reads the whole prompt, preface included.** Its triggers are substring and word matches (`plan`, `slow`, `crash`, `stubborn`, `browser check`, `tool sweep`, `restart dev`, `list mcp servers`, `comment to`, `\bevaluate\b`, `\brun\b`, `grove delegate`), so preface or skill text that says "plan", "slowly" or "run" changes every e2e. `instructions.test.ts` checks the Grove preface against that list.
- **Parallel `grove_start_agent` calls.** Several calls can pass the cap check while one permission card is open. They share that card, the cap is checked again after it, and the host creates the helper thread before its first `await`, so the next call already counts it.
- **Focus counters replay on remount.** The browser layout unmounts while Grove shows, so the URL bar mounts again on every return with the store's `urlFocusRequest` still above zero. An effect that focuses whenever the counter is set takes the keyboard from the page or the terminal on each switch back. `UrlBar` keeps the last request it handled in module scope, so each request focuses it once. (The terminal's `focusRequest` is the opposite case: a lazy pane must consume the request when it mounts.)
- **The composer must not take focus from another text field.** A shown thread focuses its composer when it mounts, but Grove opens the rename box together with the session it renames. The composer focuses on mount only when the active element is not a text field (checkboxes and buttons do not count), or when a focus request names it.
- **A project's terminals and agents outlive the window that opened them when Grove still lists that folder.** They live on a `ProjectRuntime` keyed by path. Closing the window releases its hold and disposes the runtime only when Grove's project list does not name the path. Disposing the window's `AgentService` directly would kill a dev server another Grove window is still showing.
- **Close the launcher before starting the session.** `Dialog` hands focus back to the element that had it before it opened when it unmounts. Closed after the session starts, it takes focus away from the new session's composer. `GroveLauncher` closes, then starts.
- **The New agent task field takes arrow keys.** It stays unmounted until Enter, so ←→ can move between the agent and model lists. Ctrl+Enter (⌘↩ on macOS) starts with an empty task. Escape on the task returns to the lists; Escape on the lists closes.
- **Pin a permission only while its turn runs.** A request waits only inside a prompt turn. A thread that stopped or crashed with a card unanswered keeps that card in its scrollback, and pinning it would put a dead Allow above the composer. `ThreadView` pins while the thread is `prompting`.
- **`react-resizable-panels` v4 reads numbers as pixels.** `minSize={20}` is 20px; percentages need a string (`"24%"`, or `"24"` without a unit), and Grove's sizes are strings like the browser layout's. The `defaultLayout` map stays in percentages. A panel's `id` is also its `data-testid` unless one is passed.
- **The window's 640px minimum keeps Grove out of the rail.** Grove spans the whole window (the 44px activity rail belongs to the browser layout), so the 520px rail shows only when the window ends up narrower than its own minimum, which a tiling compositor can do. `grove.spec.ts` lowers `setMinimumSize` before it shrinks the window. It also drives the row chords through `webContents.sendInputEvent`, because Playwright's keys skip main's interceptor (Stage 0 gotchas).
- **Xvfb has no window manager, so the app window is not focused until `BrowserWindow.focus()`.** The bell clears a finished turn only for a thread that is on screen in a focused window (`windowState.focused`), so under Xvfb the badge stays at 1 after Allow unless the spec focuses the window first.
- **Adding a project does not start its dev server.** `dev` and `start` are command rows. `preview` begins with `pre` but it is a script people run, so the hook skip has to exempt the preferred names. A Procfile row stays even when its command matches a package script, because the labels differ (`web` next to `npm:dev`).
- **Closing the last window is not quitting.** Grove-listed processes keep the Electron process up, with a tray menu. Quit asks, then stops them and deletes `grove-processes.json`. `ARBORA_E2E=1` (set by `e2e/app.ts`) skips the tray and the confirm so Playwright can exit. A kill leaves the ledger; the next launch adopts a living pid or shows the row as gone.
- **Adding a project does not start its dev server.** `dev` and `start` are command rows. `preview` begins with `pre` but it is a script people run, so the hook skip has to exempt the preferred names. A Procfile row stays even when its command matches a package script, because the labels differ (`web` next to `npm:dev`).
- **Closing the last window is not quitting.** Grove-listed processes keep the Electron process up, with a tray menu. Quit asks, then stops them and deletes `grove-processes.json`. `ARBORA_E2E=1` (set by `e2e/app.ts`) skips the tray and the confirm so Playwright can exit. A kill leaves the ledger; the next launch adopts a living pid or shows the row as gone.
- **The first switch loads Grove's chunk.** The browser layout unmounts at once, so a `null` Suspense fallback showed an empty window for about 250 ms on the first switch of a run (seen in a screen recording; later switches are instant). `App.tsx` renders `GroveLoading`, Grove's two columns sized from the saved layout, from the main bundle. Do not prefetch the chunk at idle instead: `SessionPane` pulls in the transcript, which Stage 9 made lazy for the memory budget.
- **Arrow keys on the agent list are not chords.** They listen on the list while a row has focus, so a terminal, the composer, a text field and the page keep their arrows. The composer must not take focus from that list, or the next arrow lands in the transcript.
- **A long project name folds the title-bar mode pills and the Browser/Grove switch.** e2e windows use temp folder names, so `workspace-browser` and `mode-pill-agent` are often absent. Assert `workspace-switch`'s `data-workspace`, and switch with `Mod+Alt+G` when `data-collapsed` is true (`switchWorkspace` in `e2e/app.ts`).
- **A project row stays the Arbora tree until `grove.commands` stores a framework.** `FrameworkMark` already has a mark for each id; `frameworks[path] ?? 'arbora'` is the empty state. Detection (`detectProjectFramework`) reads `package.json` dependencies and devDependencies plus a Gemfile or `bin/rails` / `config/application.rb`. First match: Next, Nuxt, Vue, React, Rails, Vite (SvelteKit, Remix, Astro, Angular and Svelte keep their marks and do not outrank a more specific one above them). Next beats React, Nuxt beats Vue, and Vite only wins when nothing above matched. The page's "Framework:" line is a different detector (`browser-bridge` `detectFramework`) and does not feed the row.

- **One shell, one workspace value (unified shell, 4 Nov 2026).** The browser layout is gone: `layout.workspace` is always `grove`, so Grove's `when: 'grove'` chords, main's usage sampling and the interceptor context stay on. That makes Grove chords beat `always` ones everywhere. `Mod+1`..`Mod+4` (panel focus) are shadowed by Agent 1–4 for good, Archive lost its `Mod+W` (that closes the editor tab again), and `Alt+A` / `Alt+S` became `when: 'agentPanel'`, `intercept: false`, so the page and the editor still get those keys. The agent-panel context now means focus inside `panel-chat`; adding the tree would steal Shift+Tab from focus navigation there.
- **The selected project is the window's project.** Clicking a row under another project runs `project.open` with `onThisWindow` (main parks the old page and adopts the parked one, ~80 ms in e2e). `useGrove.focusPath` stays null. `setProject` keeps the window's panel sizes instead of loading the project's, or every switch makes the columns jump. A project opened from the CLI or the Projects page is added to `settings.grove.projects`, or it would vanish from the tree on the next switch.
- **Unsaved design edits block a project switch.** The parked page would keep them. `focusGroveProject` raises the design confirm with `pending: 'grove'` (copy: "before switching project") and returns false; Send or Discard runs the held switch (`resumeProjectSwitch`).
- **Four columns do not fit a tiled window.** The minimums (tree 170, chat 260, right 240, side 160 px) add up to more than Omarchy's ~700 px column, and `react-resizable-panels` then collapses the first collapsible panel (the tree). Below 1100 px the default layout starts with the side column closed, and every reveal or toggle collapses the tree, then the chat, when the target still has no room.
- **A terminal panel can mount before the terminal store resets.** A project whose saved right tab is Terminal mounts `TerminalPanel` in the same render as the project switch, and children's effects run before `App`'s reset, so the panel saw the previous project's empty list and started a shell in the new one. The store now records `loadedFor`, and auto-start waits until it matches the window's project.
- **Auto-start must not take the keyboard from a dialog.** The default agent starts in an empty project (now on every project open, not only on entering Grove). `selectSession` does not focus the composer while an overlay or the palette is open; before that, typing into the project switcher went into the new agent's composer.
- **`pnpm build:test` rewrites the `out/` a checkout launch runs from.** A window that was already open keeps its old `index.html`, so the next lazy chunk it asks for (Settings, the editor) no longer exists and the import fails with "Failed to fetch dynamically imported module". Retrying the import fails the same way; the error boundary now offers **Reload window** for that case. Restart a running checkout instance after building, and do not build e2e into it while it is in use.
- **Focus moves out of the page need main's help.** With the native page focused, DOM `focus()` in the app does nothing, and `document.hasFocus()` can still be true, so the renderer cannot tell where the keyboard is. Main focuses the app's webContents first for the panel-focus commands (`FOCUS_APP_COMMANDS`) and sends `command.invoke` with `fromPage: true`; `focusNeighbour` then starts from the right column.
- **One window.** `WindowManager.openProject` switches the window that already shows the folder, else the caller's, else the focused or first window, in place (`openOnThisWindow`), and creates a window only when there is none. That covers the project switcher, the Projects page, Open Folder, a second `arbora /path` launch and the dock. A main process started before `onThisWindow` existed (11:29, 4 Nov) ignores the flag and opens a window per project, so restart a long-running dev instance after pulling.
- **Grove's own dialogs must hide the page too.** Search, the launcher and the project switcher keep their open flag in `useGrove`, not `useApp.overlay`, so the native view painted over them once the page sat beside the tree. `BrowserPanel` hides the view while any of them is open. `Super+K` and `Super+Shift+K` cannot be offered as defaults: Omarchy binds them (Keybindings, Kimi) before Arbora sees the key; `Ctrl+K` and `Ctrl+Shift+K` are the Linux chords.
- **Leaving design mode focuses the page.** A terminal created right after cannot take focus until the user clicks the chrome; e2e helpers click `panel-chat` (`focusChrome`) before chords.
### Acceptance

- With a project open, the title-bar control and `Mod+Alt+G` swap the whole content area. The page URL is unchanged on return. A dev server that was running in the terminal is still running, and its output from the Grove visit is on screen.
- `Mod+Alt+G` swaps while the embedded page or a terminal is focused. In the browser workspace `Mod+1`..`Mod+4` still focus panels; in Grove `Mod+1`..`Mod+9` select rows.
- Setting the default agent and entering an empty Grove starts one session of that agent. Toggling away and back does not start another. With the checkbox off, Grove opens on "Start {name}" and does not spawn.
- A fake-agent permission turns the row to Needs you, increments the bell in either workspace, and **Show Agent That Needs You** lands on that session in the workspace that is showing. Approving clears it.
- The launcher starts a session titled with its task and sends the task.
- A lead agent asked to delegate starts a helper after one permission, the helper shows under it, and the lead reports the helper's answer. The helper's finish does not ring the bell.
- `Mod+K` from Grove opens the browser workspace in agent mode. Design mode with unsaved changes asks before leaving, and Stay leaves the user on the page.
- On a ~687px-wide Omarchy column the session list (at its 180px minimum) and the transcript both fit and stay usable. Under 520px of content the list becomes the 44px rail, and widening or floating the window restores the saved width.
- Appendix B has a Grove row filled for each agent that was actually run.

### Checklist

- [x] Plan revised with the survey of multi-agent managers; chord conflicts with PR #58 resolved; orchestration moved in from Stage 11 (PLAN § 4.12, ADR 0004, 4 Nov 2026)
- [x] `KeybindingWhen` `'grove'`, precedence over `always`, workspace on the interceptor context, editor overlap rule, chord tests
- [x] Commands registered and handled in the exhaustive command switch
- [x] Settings v5 (`grove`), layout `workspace` and `groveThreadId`, `startDefaultOnOpen`, thread `archivedAt` and `parentThreadId`
- [x] `packages/shared/src/grove.ts` helpers with unit tests
- [x] `AgentService`: create options, stop process, archive and restore, wait (with `turnOf`); IPC
- [x] Orchestration MCP tools (`grove_*`), the main host, the spawn permission and the cap, fake-agent `grove delegate`
- [x] Title-bar switch with the activity dot; labels hide under 640px; hidden with no project
- [x] Grove layout: list, split button, sections and helpers, rows with activity, timers, diff stats and the overlap warning; pane with tabs, pinned permission and composer; narrow rail
- [x] Task-first launcher
- [x] Attention: workspace-aware visibility, bell, notification click and show-attention
- [x] Default agent, auto-start rules, empty state copy
- [x] Archive, Recent and Restore; the docked list hides archived threads
- [x] Mode and design-edit handling on the way in and out; browser-layout commands switch first
- [x] Settings → Grove section and onboarding step
- [x] e2e `grove.spec.ts` with the fake agent
- [ ] Appendix B Grove row for real agents, and `arch-ok` on Omarchy/Hyprland

---

## Stage 11: Stretch

**Goal.** Improvements that are valuable but not required for the core workflow. Pick in order of user demand.

### Items

1. **`@arbora/dev-plugin`** (tier 1 source mapping): Vite plugin, Next/webpack loader and Nuxt module that add `data-arbora-src="path:line:col"` to JSX/Vue template elements in development (same approach as `code-inspector-plugin`). Arbora detects the attribute and reports exact locations regardless of React version. Offer "Install dev plugin" from the inspector when tier 3 is in use.
   - Gotcha: attributes on fragments and custom components do not reach the DOM; only host elements get them, so the chain still comes from fibers.
   - Gotcha: the package is not published. Install copies it to `.arbora/dev-plugin` and adds `"@arbora/dev-plugin": "file:.arbora/dev-plugin"`. `.arbora/.gitignore` is `*`, so the install appends `!dev-plugin/` or the copy never reaches git. Restart the dev server after install; a page that was already open stays tier 3 until then.
   - Gotcha: the JSX transform must ignore TypeScript generics (`useState<string>`) and comparisons (`a < b && c`). It only tags known HTML and SVG host names. Inserting before `/>` has to swallow the space already there, or the attribute is indented twice and the slash sticks to the value.
2. **Multiple browser tabs**: moved to Stage 12 (`F-TABS`), which also covers cross-tab prompts and passwords.
3. **Parallel agent sessions with git worktrees** ("Worktree sessions"): the launcher starts one or more agents, each in a sibling worktree. The worktree's dev command is pinned to the next free port (package scripts get ` -- --port`), the browser opens that URL, and the project row can merge the branch into the parent or open a pull request. Best-of-N runs the same task on up to four agents; each row can keep one (merge it and discard the rest) or discard itself.
   - Gotcha: `node_modules` is not copied. When the parent has one, the worktree links it (a symlink, or a junction on Windows). "Install a separate copy" unlinks that path only and runs the package manager; it does not delete the parent's directory. A worktree with no link offers "Install dependencies". The port comes from the parent's dev URL when that URL has one, otherwise the search starts at 5174.
4. **Design-mode direct write-through**: for tier 1 targets in Tailwind projects, apply class edits directly to the source file and skip the agent round trip; keep a one-click "Ask agent instead".
   - Gotcha: write-through runs only when every applied change is a style with a Tailwind class and a file and line on the edited element (the host fiber's `_debugSource`, not the component's call site). A text or structure change keeps the agent button. A directional utility (`pt-10`) is added beside a shorthand (`p-6`); the shorthand is replaced only when the edit is that shorthand. `className={clsx(...)}` is refused. The live inline style is reverted after the file is written, so the dev server's reload shows the class.
5. **Design session history**: list, compare, resend, export as Markdown.
   - Gotcha: Compare reads the before and after screenshots only when they are inside the project. The Markdown export names those paths; it does not embed the image bytes. A session id that is not a UUID is refused, so a crafted id cannot read another file.
6. **Agent action traces**: record MCP browser actions as a Playwright-like trace (screenshots per step) viewable in the thread.
   - Gotcha: record the step in the MCP tool wrapper, not from the ACP tool-call title. OpenCode reports these calls as `execute`, and a second card would duplicate the one the agent already sends (Stage 5). The thumbnail is a viewport JPEG taken after the tool returns. Snapshot, console, network and element-source reads are not steps. Saving a thread keeps images on the last four steps only.
7. **LSP opt-in**: `@codemirror/lsp-client` + `typescript-language-server` spawned per project; hover, go-to-definition, completions.
   - Gotcha: the language server must be the project's TypeScript version; resolve `node_modules/typescript` first. The binary is the project's `typescript-language-server` (`lib/cli.mjs`), spawned with Electron as Node. Main adds the Content-Length framing; the renderer only sends JSON. The renderer must not call `lsp.stop` and then `lsp.start`: the stop can kill the process that `start` just spawned. Turning the setting off stops it. Switching projects lets `lsp.start` replace the process.
   - Gotcha: CodeMirror requests a hover only when the pointer is within about one character of a glyph. A hover on the empty part of the line does nothing.
8. **Agent-mode on production builds**: heuristics to map minified components via source maps when available (`//# sourceMappingURL`), using CDP `Debugger.getScriptSource`.
   - Gotcha: a production `.js` bundle stack keeps its line and column. A `.tsx` or `.vue` frame still drops them, because those numbers belong to transformed code.
   - Gotcha: mapping reads the script with `Debugger.getScriptSource`, then the `sourceMappingURL`. The map is fetched only from the script's own host, or decoded from a `data:` URL. `Debugger.enable` runs the first time a bundle needs a map. A mapped file outside the project is still dropped.
9. **Grove orchestration**: moved to Stage 10 (`F-GROVE-12`) on 4 Nov 2026. The `grove_*` tools ride on the browser MCP server every session already has.

### Checklist

- [x] Dev plugin (Vite, webpack/Next, Nuxt) and inspector integration
- [x] Browser tabs (moved to Stage 12)
- [x] Worktree sessions
- [x] Tailwind write-through
- [x] Design session history
- [x] Action traces
- [x] LSP opt-in
- [x] Source-map assisted mapping
- [x] Grove orchestration MCP tools (moved to Stage 10)

---

## Stage 12: Tabs, cross-tab agent work and passwords

**Goal.** Make Arbora's browser one you can work in all day, and let an agent work across tabs:

- Several tabs per project.
- Logins filled and saved through 1Password.
- Prompts sent from any tab to any open project.
- An agent that reads a design in one tab (Figma), implements it in the app tab's project, screenshots the result and iterates until the two match.

**Features.** `F-TABS-01` to `F-TABS-07`, `F-XTAB-01` to `F-XTAB-07`, `F-VAULT-01` to `F-VAULT-06` ([PLAN § 4.13–4.15](./PLAN.md#413-browser-tabs-f-tabs)), ADR 0005 and ADR 0006.

**Depends on.**
- Stage 1: `BrowserService`, partitions, extensions.
- Stage 4: the inspector and composer, reused per tab.
- Stage 5: the MCP server; every tool already takes an optional `target`.
- Stage 9: the settings UI and onboarding entry points. Until it lands, use `settings.json` and a palette command.
- Grove, if present, simply shows cross-tab threads like any other.

**Sub-parts, landed separately, in order.** 12a tabs (`F-TABS`), 12b cross-tab agent work (`F-XTAB`), 12c passwords (`F-VAULT`). Each sub-part is its own pull request (see [AGENTS.md](../AGENTS.md#shipping)). 12c can start in parallel with 12b once the spike is done, because it only needs tabs and partitions from 12a.

**Out of scope.**
- Password sync or storage inside Arbora.
- Providers other than 1Password: the interface only, no implementation. Bitwarden as a browser extension the user installs for themselves is Stage 14. It is not a second `PasswordProvider`, and agents do not log in through it.
- Figma API tokens stored by Arbora.
- Design-to-code without an agent.
- Reading Chrome profile data.
- Cross-origin iframes inside a design tool.
- Sharing tabs between machines.

### Instructions

0. **Spike: 1Password in Electron (half a day, before 12c).** Load the pinned 1Password extension into a test partition with `session.extensions.loadExtension`, then record:
   - whether its MV3 service worker starts;
   - whether the inline menu appears on a login form;
   - whether "Save login?" fires;
   - whether it can reach the desktop app.

   Electron implements only part of `chrome.*`. In particular, native messaging (`chrome.runtime.connectNative`), which 1Password uses to unlock through the desktop app, is believed to be missing as of Electron 45; confirm it. Also try the extension's standalone sign-in. Write the results into this section's Gotchas, and pick the default `passwords.mode`: `extension` if fill and save work, else `cli`.
1. **Tabs model (12a).**
   - `BrowserService` becomes `BrowserTab`, one per `WebContentsView`. A new `BrowserTabs` service per window owns the list, the active tab, the app-tab id and the LRU discard. It moves the view-rect sync to whichever tab is active and parks hidden tabs with `setVisible(false)` and their bounds kept, the rule Grove's parking follows (`BrowserService.setBounds(null)`; a zero-size view captures empty screenshots, Stage 10 gotchas).
   - Problems buffers, screenshots, CDP, emulation and the inspector stay per tab.
   - Persist `{ id, role, url, title, zoom, preset }[]` and `activeTabId` in the machine-local project state.
   - Channels gain an optional `tabId`, defaulting to the active tab, and events carry `tabId`.
   - New channels: `browser.tabs.list`, `browser.tabs.open`, `browser.tabs.close`, `browser.tabs.activate`, `browser.tabs.move`, `browser.tabs.setRole`; event `browser.tabsChanged`.
2. **Tab strip UI (12a).** Use `panels/browser/TabStrip.tsx`.
   - Show favicon, title, a role icon (app or reference), a loading spinner, close on hover, and middle-click to close.
   - Support drag to reorder and overflow scrolling. The strip collapses to icons below 400 px of panel width, using the same container queries as the toolbar.
   - The context menu (native, `contextMenu.show`) offers: Make app tab, Duplicate, Use project session, Discard, Close others, and Send tab to agent.
   - Register the commands from `F-TABS-01` in `commands.ts` with `intercept: true`. Handle them in the exhaustive switch.
3. **Partitions and popups (12a).**
   - Create `persist:arbora-web` in `BrowserSessions` with the same certificate rule and extensions as project partitions.
   - `setWindowOpenHandler`: http(s) without `opener` becomes a new reference tab. Requests whose features need `opener` (OAuth) are allowed as a child `BrowserWindow` with the same partition, `contextIsolation`, `sandbox`, no preload and a deny-all `setWindowOpenHandler` of its own, closed when the opener tab closes.
4. **MCP targets (12a).**
   - Resolve `target` in main: a tab id, `"app"` or `"active"`.
   - Add `browser_tabs`, `browser_tab_open` and `browser_tab_close`.
   - Tools on hidden tabs must not activate them. Capture with CDP `Page.captureScreenshot` after `webContents.setBackgroundThrottling(false)` for the duration of the call, because `capturePage()` on a parked view is empty (Stage 4 gotcha).
5. **Cross-project routing (12b).**
   - `agentMode.submit`'s target gains `projectPath`. When it is not this window's project, main hands the composed prompt to that project's window (`WindowManager.findByProject`) and its `AgentService`.
   - If the project is not open, offer "Open project and send". It opens the window, then sends.
   - Selections from a reference tab carry `tabId`, and their sources resolve against the target project (they usually stay tier 3, and that is fine).
6. **Send tab to agent (12b).** Add the `agentMode.sendTab` channel and a popover variant without an element. Blocks:
   - a text body naming the tab id, role, URL, title and the target project's app tab id;
   - a viewport `image` (or a file link);
   - an optional full-page image, behind a toggle;
   - selected text;
   - an accessibility summary capped at 4 KB.
7. **Grants (12b).**
   - `AgentModeService` records `{ threadId, tabId }` grants on send. Add `agent.listGrants` and `agent.revokeGrant`, and an `agent.grantsChanged` event.
   - The MCP server checks the grant list on every call that resolves `target` to a reference tab. Write-type tools (`browser_type`, `browser_select_option`, form submit) on a granted reference tab need a one-time allow.
   - Show grant chips in the thread header (`panels/agent/`) with revoke.
8. **`browser_compare` (12b).**
   - Pure image code in `packages/mcp-browser-server/src/compare.ts`: scale both captures to the same CSS width, compute SSIM on luminance in 8×8 windows plus a color-histogram distance, pick the top-k differing cells of a 12×12 grid, and render `side_by_side`, `overlay` (50 %) or `diff` (heatmap).
   - Unit-test it with synthetic bitmaps: identical images score 1.0, a shifted box drops the score, and the worst cell is the changed one.
   - Return one image of at most 1568 px plus JSON.
9. **Design-match loop (12b).**
   - Extend the instruction block and `.arbora/SKILL.md` with the `F-XTAB-04` loop, the threshold and round defaults (project settings `designMatch.threshold`, `designMatch.maxRounds`), and the Figma notes from `F-XTAB-06`.
   - Add `mcp.extraServers` to `projectSettingsSchema`: entries with the ACP `mcpServers` shape. Pass them through in `session/new` unchanged. The Figma MCP server is configured there by the user; never ship tokens.
   - Render the "Matching design" card from `browser_compare` tool calls in the transcript: round, images and score history, with Stop.
10. **Setup script (12c).**
    - Write `scripts/setup-1password.sh` (POSIX sh plus bash where needed) and `scripts/setup-1password.ps1` following `F-VAULT-01`, with `--check`, `--yes` and `--uninstall`. Shellcheck clean.
    - The extension fetch reuses `fetch-devtools-extensions.mjs` (add an `--only 1password` flag) with a pinned version and SHA-256.
    - Add `pnpm setup:1password`. Document in the README.
    - On Linux, writing `/etc/1password/custom_allowed_browsers` asks first and uses `sudo tee -a` only if the line is missing. For packaged builds the executable name is `arbora`; for `pnpm dev` it is `electron`, so print a note that dev builds need that line too.
11. **Password provider (12c).**
    - `apps/desktop/src/main/passwords/`: `PasswordProvider` interface and `OnePasswordProvider`.
    - Extension mode: load the extension and render its popup in an anchored `WebContentsView`.
    - CLI mode: `op` via `execFile` with the login-shell PATH, JSON output, secrets passed through stdin, a 30 s timeout, and no secret ever logged. Treat stderr as redactable too.
    - Fill uses CDP `Input.insertText` after focusing the field, through the isolated world, so the page sees real input events.
    - Detect login-form submits in the browser preload (a `submit` event or a navigation after a password field was filled) and send `passwords.offerSave` over the page channel. Send the origin and the field names only; the values are read in main via CDP at save time.
12. **Agent logins (12c).**
    - Add `browser_login` to the MCP server, with a permission card listing item titles only.
    - Add a redaction pass: `browser_snapshot` replaces `value` on `input[type=password]` and on fields 1Password marked; `browser_evaluate` results are scanned for strings filled in this session and masked; the ACP log masks them too.
    - Settings from `F-VAULT-06`, with a migration if `SETTINGS_VERSION` changes.
13. **Tests.**
    - Unit: the tabs model (LRU discard, app-tab invariants, persistence), `target` resolution and grants, `browser_compare`, `op` argument building (no secrets in argv), the redaction pass, and the setup script's `--check` on a fake `PATH`.
    - e2e:
      - Open three tabs; close and reopen; `Mod+T`/`Mod+W` with the page focused; the app tab can't be closed.
      - A fake ACP agent calls `browser_tabs` and is refused an ungranted reference tab, then is granted after "Send tab to agent".
      - `browser_compare` between `fixtures/vite-react` and a reference fixture page (`fixtures/design-reference/`, a static HTML "design" of the counter card) returns a score below the threshold, then above after the fake agent applies a scripted edit.
      - Cross-project send between two open windows.
      - A login fixture (`fixtures/login/`) where a fake `op` on `PATH` fills the form and a fake agent's `browser_login` returns `logged_in` without the password appearing in the transcript, tool result or ACP log.
    - Manual: the Figma flow with OpenCode on a free model first, then one run each with Kimi and Grok. Record it in Appendix B.

### Gotchas

- **Electron extension support is partial.** MV3 service workers load, but toolbar actions, popups, `chrome.identity`, and native messaging are not provided. Electron 45's type definitions have no `chrome.runtime.connectNative`, so the 1Password desktop-app unlock cannot work. `passwords.mode: auto` uses the `op` CLI (`resolvedPasswordMode`). The extension can still load for anything that does not need the desktop app. Pin the extension version. A new 1Password release can break Electron compatibility without notice.
- **PNG CRCs do not fit in a signed 32-bit write.** `zlib.crc32` can return a value above `2^31 - 1`. Write it with `writeUInt32BE`. `writeInt32BE` throws and `browser_compare` then fails on every image.
- **1Password only talks to browsers it trusts.** On Linux, the desktop app checks the browser's executable name against its own list plus `/etc/1password/custom_allowed_browsers`. A dev build runs as `electron`, a packaged build as `arbora`, so the line must match the build in use. Never edit that file without the user's consent; it needs root.
- **Never put secrets in argv.** `op item create` with `password=...` on the command line is visible in `ps` and shell history. Use the JSON template on stdin. `op item get --reveal` output is secret: never log it, never send it over IPC to the renderer, and type it into the page from main. A screenshot paints over a password or one-time-code field that has a value, so the glyphs are not in the tool image, the trace thumbnail, or a compare round. Empty fields are left alone.
- **A hidden tab cannot be screenshotted in place.** `capturePage()` on a view that was never shown, or one parked off-screen, returns an empty image. CDP `Page.captureScreenshot` on that same hidden view hangs. Give the view the panel's real rectangle, insert it at the back of the window (`addChildView` index 0) so the visible tab covers it, show it for a moment, then `capturePage()`. Hide it again afterwards and return focus to the window. Viewport and element screenshots take that same path (`withPaintedView`); they do not call `Page.captureScreenshot`. A full-page shot shows the parked tab the same way first, then uses CDP, and times out instead of hanging. `nativeImage.toPNG()` is 8-bit RGB (PNG color type 2). A compare decoder that accepts only RGBA rejects every Electron screenshot.
- **A parked tab ignores `Input.insertText` and synthesized Enter.** Fill focuses with `DOM.focus` and types with `Input.insertText`, then reads the field back. When the value did not change, or the view is parked, main sets that selector in the page. Typing into a parked view can land in whichever field last had focus (the password), so a one-time code must not go through `Input.insertText` there. Submit is only `requestSubmit`. Sending Enter as well runs the listener twice: the first pass can reveal a code field and the second pass rejects it while it is still empty. `requestSubmit` does not fire when the form is invalid, so a login fixture's email has to be a real email address.
- **A save offer sends field names, not CSS selectors.** `querySelector("pass")` does not find `<input name="pass">`. Main looks the name up, and only after the user clicks Save. The offer is withheld unless 1Password is the provider. The password stays in main; the toast names the host.
- **Do not message a tab before its page is ready.** `webContents.send` while the view is still starting makes that page the first window Playwright attaches to, so a restore launch never sees the app shell. The login-field key is sent again when the page reports ready.
- **`browser.tabsChanged` can fire before the renderer is listening.** Opening a project loads the tab list with `browser.tabs.list` as well. An empty reply must not wipe a list that an event already delivered.
- **Figma is a canvas.** `browser_snapshot` on Figma returns its toolbar and layer panel, not the design. Teach the agent to screenshot frames and read Dev Mode values. Figma's keyboard shortcuts also fight injected keys; prefer clicks and the `node-id` URL to navigate. A Figma tab is heavy (WebGL, hundreds of MB), so the LRU cap must never discard the app tab or a tab granted to a running loop.
- **Comparing different renderers.** Fonts, anti-aliasing and DPR differ between Figma's canvas and the app's DOM. Compare at the same CSS width and DPR, blur slightly before SSIM, and keep the threshold below 1 (0.92 default). A perfect score is not the goal; the remaining-differences list is. `browser_compare` can take `{ target, rect }` or `{ target, selector }` so a frame is scored instead of the browser chrome around it.
- **OAuth popups need `window.opener`.** Turning every `window.open` into a tab breaks "Sign in with Google" in Figma and GitHub. Popups with `opener` stay child windows of the tab's partition.
- **Shared reference partition.** Logging in once for every project is the point, but a project's dev server on `localhost` must not share cookies with reference tabs. The app tab keeps the project partition, and "Use project session" is an explicit per-tab switch. The end-to-end test sets a cookie on the app tab: the reference tab does not see it until that switch, and switching back drops it.
- **Chord collisions.** `Mod+W` closes the window in many apps, and Electron's default macOS menu binds it. Rebind the menu item to close the tab, and keep Close Window on `Mod+Shift+W`. `Ctrl+Tab` is a plain `Ctrl` chord, so it passes through to a focused terminal.
- **Another project's thread list is that project's.** The agent-mode picker loads it when the project changes. The default is the thread used last, or a new thread with that project's default agent. Open windows are listed before recent projects. A thread from this window is not a target for the other project.
- **Cross-window sends.** The target project's window may be on another workspace (Hyprland) or minimized. Do not steal focus on send; focus only when the user clicks "Open thread". That button focuses the window that already has the project and shows the thread there. Stay here leaves this window where it is. Showing the new thread on the sending window calls `project.open` for that project, which moves the project onto this window and disposes the runtime the prompt was just handed to. Leave the thread on the window that already has the project.
- **A tool result names its tab.** `Tab: <id> (app|reference)` is the first line. A compare result keeps its JSON and names both tabs inside it. A result that is already JSON is not given a text header, so the score still parses.
- **Send from a tab's menu sends that tab.** The strip button and `Mod+Shift+K` send the active tab. The menu item sends the tab that was clicked, so a background Figma tab is the one that gets granted. The end-to-end test chooses that item on the menu the app just opened. That handle exists only when `ARBORA_E2E` is set.
- **The app tab keeps its page title.** The role icon says which tab is the app. Replacing the title with the word App hides which page that tab is showing. Below 400px the title hides and the icon stays.
- **A blank tab does not receive `Mod+W`.** A new tab with no page hides its `WebContentsView`, so `before-input-event` never fires. Close and reopen chords have to be delivered while a page is loaded.
- **Problems follow the tab, and the default is the app tab.** A reference tab's console used to replace the only buffer as soon as that tab was active. Each tab keeps its own buffer. The Problems view and the badge stay on the app tab until the tab menu in Problems picks another one.
- **Grove hides the thread header.** `SessionPane` passes `showHeader={false}`, so grant chips rendered only inside the header never appear. Render them when the header is hidden too. The chip shows that tab's favicon next to its title.
- **Windows setup fetches the extension too.** `setup-1password.ps1` runs `fetch-devtools-extensions.mjs --only 1password` when `node` is on `PATH`, the same step as the shell script. `--check` still does not download.
- **Debian and Fedora commands are printed, not run.** The script quotes 1Password's apt and rpm steps, including the debsig policy, and then prints the pass/fail table. It does not call sudo. Arch still names `yay` or `paru` and does not build the packages when those helpers are missing.
- **An inline Zustand selector that returns a new array loops.** `useSyncExternalStore` treats a new snapshot as a change. Filtering `library.entries` inside the selector re-renders until React throws error 185 and the project pane shows its error boundary. Select the stable library, then filter outside the selector.
- **Playwright's Electron driver deadlocks if `page.evaluate` opens a `BrowserWindow`.** The new target is handled on the CDP session that is waiting for the invoke to return. Defer the open with `setTimeout`, and count windows with `BrowserWindow.getAllWindows()` inside `app.evaluate`. `app.windows()` waits to attach to the new page and can hang the same way. Run these tests from `apps/desktop`; the repo-root Playwright config does not set `workers: 1`, and two workers share `fixtures/vite-react`.
- **Run setup opens a terminal.** Settings → Passwords and the onboarding wizard start `scripts/setup-1password.sh --yes` in a terminal when the checkout is present. The app does not call sudo. With no terminal, or under `ARBORA_E2E`, the button shows the command instead.
- **The Matching design card shows the round and the latest side-by-side.** Score history stays in the header. The picture is the last `side_by_side` compare, so a later diff does not replace the two frames. The round number is the one in the saved file name.
- **A compare round is a file, not only a thumbnail.** `browser_compare` writes `.arbora/screenshots/<thread>/round-N.png` and the action-trace step uses that PNG. A fresh viewport shot would show the active tab, not the side-by-side. The folder's `.gitignore` ignores `*`, the same as other screenshots. A thread id is reduced to `[A-Za-z0-9_-]`; an empty result skips the file and the compare still returns.
- **Send tab names the app tab and can attach a full page.** The viewport shot always goes. The tab-strip Send button (and `Mod+Shift+K`) offers a full-page shot as well. The prompt names the app tab id, the project's stop score, and a short accessibility tree.
- **Always on a login remembers the site, not every navigation.** Off-origin navigation stays a one-time card. `browser_login` asks with Always, and that choice appends the origin to `passwords.alwaysAllow`. Settings lists those origins; Remove asks the next time. The design loop in `.arbora/SKILL.md` stays under 400 words: screenshot the frame, open a `node-id`, read Dev Mode text from the page, match the width, compare, and stop at the project's `designMatch` score and round cap (0.92 and 5 when unset). `browser_compare` repeats that stop rule in its JSON. A hidden tab is throttled until it is shown or captured.
- **An agent tab belongs to the session.** `browser_tab_open` records the thread. Stop, archive, restart, and the process exiting close those tabs. A pinned tab stays, and so does a tab the user opened. Deleting the thread still drops every grant.
- **`--check` is a table, not an install.** It reports the OS, `op`, whether an account is signed in (no email), whether the desktop app is running, and whether the pinned extension is on disk. It does not use sudo. Exit status follows `op` only. On Linux, the install path names the family (Arch, Debian, Fedora) and does not install packages unless someone confirms in a terminal. It fetches the pinned 1Password extension with `node` when that is on `PATH`.

### Acceptance

- Three tabs (app, docs and a Figma file) survive a restart. Only the active one loads at startup. The app tab cannot be closed, and `Mod+K` defaults to it.
- From the Figma tab, "Send tab to agent" → "implement this design" → project `fixtures/vite-react` starts a thread with that tab granted. The agent screenshots the frame, edits the fixture, compares the two tabs at least twice, and finishes with a side-by-side image and a score at or above the threshold, or an honest list of what still differs.
- An ungranted reference tab is refused to the agent with "tab not granted". Revoking a grant mid-loop stops further access.
- `pnpm setup:1password --check` reports correctly on Omarchy, Debian, macOS and Windows. A full run installs 1Password and `op`, registers Arbora, and the browser fills a login on the login fixture and on one real site.
- Saving a new login from a form creates a 1Password item, and no secret appears in `ps`, logs or the transcript.
- `browser_login` with a fake agent logs in to the login fixture after one approval. The password never appears in the tool result, the transcript, the ACP log or a snapshot.

### Checklist

- [x] Spike: 1Password extension in Electron, results recorded, default mode chosen
- [x] `BrowserTabs` service, tab persistence, LRU discard, parked hidden tabs
- [x] Tab strip UI, chords, context menu, roles
- [x] Shared `persist:arbora-web` partition, OAuth popups as child windows
- [x] MCP `target` resolution, `browser_tabs` / `browser_tab_open` / `browser_tab_close`, hidden-tab capture
- [x] Cross-project routing and "Open project and send"
- [x] Send tab to agent, grants with chips and revoke
- [x] `browser_compare` with unit tests
- [x] Design-match loop instructions, `mcp.extraServers`, "Matching design" card (round, side-by-side, score history, and saved compare images)
- [x] `scripts/setup-1password.sh` / `.ps1` with `--check`, `--yes`, `--uninstall`; `pnpm setup:1password`
- [x] `PasswordProvider` and CLI fill, save, and OTP. Extension mode is unavailable: Electron 45 has no `connectNative`
- [x] `browser_login` with permission card and redaction pass
- [x] Fixtures `design-reference` and `login`, unit and e2e tests
- [ ] Manual matrix (Figma flow, agent login) and `arch-ok` on Omarchy/Hyprland

---

## Stage 13: Themes

**Goal.** Let people recolour Arbora with a `theme.json` that sets the colour variables the app already uses. Light, dark and system stay as they are. This stage only changes colours.

**Features.** `F-THEME-01` to `F-THEME-03` ([PLAN § 4.16](./PLAN.md#416-themes-f-theme)).

**Depends on.** The CSS variables in `apps/desktop/src/renderer/src/styles.css`, `theme-service.ts` (light/dark/system), and the Theme control on the Settings page. It does not depend on Stages 8–12. If Stage 10 has landed, `--attention` and `--attention-soft` are optional keys too.

**Out of scope.** Fonts, icons, layout, per-project themes, a theme gallery, and restyling the embedded page. The page keeps its own CSS.

### Instructions

1. `packages/shared/src/theme-file.ts` parses a theme file. Shape:

   ```json
   {
     "name": "Moss",
     "colors": {
       "light": { "bg": "#f4f7f5", "accent": "#2f7d5b" },
       "dark": { "bg": "#0b0d10", "accent": "#4fb385" }
     }
   }
   ```

   `name` is a short label. `colors.light` and `colors.dark` are partial maps. A key is one of the custom properties already declared in `styles.css`, without the leading `--`: the chrome set (`bg`, `bg-subtle`, `bg-muted`, `bg-elevated`, `fg`, `fg-muted`, `fg-subtle`, `border`, `accent`, `accent-fg`, `accent-soft`, `danger`, `ring`) and the editor set (`syn-keyword`, `syn-string`, `syn-number`, `syn-comment`, `syn-function`, `syn-type`, `syn-tag`, `syn-property`, `syn-selection`, `syn-selection-match`, `syn-active-line`, `syn-search`, `syn-search-outline`, `syn-diff-line`, `syn-diff-deleted`, `syn-diff-word`). A value is hex only: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. Unknown keys and bad values are dropped with a warning, the same way invalid settings are. Missing keys keep the built-in colour for that scheme. Export the key list so the parser and the tests share it.
2. Built-in colours stay in `styles.css`. They are the `arbora` theme and the fallback under every override. User themes are copies under `userData/themes/<id>.json`. `id` is the file stem, `[a-z0-9-]+`. Import copies a chosen file into that folder. Remove deletes the copy. The active id is `colorTheme` on `appSettingsSchema`, default `arbora`. Bump `SETTINGS_VERSION` and append a migration that only sets the new version, matching the earlier migrations. Leave the existing `theme` field as the light/dark/system mode.
3. Apply the active scheme by setting the overridden properties on `document.documentElement`. Light and dark each use their own map. System follows `theme.resolved`, and reapplies when the OS theme changes. Clearing a property falls back to `:root` / `.dark`. The editor already reads these variables (`panels/editor/theme.ts`). The terminal's `THEMES` map in `panels/terminal/sessions.ts` is hardcoded today: build it from the computed variables and refresh open xterm instances when the colour theme changes, the same way a light/dark switch already does.
4. Settings, in the existing General section under the light/dark/system control: the active theme, a swatch of `bg`, `fg` and `accent` for the resolved scheme, Import, Remove, "Edit theme.json" (opens the file; the app reloads it on save, same as settings JSON), and Reset to Arbora. A broken file keeps the previous good colours and shows the warning.
5. Tests. Unit-test the parser: partial maps, both schemes, unknown keys, bad colours, empty file. One e2e: import a fixture theme that sets `accent`, assert the computed `--accent` on the document, switch light/dark and assert the other scheme, then reset and assert the built-in value.

### Gotchas

- **Inline properties beat `:root` and `.dark`.** Set only the keys the file overrides. Setting the whole map to empty strings, or leaving stale inline values after Reset, pins the old colour.
- **Hex only.** `var()`, `rgb()`, `url()` and named colours are rejected. A theme file must not be able to point at a remote asset.
- **xterm does not read CSS variables.** Copy the computed colours into `term.options.theme` or the terminal stays on the built-in palette after Import.
- **`theme` is the mode.** `colorTheme` is the pack. Overloading `theme` breaks the existing light/dark/system control and its migrations.

### Acceptance

- With the built-in theme, the app looks as it does today in light, dark and system.
- Importing a `theme.json` that sets `accent` and `bg` recolours the chrome, an open editor tab and an open terminal. The other scheme's colours apply after switching light/dark.
- A file with one bad key still applies the valid keys, and the warning names the bad key. Reset restores the built-in colours.
- `arch-ok` on Omarchy/Hyprland: import, switch scheme, reset, in `pnpm dev` and the packaged build.

### Checklist

- [ ] `theme-file.ts` parser, key list, unit tests
- [ ] `colorTheme` setting, migration, themes folder under userData
- [ ] Apply overrides on the document; editor and terminal follow
- [ ] Settings: list, swatches, import, edit, remove, reset
- [ ] e2e for import and reset
- [ ] `arch-ok` on Omarchy/Hyprland

---

## Stage 14: Extensions

**Goal.** From Settings, install extensions Arbora has approved. Two kinds. Browser extensions load into the embedded page, the way React DevTools and Vue DevTools already do. Coding tools add diagnostics, the way the project's ESLint already does. The first browser entries are Svelte DevTools and Bitwarden. The first coding entry is Robocop, a linter for Robot Framework. The list is a catalog in the repo, not a store.

**Features.** `F-EXT-01` to `F-EXT-04` ([PLAN § 4.17](./PLAN.md#417-extensions-f-ext), [ADR 0007](./PLAN.md#adr-0007-approved-extensions-and-colour-themes)).

**Depends on.** Stage 1 (`BrowserSessions.loadExtension`, `scripts/fetch-devtools-extensions.mjs`, the pin file `resources/extensions/extensions.json`). Stage 7 for coding tools (`ToolingService`, the Problems panel). The Settings page already exists. Stage 9's fuller settings UI is not required. When Stage 12's `persist:arbora-web` partition exists, load browser extensions there too. Until then, project partitions only.

**Out of scope.** Browsing the Chrome Web Store. Loading anything from the user's Chrome profile. VS Code or Open VSX extensions. Running `pip` or `npm` for the user. Moving the bundled React and Vue DevTools into this catalog (they stay Stage 1, default on, behind the existing toggle). Agent logins through Bitwarden (Stage 12's `PasswordProvider` stays 1Password). Robocop's own MCP server (`robocop-mcp`): this stage runs `robocop check` and shows the issues.

### Instructions

1. **Catalog.** Add `apps/desktop/resources/extensions/catalog.json`, separate from the React/Vue pin file. Each entry is `{ id, name, kind: "browser" | "coding", summary }`. Browser entries also have the Chrome Web Store id. Coding entries also have `{ command, args, globs, installHint }`. Ship three entries:
   - Svelte DevTools, browser, store id `kfidecgcdjjfpeckbblhmfkhmlgecoff`.
   - Bitwarden, browser, store id `nngceckbapebfimnlniiiahkandclblb`.
   - Robocop, coding, command `robocop`, args `["check"]`, globs `*.robot` and `*.resource`, install hint `pip install robotframework-robocop`.
   Adding an entry is a code change. Settings cannot paste a URL or a store id.
2. **Browser install.** Reuse `fetch-devtools-extensions.mjs` (an `--only <name>` flag) so an install downloads that one CRX, checks the SHA-256 pin, strips `_metadata/`, and unpacks under the extensions directory. Pin the version at implementation time with `extensions:update`-style pinning. Record the pin in the catalog. Load and unload through `session.extensions.loadExtension` / `removeExtension` on every prepared project partition, following the React/Vue path in `browser-sessions.ts`. Enabled ids live in settings (`extensions.browser: string[]`, default `[]`). Bump `SETTINGS_VERSION` and append a migration. Install is off until the user turns a row on. Turning a row off unloads it and keeps the unpacked copy. Remove deletes the copy.
3. **Bitwarden spike, before promising fill.** Load the pinned extension into a test partition and record, in this section's Gotchas: whether the service worker starts, whether inline fill appears on a login form, whether the popup can be shown, and whether the vault unlocks. Electron does not draw extension toolbar buttons (Stage 12 gotcha). If fill needs the popup, add a browser-toolbar button that opens the extension popup in a small `WebContentsView`, the same idea as Stage 12's 1Password button. If unlock or fill fails, keep the row installable and say so on the row. Svelte DevTools does not wait on this spike.
4. **Svelte DevTools.** It is a DevTools panel, like the bundled React and Vue extensions. After install, the panel appears in the page DevTools (`Mod+Alt+I`) on a Svelte dev build. No toolbar button.
5. **Coding tools.** A coding entry runs the user's own binary. Resolve `command` from the project virtualenv, then the login-shell `PATH` (the same lookup agents use). If it is missing, run nothing and show `installHint` on the settings row, with a button that copies the command. Do not install it. When the binary exists and the entry is enabled, run it on save of a matching file, through a utility process with a timeout, the same bounds as ESLint in `ToolingService`. Parse Robocop's `path:line:col CODE message` lines into the Problems list beside ESLint and `tsc`. A non-zero exit with no parsed lines is one diagnostic on the row, not a crash. Further linters are more catalog rows of this shape. Ship the shape and Robocop only.
6. **Settings.** An Extensions section, two groups, Browser and Coding. Each row: name, one-line summary, Install / Remove or Enable / Disable, and for a coding tool the install hint when the binary is absent. For Bitwarden, the spike's result (what works) is the row detail.
7. **Tests.** Unit: catalog schema rejects a browser entry without a store id and a coding entry without a command. Unit: Robocop output parser (a hit, a clean run, garbage on stderr). e2e uses a tiny fixture extension committed under `fixtures/extensions/hello/` (a manifest and an empty background script), not the Web Store: enabling it loads it into the project partition and disabling it removes it. Robocop's parser does not need the real binary in CI.

### Gotchas

- **The store serves the latest CRX.** Pins drift when Svelte DevTools or Bitwarden ship, the same as React/Vue. `pnpm dev` treats a failed fetch as a warning. Install from Settings fails with the pin error and does not load a mismatched unpack. Re-pin with the update script.
- **Electron's `chrome.*` is partial.** MV3 service workers load. Toolbar actions, popups and native messaging are not provided (Stage 12). Bitwarden may unlock inside its own UI and still fail to fill. Record the spike. Do not describe a broken fill as working.
- **Bitwarden is not the password manager for agents.** Stage 12 fills through 1Password after a permission card, and redacts secrets. A Bitwarden extension the user installed can fill for the user. `browser_login` does not call it, and its vault contents stay out of prompts, tool results and logs.
- **Do not run package managers.** A missing `robocop` is an install hint. Writing into the user's virtualenv, or `pip install` on enable, is out of this stage.
- **Partitions.** `loadExtension` is per session. Enabling a browser extension after partitions already exist has to load it into each one, or only the next project window sees it. Disabling removes it from each one too.
- **Coding tools are project-local.** Robocop on a project with no `.robot` files stays quiet. It does not run on every save of a TypeScript file.

### Acceptance

- Settings lists Svelte DevTools, Bitwarden and Robocop, and nothing else. There is no URL field.
- Turning on Svelte DevTools downloads the pinned CRX, loads it, and the Svelte panel is present in DevTools on a Svelte dev page. Turning it off unloads it. A pin mismatch refuses to load.
- The Bitwarden spike is written into Gotchas, and the settings row matches that result.
- With Robocop on `PATH`, saving a `.robot` file adds its issues to Problems. With Robocop absent, Problems is unchanged and the row shows `pip install robotframework-robocop`.
- The fixture extension e2e passes. `arch-ok` on Omarchy/Hyprland covers install and remove for Svelte DevTools, and a Robocop run if `robocop` is installed.

### Checklist

- [ ] `catalog.json` with Svelte DevTools, Bitwarden and Robocop
- [ ] Pinned fetch and `loadExtension` / unload for browser entries
- [ ] Bitwarden spike recorded, settings row matches it
- [ ] Coding-tool runner, Robocop parser, Problems output, install hint
- [ ] Settings section, both groups
- [ ] Fixture extension e2e, parser unit tests
- [ ] `arch-ok` on Omarchy/Hyprland

---

## Stage 15: Accounts and membership

**Goal.** Nobody uses Arbora without signing in, and Arbora Pro ($5 USD a month or $50 a year) unlocks the power features. A new account gets 14 days of Pro. Free stays good enough to reach the first success. The plan, the prices and the Free/Pro table per stage are in [MONETIZATION.md](./MONETIZATION.md); if this section and that page ever differ, that page wins on pricing and gating, and this section on how it is built.

**Features.** `F-ACCOUNT-01` to `F-ACCOUNT-07` ([PLAN § 4.18](./PLAN.md#418-accounts-and-membership-f-account), [ADR 0008](./PLAN.md#adr-0008-a-required-account-and-a-membership-for-the-power-features)).

**Depends on.** Stage 9 (Settings, the onboarding wizard, `safeStorage`, `app.openExternal`, the update channels). Gates for later stages (Grove, Stage 11, Stage 12) are added by those stages through the same `can(feature)` check; this stage ships the gates for features that exist when it lands. The account server can be built in the website's repository.

**Sub-parts, landed in order.** 15a sign-in (everyone on a trial, no gates), 15b billing and entitlements, 15c gates and upgrade prompts behind a server-side switch.

**Out of scope.** Team plans and seats, SSO/SAML, education programs, regional prices, a merchant of record (possible later without app changes), usage-based billing. The token ledger is Stage 16. It is stored in the project first, and copied to the account database only when the user saves usage to their account. This stage does not add that table.

### Instructions

1. **Account server (website side).** Endpoints, all HTTPS, JSON:
   - `GET /app/sign-in?client_id=arbora-desktop&redirect_uri=…&code_challenge=…&code_challenge_method=S256&state=…`: the auth provider's sign-in (email magic link, GitHub, Google), then a redirect to `redirect_uri` with `code` and `state`. Allowed redirect URIs: `arbora://auth/callback` and `http://127.0.0.1:<any port>/callback`.
   - `POST /v1/token`: `authorization_code` (with `code_verifier`) and `refresh_token` grants; returns `{ access_token (15 min), refresh_token (rotating, 90 days), expires_in }`.
   - `POST /v1/device` and polling on `/v1/token` with `device_code`: the device fallback ("enter ABCD-EFGH at <site>/activate").
   - `GET /v1/entitlements` (bearer access token): `{ token }`, an Ed25519 JWT with `{ sub, email, plan: "free" | "pro", source: "trial" | "subscription" | "grant", trialEndsAt, periodEndsAt, cancelAtPeriodEnd, limits: { concurrentAgents, designSavesPerMonth, referenceTabs }, gatesEnabled, iat, exp: iat + 14 days }`.
   - `POST /v1/checkout` `{ interval: "month" | "year" }` and `POST /v1/portal`: return Stripe Checkout and Customer Portal URLs for the signed-in account. Checkout uses Billing with the prices' lookup keys `pro_monthly` / `pro_yearly`, `customer` reused per account, `client_reference_id` = account id, and a success URL that deep-links `arbora://account/refresh`.
   - `POST /api/stripe/webhook`: verify the signature; on `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid` and `invoice.payment_failed`, store the subscription status and period end per account. `active`, `trialing` and `past_due` count as Pro. Idempotent by event id.
   - `DELETE /v1/account`: delete the account and cancel the subscription (privacy law, and the Settings button).
   Tables: `accounts (id, email, created_at, trial_ends_at, stripe_customer_id)`, `subscriptions (account_id, stripe_subscription_id, status, price_lookup_key, current_period_end, cancel_at_period_end)`, `refresh_tokens (hash, account_id, device_name, expires_at, revoked_at)`, `webhook_events (id)`. Log nothing about projects or prompts; there is nothing to log.
2. **Shared contract (`packages/shared/src/account.ts`).** zod schemas for the entitlement claims, `FEATURES` (an enum of gateable features: `concurrentAgents`, `grove`, `designMode`, `projectGroups`, `agentGroups`, `referenceTabs`, `crossTab`, `designMatch`, `agentLogin`, `worktrees`, `writeThrough`, `designHistory`, `actionTraces`, `groveOrchestration`), and a pure `can(entitlement, feature, usage)` that returns `{ allowed: true } | { allowed: false, reason, limit? }`. Exhaustive `switch` over `FEATURES`. Unit-test every row of MONETIZATION.md's table, the trial, `past_due`, expiry, and `gatesEnabled: false` (everything allowed). The Ed25519 public keys (current and next) live here.
3. **Sign-in in main (`apps/desktop/src/main/account/`).** `AccountService` owns the tokens and the entitlement. Sign-in: generate the PKCE verifier and `state`, open the system browser with `shell.openExternal`, and receive the code through the protocol handler (`app.setAsDefaultProtocolClient('arbora')`; macOS `open-url`; Windows and Linux the `second-instance` argv) or a one-shot loopback server on `127.0.0.1:0` that closes after one request or 5 minutes. Check `state`. Exchange the code. Store the refresh token with `safeStorage.encryptString` in `<userData>/account.bin`; never in `settings.json`. Device-code flow as a fallback button. Refresh the access token when it is within 60 s of expiry; on `invalid_grant`, sign out.
4. **Entitlements in main.** Fetch on startup, window focus (at most every 10 minutes), the `arbora://account/refresh` deep link, and every 6 hours. Verify the JWT signature with `node:crypto` (`verify(null, data, publicKey, sig)` for Ed25519) and `exp`. Cache the last valid token in `<userData>/entitlement.jwt`. Offline, use it until `exp`; after that, the account counts as signed out for new windows, and a window with a project keeps working until it closes. IPC: `account.get`, `account.signIn`, `account.signInWithDevice`, `account.signOut`, `account.openCheckout { interval }`, `account.openPortal`, `account.delete`, and the event `account.changed`. The renderer never sees tokens.
5. **Required sign-in (renderer).** With no valid entitlement, the window shows a full sign-in screen instead of the Projects page or a project: "Sign in to Arbora" with Continue in browser, Use a code instead, and a line on what the server stores. Projects passed on the command line open after sign-in. The onboarding wizard's first step is this screen. e2e runs use a local fake account server (`e2e/account-server.ts`) and a test signing key through `ARBORA_ACCOUNT_URL` and `ARBORA_ACCOUNT_TEST_KEY`; release builds reject the test key.
6. **Settings → Account.** Email, plan (Free, Pro trial with days left, Pro monthly or yearly with renewal date, or "cancels on <date>"), **Upgrade** (yearly preselected, monthly beside it), **Manage membership** (portal), **Sign out**, **Delete account** (typed confirmation), and "What Arbora's server knows about you". Title-bar account menu: avatar initial, plan, Settings, Sign out.
7. **Gates (15c).** Every gate calls main's `can()`; the renderer only renders the answer. Limits counted locally: running agents from `AgentService`, design saves in `settings.account.usage.designSaves[YYYY-MM]`, open reference tabs. The gate UI is one component, `components/UpgradeGate.tsx`: what Pro adds, the price, Upgrade, and "Not now". Pro-only data after a lapse (agent groups, project groups, design history) is shown read-only, never hidden or deleted. A running agent turn is never interrupted by a lapse. `gatesEnabled` from the server turns all gates off until the website's pricing page is live.
8. **Onboarding and docs.** Onboarding starts with sign-in and ends with the plan ("You're on a 14-day Pro trial"). README and FAQ: why an account is needed, what is stored, offline use. `docs/MONETIZATION.md` stays the source for prices and gates.
9. **Tests.** Unit: PKCE (verifier/challenge per RFC 7636), `state` mismatch, JWT verification (bad signature, wrong key, expired, the next key), `can()` for every feature and plan, the month counter roll-over, the offline window. e2e with the fake server: first launch shows the sign-in screen; the loopback callback signs in and shows the Projects page; a Free entitlement blocks a second running agent and shows the gate; switching the fake server to Pro and sending `arbora://account/refresh` lifts it; an expired cached entitlement offline shows the sign-in screen for a new window only; sign-out returns to the sign-in screen and removes `account.bin`.

### Gotchas

- **Protocol handlers differ per OS.** macOS delivers `arbora://` through `open-url` (register it before `ready`), Windows and Linux start a second instance with the URL in argv (the single-instance lock already forwards argv). Linux needs `MimeType=x-scheme-handler/arbora;` in the `.desktop` file (electron-builder's `linux.mimeTypes`, plus `aur/arbora.desktop`); the tarball has no `.desktop` file, so it uses the loopback redirect. `pnpm dev` registers `process.execPath` with the app path as an argument.
- **Never parse the callback in the renderer.** The code and `state` go straight from the protocol or loopback handler to `AccountService`.
- **The loopback server binds `127.0.0.1` only,** accepts one request, checks `state`, and answers with a page that says "You can close this tab".
- **Clock skew.** Accept JWTs up to 5 minutes in the future; use the server's `iat` for the offline window, not only the local clock.
- **`safeStorage` on Linux** without gnome-keyring or KWallet returns `isEncryptionAvailable() === false` (Stage 9 gotcha): ask before falling back, and keep the refresh token out of `settings.json` and diagnostics exports either way.
- **Diagnostics export** must not include `account.bin`, `entitlement.jwt` or the email; add them to the redaction test.
- **Stripe webhooks are the source of truth,** not the checkout success page (a user can close the tab before it loads). The deep link only asks the app to refresh.
- **Restricted Stripe key on the server only.** The app never holds a Stripe key or a price id; it asks the server for a Checkout URL.
- **Stripe Tax** calculates nothing without a registration. Do not enable `automatic_tax` until the registrations exist (MONETIZATION.md).
- **A gate is not a crash.** A Free user who hits the agent limit sees the gate in place of the new thread; existing threads and their transcripts still open.

### Acceptance

- A fresh install shows the sign-in screen; nothing else is reachable except Settings → Account → Sign in, Help, and quitting.
- Signing in through the browser returns to Arbora on all three OSes (protocol) and from the Linux tarball (loopback); the device code works with the browser on another machine.
- A new account is on a 14-day Pro trial. Upgrading through Checkout in Stripe test mode turns the account Pro in the app within a minute, without a restart. Cancelling in the Portal keeps Pro to the period end.
- Free limits behave as MONETIZATION.md's table says, each with the upgrade gate, and no Pro-only data disappears after a lapse.
- Offline for 13 days the app works; on day 15 a new window asks to sign in, and an open project window keeps working.
- No token, email or entitlement appears in `settings.json`, logs, the ACP log or a diagnostics zip.
- `arch-ok` on Omarchy/Hyprland covers the protocol sign-in from the AUR package and the loopback sign-in from the tarball.

### Checklist

- [ ] Account server endpoints, tables and the Stripe webhook (website repository)
- [ ] Stripe products, prices (`pro_monthly`, `pro_yearly`), Customer Portal, webhook, restricted key (sandbox first)
- [ ] `packages/shared/src/account.ts`: schemas, `FEATURES`, `can()`, public keys, unit tests
- [ ] `AccountService`: PKCE sign-in (protocol, loopback, device code), token storage, refresh, sign-out
- [ ] Signed entitlements: verify, cache, refresh triggers, 14-day offline window
- [ ] Required sign-in screen and onboarding step
- [ ] Settings → Account and the title-bar account menu
- [ ] Gates and `UpgradeGate` for the features that exist (agents, design mode, groups), behind `gatesEnabled`
- [ ] Redaction of account files in diagnostics; privacy text in README and FAQ
- [ ] Unit tests and the fake-server e2e
- [ ] Terms, privacy and refund pages on the website
- [ ] `arch-ok` on Omarchy/Hyprland

---

## Stage 16: Usage, cost and time

**Goal.** Record what each coding agent spent, from the tokens it reports and the provider's price for the model that produced them, plus how long the turn worked. Show that on the session and on the pull request, and over time. Store it in the project first. Later, copy the same rows into the account database so they are saved off this computer; the website reads the database.

**Features.** `F-USAGE-01` to `F-USAGE-07` ([PLAN § 4.19](./PLAN.md#419-usage-cost-and-time-f-usage), [ADR 0009](./PLAN.md#adr-0009-cost-is-tokens-times-the-providers-list-price)).

**Depends on.** Stage 3 (ACP sessions, the model select, `UpdateNormalizer`). Stage 8 (`listPullRequests`, the branch). Stage 10 for the Grove row and the working timer; the docked thread header shows the same pair before Grove. 16b depends on Stage 15 (`AccountService`, the account server). 16a does not.

**Sub-parts, landed in order.** 16a local ledger, prices, session and pull request totals, the usage page. 16b the database copy and the website page. 16a is done when the app shows cost and time with the network off.

**Out of scope.** Charging the user for tokens. Pricing the context-window fields `used` and `size`. Product analytics in the usage table. A hand-typed cost as the primary number. Hosting the website in this repository (the page and the table live with the account server).

### Instructions

1. **Turn row (`packages/shared/src/usage.ts`).** The schema is the object in PLAN § 4.19. Export `sliceTokens(previous, next)` and `costUsd(tokens, price)`. Cumulative rule: when every present counter is ≥ the previous report for the same thread and model, the slice is the difference; a drop, or a model change, stores the report as its own slice. Zeros add nothing. `costUsd` returns null when `price` is null. Unit-test the cumulative case, the drop, the model change, a zero report, and this fixture (the rates are fixtures, not a claim about a live model): 1,000,000 input at $3, 500,000 output at $15, 2,000,000 cache read at $0.30 and 0 cache write at $3.75 equals $11.10.
2. **Price table (`packages/shared/src/model-prices.ts`).** One row per model the built-in agents offer: provider, match strings (the model ids those agents put in the picker), USD per 1,000,000 for input, output, cache read and cache write, the pricing-page URL, and `asOf`. Fill the numbers from the provider's published API page on the day you add the row, and name that page in the row comment. A free model is an explicit zero row, so its cost is `$0.00`. `priceFor(modelId, overrides)` picks the longest match, then the user's override. Unknown ids return null.
3. **Capture.** Stop dropping a billable `usage_update` in `UpdateNormalizer`. Keep `{ used, size }` as a context reading on the thread and leave it out of `costUsd`. Parse the split named in `F-USAGE-01` from the raw update, including a nested `tokens` object. Stamp `modelId` from the update, else from the session model select at that moment. On turn end, write `durationMs` from the user message to the stop reason, subtracting time the turn spent waiting on a permission card. A fake-agent script in `packages/acp-client/src/testing/fake-agent.ts` gains a `usage` step that emits one cumulative pair and then a second report, so the test sees a delta.
4. **Ledger on disk.** `apps/desktop/src/main/usage/UsageLedger.ts` appends turns to `.arbora/usage/<threadId>.json` through the project-scoped fs. After each turn, set `branch` from `git rev-parse --abbrev-ref HEAD` and `pr` from the open PR whose `head` matches (`github.ts` `listPullRequests`). Re-link only rows with a null `pr` when a later `listPullRequests` shows that branch. Write `usageProjectId` into `.arbora/project.json` the first time (a uuid). It does not bump `PROJECT_SETTINGS_VERSION` when the field is optional with no default required to read old files; a missing id is created on the next turn. IPC: `usage.summary` (session, pull request, range) and `usage.export` (`json` | `csv`). Events: `usage.changed` with the thread id. The renderer never parses the files itself.
5. **Settings.** `usage.priceOverrides` (a list of `{ modelId, input, output, cacheRead, cacheWrite }`, default `[]`) and `usage.saveToAccount` (default `false`). Bump `SETTINGS_VERSION` and append a migration that only advances the version. Settings → Usage lists the built-in rates, an override row, the estimate caption, and **Save usage to my account** disabled with "Available once you are signed in" until Stage 15's account exists. Export JSON and CSV buttons call `usage.export`.
6. **UI.** Session header and the Grove row: `worked 12m · ~$0.42`, or `worked 12m · tokens not reported`. Under one cent, the row shows `<$0.01` and the tooltip shows four decimals. Source Control's pull request row uses the same pair from rows whose `pr.number` matches. A lead shows its own sum and "including helpers" from `parentThreadId`, and the pull request sum counts each turn once. Settings → Usage shows today, 7 days, 30 days and all time, grouped by model, agent, project and pull request. The caption "Estimated from published API prices" is on every screen that shows a dollar amount.
7. **Database copy (16b).** On the account server, table `usage_turns (id, account_id, payload jsonb, updated_at)` with a unique `(account_id, id)`. `POST /v1/usage` upserts a batch. `GET /v1/usage?since=` returns rows for the signed-in account. `DELETE /v1/usage` deletes that account's rows. `AccountService` calls these only when `usage.saveToAccount` is true and the entitlement is present. The body is the turn row from PLAN § 4.19, including `branch` (the git branch name) and the pull request. Leave out prompts, filesystem paths, diffs and screenshots. `syncedAt` is set locally after a 2xx. Startup with the switch on downloads rows whose ids are missing locally and writes them into `.arbora/usage/`. The website usage page (with the account site) reads `usage_turns` for the signed-in user: the same totals, by day, model, project label and pull request. **Remove from my account** calls the delete endpoint and leaves the local files. Diagnostics export already skips `.arbora/`; add an explicit skip for `usage/` in the redaction test so a future include of the project folder cannot pick it up.
8. **Tests.** Unit: `sliceTokens`, `costUsd`, `priceFor` (longest match, zero row, override, unknown), the normalizer (split kept, `used`/`size` not priced, cumulative delta). e2e with the fake agent's `usage` step: a session shows the fixture cost and a non-zero worked time; a second session that only sends `{ used, size }` shows the time and "tokens not reported" and no dollar amount; opening a PR on the branch (fake `gh`) moves the turns onto that PR row. 16b e2e uses the Stage 15 fake account server: with the switch off, no request hits `/v1/usage`; with it on, the row is stored and a second launch with an empty `.arbora/usage/` restores it from `GET /v1/usage`.

### Gotchas

- **`used` and `size` are the context window.** The normalizer test today expects `{ used: 1, size: 2 }` to produce no thread change. Keep that for the transcript. A separate state field may hold the latest pair. Multiplying `used` by a price will invent a large, wrong cost on every agent that only reports context fill.
- **Counters are often cumulative.** Applying each `usage_update` as a fresh slice double-counts. Diff against the previous report for that thread and model.
- **The model can change mid-session.** Stamp the model that was selected when the update arrived. Do not diff a new model's counters against the previous model's.
- **List price is not the invoice.** Say so in the caption. Do not relabel the figure "you were charged".
- **Helper turns.** Summing the lead's "including helpers" into the pull request total on top of the child rows counts the children twice.
- **The database is a copy.** The website has no way to read `.arbora/`. If 16b only displays local files inside the app, nothing has been saved off the machine. If 16b deletes the local files after upload, the app goes blank offline. Keep both, and download missing ids on startup.
- **`project.json` is the committed file.** `usageProjectId` belongs there so a second clone joins the same database rows. Do not put the absolute path, the machine name, or the prompt in that file or in the payload.
- **Appendix B.** For each real agent, record whether a billable split arrived and which field names it used. A missing split does not fail the stage; the fake agent covers the math. Update the parser if a built-in agent uses a different shape, and add a fixture for that shape.

### Acceptance

- A fake agent that reports a known split produces the expected dollars and a worked time on the session, and the same pair on the pull request once the branch has one. Restarting the app shows the same numbers from `.arbora/usage/`.
- A turn that only reports `used` and `size` shows time and "tokens not reported", and no `$0.00`.
- A free model with a zero price row shows `$0.00`. An unknown model id shows the token counts and a blank cost.
- With **Save usage to my account** off, the account server receives no usage request. With it on, the rows are in `usage_turns`, the website shows them, and a second machine (an empty usage folder, the same `usageProjectId`) receives them back into `.arbora/usage/`.
- No prompt, path or host token appears in the payload, the ACP log or a diagnostics zip.
- `arch-ok` on Omarchy/Hyprland: run one real agent, confirm the Appendix B note, and read the session and pull request figures.

### Checklist

- [ ] `usage.ts` schema, `sliceTokens`, `costUsd`, unit tests
- [ ] `model-prices.ts` with dated provider rows, overrides, unit tests
- [ ] Normalizer keeps a billable split; `used` / `size` stay context
- [ ] `UsageLedger` under `.arbora/usage/`, branch and pull request link, `usageProjectId`
- [ ] Session header, Grove row, pull request row, Settings → Usage, export
- [ ] `usage_turns`, `POST` / `GET` / `DELETE /v1/usage`, website page (16b)
- [ ] Save switch default off; download of missing rows; local files kept
- [ ] Fake-agent e2e for a priced turn, an unpriced turn, and the database round trip
- [ ] Appendix B note per real agent, and `arch-ok` on Omarchy/Hyprland

---

## Stage 17: Publish

**Goal.** Let a developer ship the project they already have on Vercel or Cloudflare Pages from Arbora, and let a site owner change that website and publish it without git or a terminal.

**Features.** `F-HOST-01` to `F-HOST-05` ([PLAN § 4.20](./PLAN.md#420-publish-f-host), [ADR 0010](./PLAN.md#adr-0010-one-host-adapter-two-audiences)).

**Depends on.** Stage 1 (the browser opens the preview and the live site). Stage 6 (design mode, for a visual change). Stage 8 (`GitService` commit and push when the host builds from git). Stage 9 (Settings, onboarding). Stage 5 for the MCP tools. The token store uses `safeStorage`; when Stage 15 has landed, follow its keyring fallback and its diagnostics skip list. One linked host project is Free. Further linked host projects call `can('severalHosts')`, added to `FEATURES` in `packages/shared/src/account.ts` when this stage lands (MONETIZATION.md).

**Sub-parts, landed in order.** 17a connect, link, list deployments, preview and publish for `audience: "build"`. 17b the site-owner window and the onboarding choice. 17c the agent tools.

**Out of scope.** Arbora as a host. DNS edits beyond listing the host's domains. Env var values. Cloudflare Workers, Netlify, GitHub Pages, WordPress, Shopify. Charging for the host's bill.

### Instructions

1. **Provider seam.** `apps/desktop/src/main/host/provider.ts` defines `HostProvider`: `id` (`'vercel' | 'cloudflare'`), `connect`, `listProjects`, `link`, `deployments`, `deploy(target: 'preview' | 'production')`. Vercel uses its deployments API for the linked project and deploys the git commit the host is already watching. Cloudflare uses the Pages API the same way. Workers are not implemented. A third file `command.ts` runs an optional `host.command` (Grove's command shape) for a power user; the site audience hides it.
2. **Connect.** System browser, loopback on `127.0.0.1` for the OAuth redirect (Stage 15's protocol handler can carry it too, once that exists). Store the token with `safeStorage` in `<userData>/hosts/<id>.bin`. Never write it into `settings.json`, `.arbora/project.json`, a prompt, a tool result or a diagnostics zip. Linux without a keyring asks before the fallback, the Stage 9 question. IPC: `host.list`, `host.connect`, `host.disconnect`, `host.link`, `host.deployments`, `host.deploy`. The renderer receives project names, URLs and deployment states.
3. **Link.** `.arbora/project.json` gains optional `audience` (`build` default when missing), `host` (`{ provider, projectId, name, productionUrl }`) and optional `hostCommand`. Missing fields load on old files. Settings → Publish, in the build audience: provider, connect, a picker of the account's sites (name and URL), unlink, and the deployment list.
4. **Preview and Publish.** **Preview** calls `deploy('preview')` and opens the returned URL in the browser. **Publish** opens a confirm dialog that names the live URL, then `deploy('production')`. If the provider reports the project is git-backed, commit and push through `GitService` first; the dialog says "Save your changes and update the live site?" in the site audience and names the commit in the build audience. A failed deploy stays on screen with the host's error text, minus any token.
5. **Site audience (17b).** `audience: "site"` renders the page, the chat, and Preview / Publish. Files, the terminal, Source Control, Grove helper tools and the developer palette commands stay behind **Show developer tools** (a project setting, default off). Onboarding's new first choice is "I'm building an app" or "I want to change my website", then, for the website, "Where is it published?" with Vercel and Cloudflare. After connect, the user picks the site from names and URLs, and the browser opens `productionUrl`.
6. **Agent tools (17c).** Add `host_status`, `host_deploy_preview` and `host_publish` beside the other MCP tools, with tests in `server.test.ts` and a fake-agent step. `host_deploy_preview` asks once per session. `host_publish` asks every time, in both audiences. Results are `{ url, state }`. The tool host reads the provider in main. A missing link returns "No website is connected", which the agent can say back.
7. **Tests.** Unit: the confirm copy for both audiences, the git-backed decision, and a provider fake that records `deploy` targets. e2e against a local fake host HTTP server (no live Vercel or Cloudflare token in CI): connect stores a token the renderer cannot read, link shows the fixture site, Preview opens the preview URL, Publish does nothing until the confirm and then hits production. The site audience hides the terminal until **Show developer tools**. The fake agent's `host_publish` raises a card and, on reject, does not call `deploy`.

### Gotchas

- **The token is a production credential.** A leaked Vercel or Cloudflare token can ship someone else's site. Keep it in `safeStorage`, out of logs, and out of the MCP result. Redact `Authorization` headers in the host client the same way diagnostics already redact bearer tokens.
- **Do not upload the working tree** when the host is connected to the git repo. Trigger the host's deployment of the pushed commit. Uploading a tarball drifts from what the host would have built.
- **Publish is not "always allow".** Preview may be remembered for the session. Production asks every time, including the second call in the same turn.
- **Env values.** Listing names is enough for a developer. Reading values into the model puts secrets in the transcript. Do not add a "show value" tool in this stage.
- **Words in the site audience.** "Branch", "pull request", "commit" and "deploy hook" stay in the developer tools. The buttons the owner sees are Preview and Publish.
- **One Free site.** The gate is on linking a second host project, checked in main. The first site, Preview and Publish stay available on Free.

### Acceptance

- A build project linked to the fake host lists deployments, Preview opens the preview URL, and Publish asks, then deploys production.
- A site project shows the page and Publish, and the terminal is absent until **Show developer tools**.
- An agent can preview after one approval and cannot publish without a fresh approval. The tool result has no token.
- Disconnect deletes `hosts/<id>.bin`. A diagnostics zip does not contain it.
- `arch-ok` on Omarchy/Hyprland covers connect (or the documented token paste, if the OAuth app is not ready), Preview and Publish against one real Vercel or Cloudflare Pages project the user owns, in both audiences.

### Checklist

- [ ] `HostProvider`, Vercel and Cloudflare Pages clients, command escape hatch
- [ ] OAuth connect, `safeStorage` token, diagnostics skip
- [ ] Link, deployment list, Preview, Publish with confirm, git-backed commit and push
- [ ] `audience: "site"` window, onboarding choice, **Show developer tools**
- [ ] `host_status`, `host_deploy_preview`, `host_publish` with permission cards
- [ ] `severalHosts` gate for a second linked project
- [ ] Fake-host e2e
- [ ] `arch-ok` on Omarchy/Hyprland for one real site, both audiences

---

## Appendix A: Definition of done for every stage

- Code typechecks (`strict`), lints, unit tests pass on all three OSes in CI.
- e2e smoke passes against the fixtures touched by the stage.
- The stage's features are exercised by hand on the Arch Linux / Omarchy / Hyprland machine using the per-stage verification list, with the result recorded in the Progress table.
- New IPC channels have zod schemas in `packages/shared` and are documented in the channel registry.
- New settings have defaults, schema entries and UI (from Stage 9 onward).
- Stage checklist and Progress table updated in this file; **Current phase** in [PLAN.md](./PLAN.md) matches the table; new gotchas recorded.
- No secrets, tokens or absolute user paths in logs or committed fixtures.

## Appendix B: Manual test matrix (record results in Progress notes)

| Scenario | Claude Code | Codex | Kimi Code | Grok Build | OpenCode |
| --- | --- | --- | --- | --- | --- |
| Stage 3: edit a file with permission | not tested (the user does not use Claude Code or Codex) | not tested (the user does not use Claude Code or Codex) | ok (Kimi Code CLI 2.3.1, 29 Oct 2026: permission card for the edit, write through `fs/write_text_file`, file changed on disk, `node -e` ran as an agent tab via `terminal/create` and the output was quoted back, session restored with `session/load` after an app restart; model, thinking and mode pickers from `configOptions`) | ok (Grok 1.0.70, 29 Oct 2026: edit shown as a diff and applied (Grok approves in-cwd edits itself, no card), shell command line run as an agent tab, output quoted back with exit 0, `session/load` restored context; model picker from the legacy `models` field) | ok (OpenCode 2.1.4 via `opencode acp`, 29 Oct 2026: edit shown as a diff and applied on disk, shell command ran and its output came back, `session/load` restored the transcript after a restart. OpenCode does its own file and shell I/O, so Arbora never saw `fs/*` or `terminal/*` requests and there is no agent terminal tab; with its default `permission` config it did not ask before the edit or the command either. The default model `opencode-go/iceman-contributor-free` was refused by the OpenCode workspace privacy setting; switching the model picker to `kimi-code-plan-global/kimi-for-coding` through `session/set_config_option` fixed it) |
| Stage 4: `Mod+K` prompt with image | not tested (the user does not use Claude Code or Codex) | not tested (the user does not use Claude Code or Codex) | ok (Kimi Code 2.3.1, 29 Oct 2026: "make this button red" on `fixtures/vite-react`; the prompt went out as text, `image` and 4 `resource_link`s. Kimi read `Button.tsx`, `Card.tsx` and `App.tsx`, added a `variant` prop and set it only on the Counter card through `fs/write_text_file`, and asked once to run a shell typecheck (permission card). The button turned red over HMR. 64 s) | ok (Grok 1.0.70, 29 Oct 2026: same prompt and blocks. Grok edited the shared `Button.tsx`, so all three buttons turned red, and said so; it checked the result with its own headless Chromium. 54 s. Its `session_info_update` titled the thread) | ok (OpenCode 2.1.4 with the free `opencode/deepseek-v4.1-flash-free`, picked with `session/set_config_option`, 29 Oct 2026: same prompt and blocks. It added a `tone` prop to `Button`/`Card`, set red on the Counter card only, typechecked and curled the dev server; HMR applied it. 26 s) |
| Stage 4: `Mod+K` prompt with path fallback | not tested (the user does not use Claude Code or Codex) | not tested (the user does not use Claude Code or Codex) | n/a (advertises `promptCapabilities.image`; the fallback is covered by the e2e with `FAKE_AGENT_NO_IMAGE=1`) | n/a (advertises images at runtime) | n/a (advertises images) |
| Stage 5: MCP tools over http | n/a | n/a | not tested (this run used free OpenCode models only) | not tested (this run used free OpenCode models only) | ok (OpenCode 2.1.4, free `opencode/deepseek-v4.1-flash-free` only, 29 Oct 2026: `mcpCapabilities.http` advertised, so the `arbora-browser` entry went out as `type: http` with the `Authorization` header. OpenCode listed the tools at `session/new` and called them from its own code-execution `execute` tool, so the cards say "execute". It read `.arbora/SKILL.md` first. Two `browser_navigate`s to `https://example.com` raised one permission card, and `browser_snapshot` read the page correctly: example.com has no `h1` now) |
| Stage 5: MCP tools over stdio shim | n/a | n/a | not tested (this run used free OpenCode models only) | not tested (this run used free OpenCode models only) | ok (OpenCode 2.1.4, free `opencode/deepseek-v4.1-flash-free`, 29 Oct 2026, with `ARBORA_MCP_TRANSPORT=stdio`: the stdio entry ran `out/main/mcp-shim.js` through Arbora's Electron in Node mode; same verify loop as over http, 33 s. The packaged `--dir` build's shim relays `initialize` and `tools/list` from inside `app.asar`) |
| Stage 5: verify loop completes unaided | n/a | n/a | not tested (this run used free OpenCode models only) | not tested (this run used free OpenCode models only) | ok (OpenCode 2.1.4, free `opencode/deepseek-v4.1-flash-free`, 29 Oct 2026: "Change the primary button to red and confirm visually" on `fixtures/vite-react` with the dev server started by Arbora. It edited `Button.tsx`, waited with `browser_wait_for { networkIdle }`, took viewport and full-page screenshots (both mirrored as thumbnails), checked `browser_console_logs` and `browser_network_errors`, and replied that all three buttons are red, with no user input. 45 s) |
| Stage 6: design save applied correctly | n/a | n/a |  |  |  |
| Stage 8: generate commit message | n/a | n/a |  |  |  |
| Stage 10: Grove session, status, switch away and back | n/a | n/a |  |  |  |
| Stage 10: lead agent starts a helper and reads its answer (`grove_*` tools) | n/a | n/a |  |  |  |
| Stage 12: Figma tab → "implement this design" → match loop | n/a | n/a |  |  |  |
| Stage 12: `browser_login` with 1Password, secret never visible | n/a | n/a |  |  |  |

Fill cells with `ok`, `partial (note)` or `fail (issue link)` and the agent/adapter version tested. Claude Code and Codex columns are `n/a`: the user does not use them, so they are not tested. Test with OpenCode on a free model first, and keep Kimi Code and Grok Build runs to one per scenario.
