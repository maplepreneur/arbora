import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  addRecentProject,
  detectPackageManager,
  packageInstallCommand,
  portOfDevUrl,
  worktreeBranchForAgent,
  worktreeBranchName,
  worktreeDevPlan,
  worktreeDirectory,
  type AppSettings,
  type BestOfCandidate,
  type GroveProject,
  type GroveSettings,
  type WorktreeModules,
} from '@arbora/shared';
import { GitService } from '../git/git-service.js';
import { createPullRequest } from '../git/github.js';
import { readProjectSettings, updateProjectSettingsFile } from '../project-settings.js';
import type { SettingsStore } from '../settings-store.js';
import { findLockfiles, inferProjectDevCommand } from '../terminal/dev-command.js';

const OUTPUT_LIMIT = 2000;

export interface WorktreeAgentStart {
  readonly agentId: string;
  readonly model?: string | undefined;
}

export interface WorktreeRuntime {
  agents: {
    createThread(agentId: string, options: { title?: string; model?: string }): { id: string };
  };
}

export interface WorktreeHost {
  syncGroveProjects(): void;
  runtime(path: string): WorktreeRuntime | null;
}

export interface CreateWorktreeOptions {
  readonly parentPath: string;
  readonly title: string;
  readonly agentId: string;
  readonly model?: string | undefined;
  readonly also?: readonly WorktreeAgentStart[] | undefined;
  readonly windowProject: string | undefined;
  readonly settings: SettingsStore;
  readonly host: WorktreeHost;
  readonly env: () => Promise<NodeJS.ProcessEnv>;
  readonly focus: (path: string) => void;
}

export interface CreateWorktreeResult {
  readonly path?: string;
  readonly threadId?: string;
  readonly error?: string;
  readonly devUrl?: string;
  readonly port?: number;
  readonly modules?: WorktreeModules;
  readonly candidates?: BestOfCandidate[];
}

interface StartedWorktree extends BestOfCandidate {
  readonly devUrl: string;
  readonly port: number;
  readonly modules: WorktreeModules;
}

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > OUTPUT_LIMIT ? `${trimmed.slice(0, OUTPUT_LIMIT)}…` : trimmed;
}

function resolveFolder(path: string): string {
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    throw new Error(`Folder not found: ${path}`);
  }
  if (!statSync(real).isDirectory()) throw new Error(`Not a folder: ${path}`);
  return real;
}

function claimDirectory(
  parent: string,
  base: string,
  reserved: Set<string>,
): { branch: string; directory: string } | null {
  for (let attempt = 1; attempt <= 9; attempt += 1) {
    const name = attempt === 1 ? base.slice(0, 60) : `${base.slice(0, 57)}-${attempt}`;
    if (reserved.has(name)) continue;
    const directory = worktreeDirectory(parent, name);
    if (existsSync(directory)) continue;
    reserved.add(name);
    return { branch: name, directory };
  }
  return null;
}

/** Shares the parent's `node_modules` by a symlink (a junction on Windows). A real directory is left alone. */
export function linkWorktreeModules(parentPath: string, worktreePath: string): WorktreeModules {
  const dest = join(worktreePath, 'node_modules');
  try {
    if (lstatSync(dest).isSymbolicLink()) return 'linked';
    return 'own';
  } catch {
    // Missing, which is what a fresh worktree looks like when node_modules is gitignored.
  }
  const source = join(parentPath, 'node_modules');
  if (!existsSync(source)) return 'own';
  try {
    symlinkSync(source, dest, process.platform === 'win32' ? 'junction' : 'dir');
    return 'linked';
  } catch {
    return 'own';
  }
}

/** Removes a `node_modules` symlink without following it into the parent checkout. */
export function unlinkWorktreeModules(worktreePath: string): void {
  const dest = join(worktreePath, 'node_modules');
  if (!lstatSync(dest).isSymbolicLink()) throw new Error('node_modules is not a link');
  unlinkSync(dest);
}

/** The install command for a worktree, from its `package.json` and lockfile. */
export function worktreeInstallCommand(projectPath: string): string | null {
  let pkg: { packageManager?: unknown };
  try {
    pkg = JSON.parse(readFileSync(join(projectPath, 'package.json'), 'utf8')) as typeof pkg;
  } catch {
    return null;
  }
  const manager = detectPackageManager({
    packageManagerField: typeof pkg.packageManager === 'string' ? pkg.packageManager : undefined,
    lockfiles: findLockfiles(projectPath),
  });
  return packageInstallCommand(manager);
}

