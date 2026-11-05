# One window for every project

Date: 4 Nov 2026. Status: implemented. [PR #72](https://github.com/maplepreneur/arbora/pull/72) merged into `beta` on 4 Nov 2026 (3:43 PM ET); the follow-ups (one window, Grove dialogs over the page, `Mod+Shift+B`, `Mod+Alt+1`..`9`, focus out of the page, tooltips) are in draft [PR #73](https://github.com/maplepreneur/arbora/pull/73). Not `arch-ok`.

The browser workspace and Grove merge into one layout. There is no Browser / Grove switch any more. The window always shows the Grove project tree, the selected agent's chat, and the selected project's tools beside it. The look of Grove stays: framework marks, the green selected project, agent marks, status dots, the Agents / Recent / Terminals / Commands sections and the default-agent footer.

## Layout

```
┌ Arbora / project ▾ ························································· 🔔 ▢ ✕ ┐
├──────────────┬──────────────────────────┬────────────────────────────────┬──────────┤
│ PROJECTS   + │ ● thread  Idle · OpenCode│ Browser │ bash │ App.vue │ + ⤢ │ ▤ ⑂ ⌕   │
│ ▾ nuxt-poke… │ Transcript│Changes  ◉◎◍  │                                │ src/     │
│   AGENTS   2 │                          │  active right tab              │  app.vue │
│   RECENT     │  transcript              │                                │          │
│   TERMINALS  │                          │                                │          │
│   COMMANDS   │                          │                                │          │
│ ▸ next-poke… │ [composer]               │                                │          │
└──────────────┴──────────────────────────┴────────────────────────────────┴──────────┘
    tree            chat                         right column                 side
```

One `react-resizable-panels` group, `arbora.shell`, with four panels: `tree` (18%), `chat` (32%), `right` (36%), `side` (14%), all collapsible. Minimums are 170, 260, 240 and 160 px. A window narrower than 1100 px starts with the side column closed, and opening a column that has no room collapses the tree, then the chat. Below 520 px of content width the tree becomes the status-dot rail and only the chat shows. Panel sizes belong to the window: switching project keeps them.

- **Title bar.** Logo, `Arbora / project ▾` (opens the project switcher), the attention bell, window controls. The mode pills and the workspace switch are gone from it.
- **Tree.** `GroveSide`, unchanged in look. Clicking an agent shows it in the chat column. Clicking a terminal or a running command shows that terminal as a right-column tab. The chat stays.
- **Commands.** Each project lists its detected commands under Terminals: `package.json` scripts with the runner taken from the lockfile, and for Rails (`bin/rails` or `config/application.rb`) the dev server (`bin/dev` when present), `bundle install`, migrate, rollback, seed, routes, console, test (`bundle exec rspec` instead when `spec/` and an rspec Gemfile entry exist), and `bin/jobs` when present. `Procfile.dev`, Makefile, Composer/Artisan, Cargo and Go stay as before. The first click trusts a command, the next runs it in that project and shows its terminal on the right.
- **Chat.** `SessionPane`. Its tab row (Transcript, Changes) carries the Freestyle / Agent / Design switch on the right. Design mode shows `DesignPanel` in this column in place of the transcript, under a header row with the same switch, and so does the empty state. Settings opens over everything right of the tree. Agent mode sends to the thread in this column by default.
- **Right column.** One tab strip: **Browser** (always first), one tab per terminal tab (splits stay inside it, agent commands keep their shared tab), one tab per open file or diff, and **Changes** (`GitPanel variant="panel"`) and **Problems** once opened. The **+** menu offers File (quick open), Terminal, Browser, Changes and Problems. **⤢** collapses the tree and chat so the right column fills the window; pressing it again restores them (`Mod+Alt+M`, *Maximize Right Column*). The active tab is `layout.rightView` (`browser`, `terminal`, `editor`, `changes`, `problems`), saved per project.
- **Side.** Files, Source Control and Search (`FilesPanel`, `GitPanel variant="sidebar"`, `SearchPanel`) behind an icon row. `layout.sidebarView` picks the view.

## Selected project

The selected project is the window's project. Selecting any row under another project opens that project on this window (`project.open` with `onThisWindow`): main parks the old project's page and adopts the new one's, so each project's browser stays ready. `useGrove.focusPath` stays `null`; main's grove focus is unused. A project this window opens (CLI, Projects page, switcher) is added to the tree's list, unless the user closed it from the tree. Unsaved design edits hold a switch behind the design confirm ("before switching project"); Send or Discard then runs it. Agent mode and a clean design mode just end. A window with no project opens the first listed one; with nothing listed it shows the Projects page.

## Commands and keys

- `layout.workspace` is always `grove`, so Grove's keybinding context and main's usage sampling stay on.
- `toggleWorkspace`, `showBrowserWorkspace` and `showGrove` are removed. `toggleMaximizeRight` (`Mod+Alt+M`) is new.
- Panel commands keep their ids and map onto the shell: *Toggle Sidebar* collapses the tree, *Toggle Agent Panel* the chat, *Toggle Bottom Panel* the right column. *Show Terminal / Git Panel / Problems* pick that right tab. *Show Files / Source Control / Search* open the side view.
- Editor save, close tab and format work again (the old guards skipped them in Grove).
- Archive Agent loses its extra `Mod+W` (that closes the editor tab). Archive (`Alt+A`) and Stop (`Alt+S`) apply only with focus in the chat, and main does not intercept them, so the page and the editor still get those keys.
- `Mod+Alt+1`..`Mod+Alt+8` show the right column's tabs in strip order and `Mod+Alt+9` the last one (intercepted, so they work from the page and a terminal). `Mod+Shift+B` toggles the side column.
- `Mod+1`..`Mod+4` stay Grove's Agent 1–4; panel focus by number is shadowed. `Mod+Alt+Left` / `Right` walk tree, chat, right column and side.
- Agent mode and design mode show the Browser tab and expand the right column; they no longer switch workspace.

## Removed

`components/Workspace.tsx`, `components/WorkspaceSwitch.tsx`, `panels/AgentPanel.tsx`, `panels/agent/AgentPicker.tsx`, the activity rail, the bottom drawer, the title-bar collapse and menu helpers, and the *Open in* (Browser or Grove) row in Settings → General (`settings.grove.launch` stays in the schema). Agent groups still show in a row's menu; the tree does not draw group headers, and *New Agent Group* has no UI.

## Tests

Unit: the Rails command set (with RSpec), the right-view helpers, the title bar without the switch, the new and removed commands and their scopes. e2e: every spec moved to the shell's test ids (`grove`, `panel-tree`, `panel-chat`, `panel-right`, `panel-side`, `right-tab-*`, `side-view-*`, `right-maximize`) and the helpers in `e2e/app.ts`. Threads start from the Grove launcher.

## Build order

1. Shared: commands, keybindings, `layout.rightView`, Rails commands.
2. Renderer state: `store.ts` (workspace forced, sizes kept on switch), `files-store` and right-view helpers, `grove-store` (project switch on select, terminals as right tabs).
3. Shell: `GroveWorkspace` with the four panels, `RightColumn`, `SideColumn`, `ModeSwitch`, the slimmer `TitleBar`, `App.tsx`.
4. `commands.ts` and `QuickOpen` without the workspace switch.
5. Delete the old layout; Settings and onboarding copy.
6. Unit and e2e tests; docs.
