# Grove, several projects in one window

Date: 4 Nov 2026. Status: design, not started. First of five specs. Later specs, in order: terminal agents, memory per process, the Grove search palette and cycle chords, imported commands.

This spec changes Grove from a view of one project's ACP sessions into a Solo-style sidebar: projects, and under each project the agents and terminals running in that folder. One Grove window holds every listed project, and their processes keep running together. The browser workspace stays one project per window.

It reverses two lines in [PLAN.md](../../PLAN.md): ADR 0004's "one project in the window", and the `F-GROVE` exclusion "more than one project in the window". The amendment to § 4.12 and ADR 0004 lands in the same commit as the implementation, not in this document's commit. Stage 10 stays `In progress (PR #61, merged)` until that work merges.

## What this spec ships

- A `ProjectRuntime` in main: one `TerminalService`, one `DevServer`, one `AgentService` and its MCP tools per project path, shared by every window that shows that project.
- Grove's sidebar lists the projects in `settings.grove.projects`. Each project expands to **Agents** (ACP threads) and **Terminals**.
- Selecting an agent shows the existing Grove transcript (`SessionPane`). Selecting a terminal shows a live xterm, fed from that runtime's scrollback.
- The title-bar **Browser** segment opens the browser workspace for the project selected in Grove.

## What later specs add

The sidebar is built so these slot in without a second restructure.

| Spec | Adds |
| --- | --- |
| Terminal agents | A terminal whose foreground command is a known agent CLI (`claude`, `codex`, `opencode`, `kimi`, `grok`, `gemini`, `amp`, plus custom agent commands) moves from Terminals into Agents and shows a heuristic status. ACP threads stay as they are. |
| Memory | Resident memory of each terminal's and agent's process tree, polled every 2 s while Grove is visible. Footer shows CPU and MEM for the selection. |
| Search and chords | Inside Grove, `Mod+K` opens a palette over projects, agents, terminals, commands and "New …". `Mod+Alt+Up` / `Down` keep cycling agents. `Mod+Alt+[` / `]` cycle projects. |
| Commands | Detected commands from `package.json` (package manager taken from the lockfile), Rails (`bin/dev`, `bin/rails server`, `db:migrate`, `console`, `test`, `bin/jobs` when present), `Procfile.dev`, `Makefile`, `composer.json` / `artisan`, `Cargo.toml`, `go.mod`. Optional committed `.arbora/commands.json`. A detected command runs only after one trust click. |

Part 1 renders Agents and Terminals only. It does not render an empty Commands heading, a memory figure, or a new `Mod+K` binding. `Mod+K` in Grove keeps today's behaviour: switch to the browser workspace and enter agent mode.

## Runtime

`apps/desktop/src/main/project-runtime.ts` exports `ProjectRuntime`. It owns what `ProjectWindow.startTerminals` owns today: `TerminalService`, `DevServer`, `AgentService`, and `openBrowserTools` (the per-thread MCP server, including `GroveHost` when orchestration is on). `WindowManager.runtimeFor(path)` creates one per canonical path (`resolveProjectPath`) and returns the existing one after that.

A runtime stays alive while any window has that project open, or the path is in `settings.grove.projects`. `WindowManager` drops it when both are false. Dropping disposes agents first, then terminals, which is the order `stopTerminals` uses today. Quitting Arbora disposes every runtime.

`ProjectWindow` keeps what is bound to a window: `BrowserService`, `AgentModeService`, `DesignModeService`, `WorkspaceService`, `GitService`, `GitAutoSync`. Opening a project still starts those on the window. It no longer constructs `TerminalService` or `AgentService`; it takes the runtime from `WindowManager`.

Two windows open on the same folder share one dev server and one set of agents and terminals. Today each window starts its own. A second window attaching to a live runtime does not spawn a second `pnpm dev`.

### Events

A runtime emits to every window that has the project open and to every window whose workspace is Grove. Payloads gain `projectPath`:

- `terminal.data`, `terminal.changed`, `terminal.urlDetected`
- `agent.threadsChanged`, `agent.groupsChanged`, `agent.threadEvents`, `agent.threadState`, `agent.log`, `agent.fileChanged`

`terminal.urlDetected` still offers to open the URL in the browser of a window that has that project open. A Grove-only window receives the event and does not navigate a page it is not showing.

