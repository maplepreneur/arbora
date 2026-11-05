import { create } from 'zustand';
import {
  newGroupId,
  type GroupColor,
  type ProjectGroup,
  type ProjectLibrary,
  type ProjectMetaPatch,
} from '@arbora/shared';
import { focusGroveProject } from './grove-store';
import { showToast, useApp } from './store';

export const useProjects = create<{ library: ProjectLibrary; loaded: boolean }>()(() => ({
  library: { groups: [], entries: [] },
  loaded: false,
}));

export function applyLibrary(library: ProjectLibrary): void {
  useProjects.setState({ library, loaded: true });
}

export async function loadLibrary(): Promise<void> {
  applyLibrary(await window.arbora.invoke('projects.library'));
}

/** Opens `path` on this window. With a project open, it switches like the tree does (design edits ask first). */
export async function openProjectPath(path?: string): Promise<void> {
  if (path !== undefined && useApp.getState().project) {
    await focusGroveProject(path);
    return;
  }
  const result = await window.arbora.invoke('project.open', path === undefined ? {} : { path });
  if (result.error) showToast(result.error);
}

export async function updateProjectMeta(path: string, patch: ProjectMetaPatch): Promise<void> {
  try {
    applyLibrary(await window.arbora.invoke('projects.updateMeta', { path, patch }));
  } catch (error) {
    showToast((error as Error).message);
  }
}

export async function forgetProject(path: string): Promise<void> {
  applyLibrary(await window.arbora.invoke('projects.forget', { path }));
}

async function saveProjectGroups(groups: ProjectGroup[]): Promise<void> {
  const settings = await window.arbora.invoke('settings.update', { projectGroups: groups });
  useApp.setState({ settings });
  await loadLibrary();
}

const COLORS: readonly GroupColor[] = ['blue', 'purple', 'green', 'orange', 'pink', 'yellow'];

/** Creates a project group, optionally moving `path` into it. Returns the new id. */
export async function createProjectGroup(name: string, path?: string): Promise<string> {
  const groups = useApp.getState().settings.projectGroups;
  const id = newGroupId(name, groups);
  const color = COLORS[groups.length % COLORS.length] ?? 'gray';
  await saveProjectGroups([...groups, { id, name: name.trim(), color, collapsed: false }]);
  if (path) await updateProjectMeta(path, { groupId: id });
  return id;
}

export async function updateProjectGroup(id: string, patch: Partial<Omit<ProjectGroup, 'id'>>): Promise<void> {
  await saveProjectGroups(useApp.getState().settings.projectGroups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
}

export async function deleteProjectGroup(id: string): Promise<void> {
  await saveProjectGroups(useApp.getState().settings.projectGroups.filter((g) => g.id !== id));
}

export async function moveProjectGroup(id: string, delta: -1 | 1): Promise<void> {
  const groups = [...useApp.getState().settings.projectGroups];
  const index = groups.findIndex((g) => g.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= groups.length) return;
  const [group] = groups.splice(index, 1);
  if (group) groups.splice(target, 0, group);
  await saveProjectGroups(groups);
}
