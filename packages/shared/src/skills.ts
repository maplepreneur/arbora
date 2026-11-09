import { z } from 'zod';

/**
 * Folders agents read user-level skills from, deduplicated: Codex, Kimi and most others share
 * `~/.agents/skills`. Antigravity reads `~/.gemini/config/skills`. Paths follow the `skills` CLI
 * (skills.sh) where that CLI names a folder, so both tools agree.
 */
export const SKILL_TARGET_IDS = ['claude', 'agents', 'grok', 'opencode', 'antigravity', 'cursor'] as const;
export type SkillTargetId = (typeof SKILL_TARGET_IDS)[number];
export const skillTargetIdSchema = z.enum(SKILL_TARGET_IDS);

export interface SkillTargetDescriptor {
  readonly id: SkillTargetId;
  readonly label: string;
  /** Built-in agent ids that read this folder. */
  readonly agents: readonly string[];
}

export const SKILL_TARGETS: readonly SkillTargetDescriptor[] = [
  { id: 'claude', label: 'Claude Code', agents: ['claude-code'] },
  { id: 'agents', label: 'Codex, Kimi', agents: ['codex', 'kimi'] },
  { id: 'grok', label: 'Grok', agents: ['grok'] },
  { id: 'opencode', label: 'OpenCode', agents: ['opencode'] },
  { id: 'antigravity', label: 'Antigravity', agents: ['antigravity'] },
  { id: 'cursor', label: 'Cursor', agents: [] },
];

export interface SkillPathEnv {
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

function joinPath(...parts: string[]): string {
  const sep = parts[0]?.includes('\\') && !parts[0].includes('/') ? '\\' : '/';
  return parts
    .map((part, i) => (i === 0 ? part.replace(/[\\/]+$/, '') : part.replace(/^[\\/]+|[\\/]+$/g, '')))
    .join(sep);
}

/** The agent's own home folder (whether it exists says the agent is installed) and its skills folder. */
export function skillTargetPaths(id: SkillTargetId, { home, env }: SkillPathEnv): { root: string; skills: string } {
  const configHome = env['XDG_CONFIG_HOME']?.trim() || joinPath(home, '.config');
  switch (id) {
    case 'claude': {
      const root = env['CLAUDE_CONFIG_DIR']?.trim() || joinPath(home, '.claude');
      return { root, skills: joinPath(root, 'skills') };
    }
    case 'agents':
      return { root: joinPath(home, '.agents'), skills: joinPath(home, '.agents', 'skills') };
    case 'grok': {
      const root = env['GROK_HOME']?.trim() || joinPath(home, '.grok');
      return { root, skills: joinPath(root, 'skills') };
    }
    case 'opencode': {
      const root = joinPath(configHome, 'opencode');
      return { root, skills: joinPath(root, 'skills') };
    }
    case 'antigravity':
      // The CLI's own data dir says it has been run. Skills live in the folder the CLI and the
      // Antigravity app both read (https://antigravity.google/docs/skills/).
      return {
        root: joinPath(home, '.gemini', 'antigravity-cli'),
        skills: joinPath(home, '.gemini', 'config', 'skills'),
      };
    case 'cursor':
      return { root: joinPath(home, '.cursor'), skills: joinPath(home, '.cursor', 'skills') };
    default: {
      const never: never = id;
      throw new Error(`unknown skill target ${String(never)}`);
    }
  }
}

/** Skill folder names: what `npx skills add` and the agents accept, and safe as a path segment. */
export const skillNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'letters, digits, dot, dash and underscore only');

/** `linked`: our symlink into the library. `other`: a different folder with the same name. */
export const skillLinkStateSchema = z.enum(['linked', 'other', 'none']);
export type SkillLinkState = z.infer<typeof skillLinkStateSchema>;

export const skillTargetSchema = z.object({
  id: skillTargetIdSchema,
  label: z.string(),
  path: z.string(),
  /** The agent's home folder exists. */
  installed: z.boolean(),
});
export type SkillTarget = z.infer<typeof skillTargetSchema>;

export const librarySkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
  /** The skills.sh id it was installed from (`owner/repo/skill`), when known. */
  source: z.string().nullable(),
  links: z.record(skillTargetIdSchema, skillLinkStateSchema),
});
export type LibrarySkill = z.infer<typeof librarySkillSchema>;

/** A skill in an agent's folder that is not in Arbora's library (yet). */
export const foundSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  targets: z.array(skillTargetIdSchema),
});
export type FoundSkill = z.infer<typeof foundSkillSchema>;

export const skillLibrarySchema = z.object({
  libraryPath: z.string(),
  targets: z.array(skillTargetSchema),
  skills: z.array(librarySkillSchema),
  found: z.array(foundSkillSchema),
});
export type SkillLibrary = z.infer<typeof skillLibrarySchema>;

export const skillSearchResultSchema = z.object({
  /** `owner/repo/skill`. */
  id: z.string(),
  /** `owner/repo` on GitHub. */
  source: z.string(),
  skillId: z.string(),
  name: z.string(),
  installs: z.number().int().nonnegative().default(0),
});
export type SkillSearchResult = z.infer<typeof skillSearchResultSchema>;

export const skillSearchResponseSchema = z.object({ skills: z.array(skillSearchResultSchema).default([]) });

/** `owner/repo` as skills.sh reports it. */
export const skillSourceSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'expected owner/repo')
  .refine((value) => !value.split('/').some((part) => part === '.' || part === '..'), 'expected owner/repo');

/** `name` and `description` from a SKILL.md YAML front matter block (single-line or folded values). */
export function parseSkillFrontmatter(text: string): { name: string | null; description: string } {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match?.[1]) return { name: null, description: '' };
  const fields = new Map<string, string>();
  let current: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (field?.[1] !== undefined) {
      current = field[1];
      fields.set(current, field[2] ?? '');
    } else if (current && /^\s+\S/.test(line)) {
      fields.set(current, `${fields.get(current) ?? ''} ${line.trim()}`);
    } else {
      current = null;
    }
  }
  const clean = (value: string | undefined): string =>
    (value ?? '')
      .trim()
      .replace(/^[|>][+-]?\s*/, '')
      .replace(/^(['"])([\s\S]*)\1$/, '$2')
      .trim();
  const name = clean(fields.get('name'));
  return { name: name || null, description: clean(fields.get('description')) };
}

/** Picks the folder for `skillId` among the SKILL.md folders of a cloned repository. */
export function pickSkillDir(
  candidates: readonly { dir: string; name: string | null }[],
  skillId: string,
): string | undefined {
  const base = (dir: string): string => dir.split(/[\\/]/).filter(Boolean).pop() ?? '';
  const lower = skillId.toLowerCase();
  return (
    candidates.find((c) => c.name?.toLowerCase() === lower)?.dir ??
    candidates.find((c) => base(c.dir).toLowerCase() === lower)?.dir ??
    (candidates.length === 1 ? candidates[0]?.dir : undefined)
  );
}