The terminal ring buffer and `scrollback(id)` stay on `TerminalService`. The renderer requests scrollback when it mounts an xterm for a terminal it was not subscribed to, so a terminal selected in Grove shows the output that arrived while another project was selected.

## IPC

Terminal, agent and Grove request channels take an optional `projectPath`. Omitted, it means the sender window's open project, so the browser workspace's callers do not change. Given, main resolves it with `resolveProjectPath` and uses that runtime. A path that is neither the window's project nor in `settings.grove.projects` is rejected.

Handlers in `apps/desktop/src/main/index.ts` that today read `windowFor(sender).terminals` or `.agents` go through the runtime. `project.getCurrent` stays the window's browser project.

## Settings

`settings.grove` gains:

```ts
projects: { path: string; collapsed: boolean }[]  // max 50, default []
```

Paths are canonical. Adding a path that is already listed does nothing. Removing a path asks first when that runtime has a live terminal or a live agent process: "Remove {name}? Its terminals and agents will stop." With nothing running, removal is immediate and the toast offers Undo.

This bumps `SETTINGS_VERSION` from 5 to 6. The migration copies the previous object and sets `projects` to `[]`. `grove.orchestration` and `grove.maxChildren` are unchanged.

`layout.groveThreadId` stays in the schema so saved layouts still parse. The new sidebar does not read it. The Grove window stores its selection on its layout:

```ts
groveSelection: { projectPath: string; kind: 'agent' | 'terminal'; id: string } | null
```

Default `null`. A selection whose project is no longer listed, or whose id is gone, falls through to the first agent of the first project, then the first terminal, then the empty state.

Project groups (`settings.projectGroups`) are unchanged. The sidebar does not group projects in this spec. A later spec can section the list by group.

## Sidebar and pane

Grove replaces the browser layout as it does today (`layout.workspace === 'grove'`). The list column becomes the project tree. The pane column is unchanged in structure: `react-resizable-panels` group `arbora.grove`, list default 24%, minimum 180px, maximum 45%, rail below 520px of content width.

```
┌────────────────────────────┬────────────────────────────────────────┐
│ ▾ vite-react               │  ● fix the nav    Working · Claude Code │
│     AGENTS            2    │  Transcript | Changes                   │
│       ● fix the nav        │                                        │
│       ○ tests              │  (existing SessionPane)                │
│     TERMINALS         1    │                                        │
│       ▸ pnpm dev           │                                        │
│ ▸ arbora                   │                                        │
│                            │                                        │
│ + Add project              │                                        │
└────────────────────────────┴────────────────────────────────────────┘
```

- A project row shows the alias (`settings.projects[path].alias`) or the folder name, and a chevron. Collapsed state is `settings.grove.projects[].collapsed`.
- **Agents** lists that project's unarchived ACP threads with the existing status dot (`deriveSessionStatus`) and display name. Helpers stay indented under their lead. Counts on the heading are the number of rows.
- **Terminals** lists that runtime's terminals (`TerminalInfo`): title, and a dot while `exitCode` is null. Agent-created ACP terminals (`kind: 'agent'`) stay in this list until the terminal-agents spec moves matching ones.
- The row for the current selection uses `bg-accent-soft`.
- **Add project** opens the existing folder dialog, canonicalises the path, appends `{ path, collapsed: false }`, and selects the project. It does not change the window's browser project.
- A project context menu: Open in browser, Reveal, Remove from Grove.
- The empty Grove (no projects listed) is centred copy: "Add a project to run its agents and terminals here." with **Add project**. The window's open project is not inserted automatically.

Selecting an agent sets `groveSelection` to `{ kind: 'agent' }` and mounts `SessionPane` for that thread. The pane header, Transcript and Changes tabs, permission card and composer behave as they do today, against that project's `AgentService`.

Selecting a terminal sets `{ kind: 'terminal' }` and mounts one xterm for `projectPath + id`, outside React, the way `panels/terminal/sessions.ts` does. Input, resize and the ring buffer go through the runtime's `TerminalService`. Closing the xterm view does not kill the pty.

The footer of the pane shows the selection's status word and its agent name or shell command. CPU and MEM are left for the memory spec; this spec does not reserve a fake number.

## Browser segment

