# Grove project groups

Date: 4 Nov 2026. Status: implemented on `grove-multi-project-design`.

Grove's project list uses the groups the Projects page already has. There is no second grouping store.

## Behaviour

- `settings.projectGroups` is the section list, in the user's order. Each entry already has `id`, `name`, `color`, and `collapsed`.
- A Grove project is in a group when `settings.projects[path].groupId` equals that id. An unknown id is ungrouped.
- The sidebar renders one section per group that contains at least one listed project, then a final **Ungrouped** section when any listed project is left over. Empty groups are not shown. When no listed project belongs to a group, the list stays flat, with no section headers.
- A group's chevron writes `projectGroups[].collapsed` through the existing group update. It does not add a Grove-only flag.
- A project's own chevron still writes `settings.grove.projects[].collapsed`, which hides that project's commands, terminals, and terminal-agents.
- The row title is `settings.projects[path].alias`, otherwise the folder name.

## Tests

`groveProjectSections` in `packages/shared/src/projects.test.ts`.
