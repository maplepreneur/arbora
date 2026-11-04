# Grove commands list

Date: 4 Nov 2026. Status: implemented on `grove-multi-project-design`.

Each expanded Grove project has a Commands block. Nothing runs because the project was added. A `dev` or `start` script is a row the user can click.

## What is detected

`detectProjectCommands` reads the folder. The row's label is short. The tooltip is the command line.

- **package.json.** The lockfile picks the runner: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lock` or `bun.lockb` → bun, otherwise npm. Each kept script is its own row, titled `{runner}:{name}` (`npm:dev`, `pnpm:build`). Kept scripts are `dev`, `build`, `test`, `lint`, `preview`, `start`, `nuxt`, `next`, and `vite`, plus any other script whose command runs `nuxt`, `nuxi`, `next`, or `vite`. Names that start with `pre` or `post` are hooks and are skipped, except `preview`, which is in the kept list.
- **Rails.** When `bin/rails` or `config/application.rb` exists: **Dev server** (`bin/dev` if that file exists, otherwise `bin/rails server`), **Migrate** (`bin/rails db:migrate`), **Console** (`bin/rails console`), **Test** (`bin/rails test`), and **Jobs** (`bin/jobs`) only when `bin/jobs` exists.
- **Procfile.dev.** One row per process. The label is the process name (`web`, `worker`, and the same shape as Logs, Scheduler, Queue). The tooltip is the process command.
- Makefile targets, Composer scripts, `artisan`, Cargo, and Go stay as extra rows when those files exist.

## Running

The header is `Commands` plus `running/total` (`0/5` when none of the five are running). A command counts as running when that project has a terminal whose command line equals the row and whose exit code is still null. The header collapses the list. The collapsed flag is local to the window.

The first click on an untrusted row calls `grove.trustCommand` and does not start anything. The next click calls `grove.runCommand`, which starts one terminal in that project's runtime. Trust is remembered in `settings.grove.trustedCommands`.

## Tests

`packages/shared/src/project-commands.test.ts`. `e2e/grove.spec.ts` adds a fixture, checks the titles and `0/11`, and checks that adding the project did not create a terminal.