The title-bar Browser / Grove switch stays. Choosing **Browser** while Grove has a selection:

1. This window switches onto that project. A page it already showed for the folder, or a page another window was showing, is attached here without loading again. The other window is not focused.
2. Files and git for the folder start on this window, and the runtime that Grove already holds is attached. `workspace` becomes `browser`.

Choosing **Browser** with no Grove selection switches this window to the browser workspace for whatever project it already has open, or the projects page when it has none.

Choosing **Grove** does what it does today, and the Grove list is the machine-wide `settings.grove.projects`, not "the project this window had open". Entering Grove does not add the window's project to that list.

`Mod+Alt+G` keeps toggling. `Mod+K` and `Mod+D` switch this window to the browser workspace for the selected project and then enter the mode. They do not open or focus another window. Switching back shows the same page.

## Renderer state

`grove-store.ts` gains the project list (from `settings.grove.projects`), the collapsed map, and `groveSelection`. Thread and terminal snapshots are keyed by `projectPath`. `agent.threadsChanged` and `terminal.changed` write the bucket for their `projectPath` and leave the others alone.

`initTerminalSessions` keys xterm instances by `projectPath + id` and ignores `terminal.data` for a pair it has not mounted. On mount it calls `terminal.scrollback` and writes that before subscribing to further data.

The docked agent panel and the bottom terminal drawer in the browser workspace read the bucket for the window's open project. Their behaviour is otherwise unchanged.

## Lifecycle

| Action | Result |
| --- | --- |
| Add project to Grove | Runtime starts. No window is required. Nothing is spawned until the user starts an agent, a terminal, or a trusted command. Adding a project does not start the dev server. |
| Open the same project in a window | The window attaches to that runtime. Terminals and agents already running stay. |
| Close that window | Runtime stays, because the path is still listed in Grove. |
| Remove from Grove while a window has it open | The list entry goes. The window's runtime stays until the window closes or switches project. |
| Remove from Grove with nothing else holding it | Confirm when anything is running, then dispose the runtime. |
| Quit | Confirmed quit disposes every runtime. Closing the last window does not, while a Grove project still has a terminal or agent process: the Electron process stays up and a tray menu can show the window or quit. Quit asks first when anything is still running. The Grove project list is not cleared. |

Switching the browser workspace to another project on the same window detaches that window from the old runtime and attaches the new one. The old runtime survives when Grove still lists it.

## Tests

Unit:

- `ProjectRuntime` refcount: a second `runtimeFor` returns the same instance; dispose runs when the last window detaches and the path is not listed; dispose order is agents then terminals.
- Settings migration 5 → 6 sets `projects` to `[]` and keeps `orchestration` and `maxChildren`.
- A `terminal.changed` event for project A does not replace project B's terminal list in the store.
- Grove selection falls through when the project was removed or the id is gone.
- IPC rejects a `projectPath` that is not the window's project and not listed.

e2e, in `apps/desktop/e2e/grove.spec.ts`, with the fake agent:

- Add two fixture folders. Each shows its own agent row. Starting an agent in the second does not clear the first.
- Select a terminal in project A, select project B, select the terminal again: the scrollback from before the switch is on screen.
- Remove a project with a running fake agent: the confirm appears, and cancelling leaves the row.

`pnpm typecheck && pnpm lint && pnpm test`, then `pnpm e2e` for the Grove spec. One branch, one draft PR into `beta`.

## Now in scope

These were deferred here and now have their own specs. None of them starts a dev server because a project was added.

| Spec | What it adds |
| --- | --- |
| [Project groups](./2026-11-04-grove-project-groups.md) | The sidebar sections `settings.grove.projects` with the existing `settings.projectGroups` and each project's `groupId`. |
| [Commands list](./2026-11-04-grove-commands-list.md) | A collapsible Commands block under each project. Clicking a row runs it after one trust click. |
| [Worktree sessions](./2026-11-04-grove-worktree-sessions.md) | The launcher can start an agent in a new git worktree that becomes its own Grove project. |
| [Process lifetime](./2026-11-04-grove-process-lifetime.md) | Grove projects keep running after the last window closes. Quit confirms before stopping them. The next launch adopts a still-living pid or shows it gone. `settings.grove.launch` chooses Browser or Grove on app start. Close in the sidebar is what drops a project from that list. |
