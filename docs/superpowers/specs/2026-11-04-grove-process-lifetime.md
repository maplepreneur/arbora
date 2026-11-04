# Grove process lifetime, launch mode, and closing a project

Date: 4 Nov 2026. Status: implemented on `grove-multi-project-design`.

Closing a window does not stop Grove's processes. Quitting the app does, after a confirm. Closing a project in the sidebar is the only way that project leaves the remembered list. There is no SSH, no mobile client, and no second daemon binary. The supervisor is the Electron main process.

## What stays listed

`settings.grove.projects` is the remembered set. It is machine-local settings, so it survives quitting. Quitting does not remove entries. Relaunching, and switching from Browser into Grove, both read that same list.

Under each project, on the next Grove open:

- Agent threads come back from `.arbora/threads`, on that project's runtime.
- Terminals that were still alive are adopted from `userData/grove-processes.json` (pid, cwd, command, title). A pid that is dead, or whose `/proc/<pid>/cwd` on Linux is a different directory, is shown as **gone** and can be closed. Adoption does not spawn a new process and does not attach a pty; output from before the quit is gone.
- Commands are detected again from the repo (see the commands spec). They are not started.

The ledger is rewritten about every two seconds while processes exist, and deleted after a confirmed quit has disposed the runtimes. A kill skips that delete, which is why the next launch can still see the pids.

## Windows and quit

- The last window closing while any Grove-listed terminal or agent still has a pid does not call `app.quit()`. A tray menu offers **Show Arbora** and **Quit**.
- **Quit** from that tray, or from the application menu, asks when something is still running: "Quitting stops them. Closing a window does not." Cancel leaves the processes up. Confirm disposes every runtime, deletes the ledger, and quits.
- With nothing running, the last window closes as it does today (`shouldQuitWhenAllWindowsClosed`).
- The end-to-end harness sets `ARBORA_E2E=1`. That launch is not interactive, so it quits without the tray or the confirm. A normal `pnpm dev` or packaged launch still asks.

## Launch mode

`settings.grove.launch` is `'browser' | 'grove'`, default `'browser'`. The field has a schema default, so a settings file from before the field still opens the browser. No settings version bump.

The first project opened in a process writes that workspace onto the saved layout (`layoutForAppLaunch`). Switching into Grove later in the same process uses the title-bar switch and lands on the same `settings.grove.projects` list. The next app start uses the setting again.

## Close

Each project row has **Close**. It calls `grove.removeProject`. When a terminal or agent is running, the toast asks; confirming stops that runtime if no window still holds it. The path leaves `settings.grove.projects` and does not come back on the next launch. Closing a window, or quitting, does not do this.

## Tests

`layoutForAppLaunch` and the `'browser'` default are in `packages/shared/src/settings.test.ts`. The ledger and adopt decision are in `apps/desktop/src/main/grove-processes.test.ts`. `e2e/grove.spec.ts` closes a project and expects `grove.projects` to become `[]`, with `launch` still `'browser'`.
