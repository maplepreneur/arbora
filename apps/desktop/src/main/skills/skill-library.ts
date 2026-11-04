import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import {
  parseSkillFrontmatter,
  pickSkillDir,
  SKILL_TARGETS,
  skillNameSchema,
  skillSearchResponseSchema,
  skillTargetPaths,
  type FoundSkill,
  type LibrarySkill,
  type SkillLibrary as SkillLibraryState,
  type SkillLinkState,
  type SkillSearchResult,
  type SkillTarget,
  type SkillTargetId,
} from '@arbora/shared';
import { runGit } from '../git/run-git.js';

export interface SkillLibraryOptions {
  /** The user's home folder (`ARBORA_SKILLS_HOME` in tests). */
  readonly home: string;
  readonly env: () => Promise<NodeJS.ProcessEnv>;
  readonly platform: NodeJS.Platform;
  /** skills.sh search endpoint. */
  readonly searchUrl?: string | undefined;
  /** Prefix for `owner/repo` clone URLs. */
  readonly gitBase?: string | undefined;
  readonly fetch?: typeof fetch;
}

interface LockEntry {
  readonly source: string;
  readonly skillId: string;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.github']);
const MAX_DEPTH = 6;

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * One library of skills (`~/.arbora/skills/<name>/SKILL.md`) linked into each agent's own skills
 * folder with symlinks (junctions on Windows), so a skill is installed once and enabled per agent.
 */
export class SkillLibrary {
  readonly libraryPath: string;
  private readonly lockPath: string;

  constructor(private readonly options: SkillLibraryOptions) {
    this.libraryPath = join(options.home, '.arbora', 'skills');
    this.lockPath = join(options.home, '.arbora', 'skills-lock.json');
  }

  private async targets(): Promise<SkillTarget[]> {
    const env = await this.options.env();
    return Promise.all(
      SKILL_TARGETS.map(async (target) => {
        const paths = skillTargetPaths(target.id, { home: this.options.home, env });
        return { id: target.id, label: target.label, path: paths.skills, installed: await exists(paths.root) };
      }),
    );
  }

  private async targetPath(id: SkillTargetId): Promise<string> {
    const env = await this.options.env();
    return skillTargetPaths(id, { home: this.options.home, env }).skills;
  }