function listedWorktree(settings: AppSettings, path: string): GroveProject | undefined {
  let resolved: string;
  try {
    resolved = resolveFolder(path);
  } catch {
    return undefined;
  }
  const entry = settings.grove.projects.find((project) => project.path === resolved);
  return entry?.parentPath ? entry : undefined;
}

/** Drops a worktree from the Grove list and from best-of-N sets. A set of one is removed. */
export function groveWithoutWorktree(grove: GroveSettings, path: string): GroveSettings {
  return {
    ...grove,
    projects: grove.projects.filter((project) => project.path !== path),
    bestOf: grove.bestOf
      .map((set) => ({ ...set, candidates: set.candidates.filter((candidate) => candidate.path !== path) }))
      .filter((set) => set.candidates.length >= 2),
  };
}

function otherDevPorts(settings: AppSettings): number[] {
  const ports: number[] = [];
  for (const project of settings.grove.projects) {
    const port = portOfDevUrl(readProjectSettings(project.path).settings.devUrl);
    if (port !== null) ports.push(port);
  }
  return ports;
}

/**
 * Adds one git worktree per agent, each on its own port, and starts a thread there.
 * `also` is best-of-N: the same task on more agents. A later failure keeps the worktrees that
 * already started.
 */
export async function createGroveWorktree(options: CreateWorktreeOptions): Promise<CreateWorktreeResult> {
  let parent: string;
  try {
    parent = resolveFolder(options.parentPath);
  } catch (error) {
    return { error: (error as Error).message };
  }
  let windowProject: string | undefined;
  if (options.windowProject) {
    try {
      windowProject = resolveFolder(options.windowProject);
    } catch {
      windowProject = options.windowProject;
    }
  }
  const known =
    parent === windowProject || options.settings.get().grove.projects.some((entry) => entry.path === parent);
  if (!known) return { error: 'That project is not in Grove' };
  const git = new GitService({ root: parent, env: options.env });
  const status = await git.status();
  if (!status.repo) return { error: 'This folder is not a git repository' };

  const agents: WorktreeAgentStart[] = [
    { agentId: options.agentId, ...(options.model !== undefined ? { model: options.model } : {}) },
  ];
  const seen = new Set<string>([options.agentId]);
  for (const extra of options.also ?? []) {
    if (seen.has(extra.agentId) || agents.length >= 4) continue;
    seen.add(extra.agentId);
    agents.push(extra);
  }

  const parentSettings = readProjectSettings(parent).settings;
  const parentCommand = parentSettings.devCommand ?? inferProjectDevCommand(parent);
  const taken = otherDevPorts(options.settings.get());
  const reserved = new Set<string>();
  const started: StartedWorktree[] = [];
  const errors: string[] = [];

  const undo = async (resolved: string, directory: string): Promise<void> => {
    options.settings.update((current) => ({
      ...current,
      grove: groveWithoutWorktree(current.grove, resolved),
    }));
    options.host.syncGroveProjects();
    await git.removeWorktree(directory).catch(() => undefined);
  };

  for (let index = 0; index < agents.length; index += 1) {
    const agent = agents[index];
    if (!agent) continue;
    const base = index === 0 ? worktreeBranchName(options.title) : worktreeBranchForAgent(options.title, agent.agentId);
    const claimed = claimDirectory(parent, base, reserved);
    if (!claimed) {
      errors.push(`No free folder next to the project for ${base}`);
      continue;
    }
    try {
      await git.addWorktree(claimed.branch, claimed.directory);
    } catch (error) {
      if (existsSync(claimed.directory)) await git.removeWorktree(claimed.directory).catch(() => undefined);
      errors.push((error as Error).message);
      continue;
    }
    let resolved: string;
    try {
      resolved = resolveFolder(claimed.directory);
    } catch (error) {
      await git.removeWorktree(claimed.directory).catch(() => undefined);
      errors.push((error as Error).message);
      continue;
    }
    const plan = worktreeDevPlan({
      parentDevUrl: parentSettings.devUrl,
      parentCommand,
      takenPorts: taken,
    });
    taken.push(plan.port);
    try {
      updateProjectSettingsFile(resolved, {
        ...(plan.devCommand ? { devCommand: plan.devCommand } : {}),
        devUrl: plan.devUrl,
      });
    } catch (error) {
      await git.removeWorktree(claimed.directory).catch(() => undefined);
      errors.push((error as Error).message);
      continue;
    }
    const modules = linkWorktreeModules(parent, resolved);
    const parentGroup = options.settings.get().projects[parent]?.groupId;
    options.settings.update((current) => {
      if (current.grove.projects.some((entry) => entry.path === resolved)) return current;
      const previous = current.projects[resolved];
      const projects: AppSettings['projects'] = {
        ...current.projects,
        [resolved]: {
          ...previous,
          ...(parentGroup ? { groupId: parentGroup } : {}),
          browser: {
            lastUrl: plan.devUrl,
            preset: previous?.browser?.preset ?? 'responsive',
            zoomFactor: previous?.browser?.zoomFactor ?? 1,
          },
        },
      };
      return {
        ...current,
        projects,
        grove: {
          ...current.grove,
          projects: [
            ...current.grove.projects,
            { path: resolved, collapsed: false, parentPath: parent, modules, port: plan.port },
          ].slice(0, 50),
        },
        recentProjects: addRecentProject(current.recentProjects, {
          path: resolved,
          name: basename(resolved),
          openedAt: Date.now(),
        }),
      };
    });
    if (!options.settings.get().grove.projects.some((entry) => entry.path === resolved)) {
      await git.removeWorktree(claimed.directory).catch(() => undefined);
      errors.push('Grove already has 50 projects');
      break;
    }
    options.host.syncGroveProjects();
    const runtime = options.host.runtime(resolved);
    if (!runtime) {
      await undo(resolved, claimed.directory);
      errors.push('Could not start the worktree');
      continue;
    }
    try {
      const thread = runtime.agents.createThread(agent.agentId, {
        title: options.title,
        ...(agent.model !== undefined ? { model: agent.model } : {}),
      });
      started.push({
        path: resolved,
        threadId: thread.id,
        agentId: agent.agentId,
        branch: claimed.branch,
        devUrl: plan.devUrl,
        port: plan.port,
        modules,
      });
    } catch (error) {
      await undo(resolved, claimed.directory);
      errors.push((error as Error).message);
    }
  }

  if (started.length === 0) return { error: clip(errors[0] ?? 'Could not create the worktree') };
  if (started.length >= 2) {
    const candidates: BestOfCandidate[] = started.map((candidate) => ({
      path: candidate.path,
      threadId: candidate.threadId,
      agentId: candidate.agentId,
      branch: candidate.branch,
    }));
    options.settings.update((current) => ({
      ...current,
      grove: {
        ...current.grove,
        bestOf: [
          { id: randomUUID(), parentPath: parent, task: options.title, candidates },
          ...current.grove.bestOf,
        ].slice(0, 10),
      },
    }));
  }
  const first = started[0];
  if (!first) return { error: 'Could not create the worktree' };
  options.focus(first.path);
  return {
    path: first.path,
    threadId: first.threadId,
    devUrl: first.devUrl,
    port: first.port,
    modules: first.modules,
    candidates: started.map((candidate) => ({
      path: candidate.path,
      threadId: candidate.threadId,
      agentId: candidate.agentId,
      branch: candidate.branch,
    })),
    ...(errors.length > 0 ? { error: clip(errors.join('\n')) } : {}),
  };
}

