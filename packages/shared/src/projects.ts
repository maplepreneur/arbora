import { z } from 'zod';
import {
  groupColorSchema,
  type AppSettings,
  type ProjectGroup,
  type ProjectState,
  type RecentProject,
} from './settings.js';

/** One row on the Projects page or in the project switcher. */
export const projectEntrySchema = z.object({
  path: z.string(),
  /** Folder name. */
  folder: z.string(),
  /** Alias when set, else the folder name. */
  name: z.string(),
  alias: z.string().nullable(),
  pinned: z.boolean(),
  groupId: z.string().nullable(),
  openedAt: z.number().int(),
  /** In the recent list (the ten most recently opened). */
  recent: z.boolean(),
  /** Open in an Arbora window right now. */
  open: z.boolean(),
  /** Agent threads in that window that need the user (0 when not open). */
  attention: z.number().int().min(0),
});
export type ProjectEntry = z.infer<typeof projectEntrySchema>;

export const projectLibrarySchema = z.object({
  groups: z.array(z.object({ id: z.string(), name: z.string(), color: groupColorSchema, collapsed: z.boolean() })),
  entries: z.array(projectEntrySchema),
});
export type ProjectLibrary = z.infer<typeof projectLibrarySchema>;

/** What the Projects page may change about one project; `null` clears a field. */
export const projectMetaPatchSchema = z
  .object({
    pinned: z.boolean(),
    groupId: z.string().min(1).nullable(),
    alias: z.string().trim().min(1).max(100).nullable(),
  })
  .partial();
export type ProjectMetaPatch = z.infer<typeof projectMetaPatchSchema>;

export function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

/**
 * Every project worth listing: the recent ones, plus any that is pinned or in a group (those stay
 * after they drop out of the ten recents). Sorted by most recently opened.
 */
export function buildProjectLibrary(
  settings: Pick<AppSettings, 'recentProjects' | 'projects' | 'projectGroups'>,
  live: ReadonlyMap<string, number> = new Map(),
): ProjectLibrary {
  const groupIds = new Set(settings.projectGroups.map((g) => g.id));
  const recents = new Map<string, RecentProject>(settings.recentProjects.map((r) => [r.path, r]));
  const paths = new Set<string>([...recents.keys()]);
  for (const [path, state] of Object.entries(settings.projects)) {
    if (state.pinned || (state.groupId && groupIds.has(state.groupId))) paths.add(path);
  }
  for (const path of live.keys()) paths.add(path);
  const entries = [...paths].map((path): ProjectEntry => {
    const state: ProjectState = settings.projects[path] ?? {};
    const recent = recents.get(path);
    const folder = recent?.name || folderName(path);
    const groupId = state.groupId && groupIds.has(state.groupId) ? state.groupId : null;
    return {
      path,
      folder,
      name: state.alias ?? folder,
      alias: state.alias ?? null,
      pinned: state.pinned === true,
      groupId,
      openedAt: Math.max(recent?.openedAt ?? 0, state.openedAt ?? 0),
      recent: recent !== undefined,
      open: live.has(path),
      attention: live.get(path) ?? 0,
    };
  });
  entries.sort((a, b) => b.openedAt - a.openedAt || a.name.localeCompare(b.name));
  return {
    groups: settings.projectGroups.map((g) => ({ id: g.id, name: g.name, color: g.color, collapsed: g.collapsed })),
    entries,
  };
}

export function applyProjectMeta(state: ProjectState | undefined, patch: ProjectMetaPatch): ProjectState {
  const next: ProjectState = { ...state };
  if (patch.pinned !== undefined) {
    if (patch.pinned) next.pinned = true;
    else delete next.pinned;
  }
  if (patch.groupId !== undefined) {
    if (patch.groupId === null) delete next.groupId;
    else next.groupId = patch.groupId;
  }
  if (patch.alias !== undefined) {
    if (patch.alias === null) delete next.alias;
    else next.alias = patch.alias;
  }
  return next;
}

/** A group id that is unused, derived from the name so `settings.json` stays readable. */
export function newGroupId(name: string, existing: readonly { id: string }[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'group';
  const taken = new Set(existing.map((g) => g.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const id = `${base}-${i}`;
    if (!taken.has(id)) return id;
  }
}

export interface ProjectSection {
  readonly id: string;
  readonly title: string;
  readonly group: ProjectGroup | null;
  readonly entries: readonly ProjectEntry[];
}

/**
 * The Projects page layout: Pinned, then each group in the user's order, then Recent (ungrouped,
 * unpinned). `query` filters by name, alias and path. Empty sections are kept for groups so they
 * can be dropped onto, and dropped for Pinned and Recent.
 */
export function projectSections(library: ProjectLibrary, query = ''): ProjectSection[] {
  const q = query.trim().toLowerCase();
  const matches = (entry: ProjectEntry): boolean =>
    q === '' || `${entry.name} ${entry.folder} ${entry.path}`.toLowerCase().includes(q);
  const shown = library.entries.filter(matches);
  const sections: ProjectSection[] = [];
  const pinned = shown.filter((e) => e.pinned);
  if (pinned.length > 0) sections.push({ id: 'pinned', title: 'Pinned', group: null, entries: pinned });
  for (const group of library.groups) {
    const entries = shown.filter((e) => !e.pinned && e.groupId === group.id);
    if (q !== '' && entries.length === 0) continue;
    sections.push({ id: `group:${group.id}`, title: group.name, group, entries });
  }
  const rest = shown.filter((e) => !e.pinned && e.groupId === null);
  if (rest.length > 0) sections.push({ id: 'recent', title: 'Recent', group: null, entries: rest });
  return sections;
}