  async list(): Promise<SkillLibraryState> {
    const targets = await this.targets();
    const lock = await this.readLock();
    const libraryNames = await skillDirs(this.libraryPath);
    const skills: LibrarySkill[] = [];
    for (const name of libraryNames) {
      const dir = join(this.libraryPath, name);
      const meta = await readMeta(dir);
      const links = {} as Record<SkillTargetId, SkillLinkState>;
      for (const target of targets) links[target.id] = await this.linkState(join(target.path, name), dir);
      const entry = lock[name];
      skills.push({
        name,
        description: meta.description,
        path: dir,
        source: entry ? `${entry.source}/${entry.skillId}` : null,
        links,
      });
    }
    const inLibrary = new Set(libraryNames);
    const found = new Map<string, FoundSkill>();
    for (const target of targets) {
      for (const name of await skillDirs(target.path)) {
        if (inLibrary.has(name) || !skillNameSchema.safeParse(name).success) continue;
        const existing = found.get(name);
        if (existing) {
          existing.targets.push(target.id);
          continue;
        }
        const meta = await readMeta(join(target.path, name));
        found.set(name, { name, description: meta.description, targets: [target.id] });
      }
    }
    return {
      libraryPath: this.libraryPath,
      targets,
      skills,
      found: [...found.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  private async linkState(link: string, dir: string): Promise<SkillLinkState> {
    try {
      const info = await lstat(link);
      if (!info.isSymbolicLink()) return 'other';
      const [a, b] = await Promise.all([realpath(link).catch(() => ''), realpath(dir)]);
      return a === b ? 'linked' : 'other';
    } catch (error) {
      if (isMissing(error)) return 'none';
      throw error;
    }
  }

  async setTargets(name: string, targets: readonly SkillTargetId[]): Promise<SkillLibraryState> {
    const dir = join(this.libraryPath, name);
    if (!(await exists(join(dir, 'SKILL.md')))) throw new Error(`${name} is not in the skill library`);
    const wanted = new Set(targets);
    for (const target of SKILL_TARGETS) {
      const link = join(await this.targetPath(target.id), name);
      const state = await this.linkState(link, dir);
      if (wanted.has(target.id) && state === 'none') {
        await mkdir(dirname(link), { recursive: true });
        await symlink(dir, link, this.options.platform === 'win32' ? 'junction' : 'dir');
      } else if (wanted.has(target.id) && state === 'other') {
        throw new Error(`${link} already exists and is not Arbora's link. Move it away or adopt it first.`);
      } else if (!wanted.has(target.id) && state === 'linked') {
        await rm(link, { force: true, recursive: false });
      }
    }
    return this.list();
  }

  async remove(name: string): Promise<SkillLibraryState> {
    await this.setTargets(name, []);
    await rm(join(this.libraryPath, name), { recursive: true, force: true });
    const lock = await this.readLock();
    await this.writeLock(Object.fromEntries(Object.entries(lock).filter(([key]) => key !== name)));
    return this.list();
  }

  /**
   * Moves a skill from the first agent folder that has it into the library and links it back there
   * (and into the other folders that held a symlink to the same place). Plain copies elsewhere stay.
   */
  async adopt(name: string): Promise<SkillLibraryState> {
    const dir = join(this.libraryPath, name);
    if (await exists(dir)) throw new Error(`${name} is already in the skill library`);
    const holders: { id: SkillTargetId; link: string; real: string; symlink: boolean }[] = [];
    for (const target of SKILL_TARGETS) {
      const link = join(await this.targetPath(target.id), name);
      try {
        const info = await lstat(link);
        holders.push({ id: target.id, link, real: await realpath(link), symlink: info.isSymbolicLink() });
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    const first = holders[0];
    if (!first) throw new Error(`${name} was not found in any agent's skills folder`);
    await mkdir(this.libraryPath, { recursive: true });
    if (first.symlink) {
      await cp(first.real, dir, { recursive: true, dereference: true });
    } else {
      await moveDir(first.real, dir);
    }
    const linked: SkillTargetId[] = [];
    for (const holder of holders) {
      if (holder === first || holder.real === first.real) {
        await rm(holder.link, { force: true, recursive: !holder.symlink });
        linked.push(holder.id);
      }
    }
    return this.setTargets(name, linked);
  }

  async search(query: string): Promise<SkillSearchResult[]> {
    const url = new URL(this.options.searchUrl ?? 'https://skills.sh/api/search');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '30');
    const response = await (this.options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`skills.sh search failed (${response.status})`);
    return skillSearchResponseSchema.parse(await response.json()).skills;
  }

  async install(source: string, skillId: string, targets: readonly SkillTargetId[]): Promise<SkillLibraryState> {
    const checkout = await mkdtemp(join(tmpdir(), 'arbora-skill-'));
    try {
      const env = await this.options.env();
      const url = `${this.options.gitBase ?? 'https://github.com/'}${source}.git`;
      await runGit(checkout, env, ['clone', '--depth', '1', '--quiet', url, 'repo']);
      const root = join(checkout, 'repo');
      const candidates = await findSkillDirs(root);
      const picked = pickSkillDir(candidates, skillId);
      if (!picked) throw new Error(`No SKILL.md for ${skillId} in ${source}`);
      const dir = join(this.libraryPath, skillId);
      await mkdir(this.libraryPath, { recursive: true });
      await rm(dir, { recursive: true, force: true });
      await cp(picked, dir, {
        recursive: true,
        filter: (path) => !relative(picked, path).split(/[\\/]/).includes('.git'),
      });
      const lock = await this.readLock();
      lock[skillId] = { source, skillId };
      await this.writeLock(lock);
    } finally {
      await rm(checkout, { recursive: true, force: true });
    }
    return this.setTargets(skillId, targets);
  }

  private async readLock(): Promise<Record<string, LockEntry>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.lockPath, 'utf8'));
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, LockEntry>) : {};
    } catch {
      return {};
    }
  }

  private async writeLock(lock: Record<string, LockEntry>): Promise<void> {
    await mkdir(dirname(this.lockPath), { recursive: true });
    await writeFile(this.lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** Child folders (or links to folders) holding a SKILL.md. */
async function skillDirs(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const out: string[] = [];
  for (const name of entries.sort()) {
    if (name.startsWith('.')) continue;
    if (await exists(join(dir, name, 'SKILL.md'))) out.push(name);
  }
  return out;
}

async function readMeta(dir: string): Promise<{ name: string | null; description: string }> {
  try {
    return parseSkillFrontmatter(await readFile(join(dir, 'SKILL.md'), 'utf8'));
  } catch {
    return { name: null, description: '' };
  }
}

async function findSkillDirs(root: string, depth = 0): Promise<{ dir: string; name: string | null }[]> {
  const out: { dir: string; name: string | null }[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
    out.push({ dir: root, name: (await readMeta(root)).name });
  }
  if (depth >= MAX_DEPTH) return out;
  for (const entry of entries) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      out.push(...(await findSkillDirs(join(root, entry.name), depth + 1)));
    }
  }
  return out;
}

async function moveDir(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await cp(from, to, { recursive: true });
    await rm(from, { recursive: true, force: true });
  }
}
