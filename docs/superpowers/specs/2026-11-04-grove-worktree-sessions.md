# Grove worktree sessions

Date: 4 Nov 2026. Status: implemented on `grove-multi-project-design`.

A Grove agent can start in a new git worktree of the project it is working in. The worktree is another Grove project: its own runtime, directory, and dev server. This does not add a second dev-server product. It amends the Stage 11 note that worktree sessions were deferred; the work stays in Grove.

## Behaviour

- The launcher checkbox **New git worktree, named from the task** is off unless the user turns it on.
- The branch is `worktreeBranchName(title)`: lower case, non-letters become `-`, at most 48 characters. An empty slug is `grove-session`.
- The directory is a sibling of the parent checkout: `dirname(parent)/basename(parent)-branch`. Example: `/code/app` and `fix-the-nav` → `/code/app-fix-the-nav`.
- Main runs `git worktree add -b <branch> <directory> HEAD` from the parent, through `GitService`.
- If the directory already exists, or git fails, the error is returned and `settings.grove.projects` is unchanged. A directory git created before failing is removed with `git worktree remove --force`.
- On success the directory is appended as `{ path, collapsed: false, parentPath }`. `parentPath` is the parent checkout. The parent's `groupId`, when it has one, is copied onto the new path. Then the agent thread is created on that runtime. If creating the thread throws, the Grove entry is removed and the worktree is removed.
- The sidebar shows a "worktree" label whose tooltip names the parent. Helpers still cannot spawn helpers: this is the launcher, not a `grove_*` tool.
- The worktree does not get a second kind of dev server. Its commands and dev script are detected the same way as any other project, and run only when the user clicks them.

## Tests

`packages/shared/src/worktree.test.ts`. `GitService` adds and removes a worktree in `git-service.test.ts`.