/** Merges the worktree branch into the parent checkout. */
export async function mergeGroveWorktree(options: {
  path: string;
  settings: SettingsStore;
  env: () => Promise<NodeJS.ProcessEnv>;
}): Promise<{ ok: boolean; output: string }> {
  const entry = listedWorktree(options.settings.get(), options.path);
  if (!entry?.parentPath) return { ok: false, output: 'That folder is not a Grove worktree' };
  const branch = (await new GitService({ root: entry.path, env: options.env }).status()).branch;
  if (!branch) return { ok: false, output: 'The worktree is not on a branch' };
  const result = await new GitService({ root: entry.parentPath, env: options.env }).merge(branch);
  return { ok: result.ok, output: clip(result.output) || (result.ok ? 'Merged.' : 'The merge failed.') };
}

/** Pushes the worktree branch and opens a pull request. */
export async function pullRequestGroveWorktree(options: {
  path: string;
  title: string;
  body: string;
  settings: SettingsStore;
  env: () => Promise<NodeJS.ProcessEnv>;
}): Promise<{ url?: string; error?: string }> {
  const entry = listedWorktree(options.settings.get(), options.path);
  if (!entry?.parentPath) return { error: 'That folder is not a Grove worktree' };
  const git = new GitService({ root: entry.path, env: options.env });
  const pushed = await git.push();
  if (!pushed.ok) return { error: clip(pushed.output) || 'The push failed.' };
  try {
    return { url: await createPullRequest(entry.path, await options.env(), options.title, options.body) };
  } catch (error) {
    return { error: clip((error as Error).message) };
  }
}

/** Deletes the worktree, its branch, and its Grove row. */
export async function discardGroveWorktree(options: {
  path: string;
  settings: SettingsStore;
  env: () => Promise<NodeJS.ProcessEnv>;
  sync: () => void;
}): Promise<{ ok: boolean; error?: string; parentPath?: string }> {
  const entry = listedWorktree(options.settings.get(), options.path);
  if (!entry?.parentPath) return { ok: false, error: 'That folder is not a Grove worktree' };
  const parentGit = new GitService({ root: entry.parentPath, env: options.env });
  const branch = existsSync(entry.path)
    ? (await new GitService({ root: entry.path, env: options.env }).status()).branch
    : null;
  try {
    if (existsSync(entry.path)) await parentGit.removeWorktree(entry.path);
  } catch (error) {
    return { ok: false, error: clip((error as Error).message) };
  }
  if (branch) {
    const parentBranch = (await parentGit.status()).branch;
    if (branch !== parentBranch) await parentGit.deleteBranch(branch);
  }
  options.settings.update((current) => ({
    ...current,
    grove: groveWithoutWorktree(current.grove, entry.path),
  }));
  options.sync();
  return { ok: true, parentPath: entry.parentPath };
}

/**
 * Merges this worktree into the parent and discards the other candidates in its best-of-N set.
 * A merge conflict discards nothing.
 */
export async function keepGroveWorktree(options: {
  path: string;
  settings: SettingsStore;
  env: () => Promise<NodeJS.ProcessEnv>;
  sync: () => void;
}): Promise<{ ok: boolean; output: string; discarded: string[] }> {
  const entry = listedWorktree(options.settings.get(), options.path);
  if (!entry) return { ok: false, output: 'That folder is not a Grove worktree', discarded: [] };
  const merged = await mergeGroveWorktree(options);
  if (!merged.ok) return { ok: false, output: merged.output, discarded: [] };
  const set = options.settings
    .get()
    .grove.bestOf.find((candidate) => candidate.candidates.some((item) => item.path === entry.path));
  const discarded: string[] = [];
  for (const other of set?.candidates ?? []) {
    if (other.path === entry.path) continue;
    const result = await discardGroveWorktree({ ...options, path: other.path });
    if (result.ok) discarded.push(other.path);
  }
  return { ok: true, output: merged.output, discarded };
}

/**
 * Installs dependencies in the worktree. A linked `node_modules` is unlinked first, so the install
 * does not write through to the parent checkout.
 */
export async function installGroveWorktree(options: {
  path: string;
  settings: SettingsStore;
  createTerminal: (command: string) => Promise<{ id: string }>;
}): Promise<{ terminalId?: string; command?: string; error?: string }> {
  const entry = listedWorktree(options.settings.get(), options.path);
  if (!entry) return { error: 'That folder is not a Grove worktree' };
  const dest = join(entry.path, 'node_modules');
  try {
    if (lstatSync(dest).isSymbolicLink()) unlinkWorktreeModules(entry.path);
  } catch {
    // Nothing to unlink: the worktree has no node_modules, or it is already a real directory.
  }
  const command = worktreeInstallCommand(entry.path);
  if (!command) return { error: 'This folder has no package.json to install.' };
  options.settings.update((current) => ({
    ...current,
    grove: {
      ...current.grove,
      projects: current.grove.projects.map((project) =>
        project.path === entry.path ? { ...project, modules: 'own' } : project,
      ),
    },
  }));
  try {
    const terminal = await options.createTerminal(command);
    return { terminalId: terminal.id, command };
  } catch (error) {
    return { command, error: clip((error as Error).message) };
  }
}
