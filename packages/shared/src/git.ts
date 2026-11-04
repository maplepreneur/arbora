import { z } from 'zod';

/** Git status, diffs and GitHub rows (Stage 8). Paths are project-relative with `/`. */

export const gitFileSchema = z.object({
  path: z.string(),
  /** Previous path when the entry is a rename. */
  origPath: z.string().optional(),
  /** Index status letter. `.` means the index matches HEAD. */
  index: z.string(),
  /** Worktree status letter. `.` means the worktree matches the index. */
  worktree: z.string(),
  untracked: z.boolean(),
  conflict: z.boolean(),
});
export type GitFile = z.infer<typeof gitFileSchema>;

export const gitStatusSchema = z.object({
  /** False when the project is not inside a git repository, or git is missing. */
  repo: z.boolean(),
  branch: z.string().nullable(),
  detached: z.boolean(),
  upstream: z.string().nullable(),
  ahead: z.number().int(),
  behind: z.number().int(),
  files: z.array(gitFileSchema),
  error: z.string().optional(),
});
export type GitStatus = z.infer<typeof gitStatusSchema>;

export const gitDecorationSchema = z.object({
  letter: z.string(),
  tone: z.enum(['added', 'modified', 'deleted', 'ignored']),
});
export type GitDecoration = z.infer<typeof gitDecorationSchema>;

export const gitHunkSchema = z.object({
  index: z.number().int(),
  header: z.string(),
  text: z.string(),
});
export type GitHunk = z.infer<typeof gitHunkSchema>;

export const gitBranchSchema = z.object({
  name: z.string(),
  current: z.boolean(),
});
export type GitBranch = z.infer<typeof gitBranchSchema>;

export const gitCommitSchema = z.object({
  hash: z.string(),
  parents: z.array(z.string()),
  author: z.string(),
  at: z.number().int(),
  subject: z.string(),
});
export type GitCommit = z.infer<typeof gitCommitSchema>;

export const gitStashSchema = z.object({
  index: z.number().int(),
  message: z.string(),
});
export type GitStash = z.infer<typeof gitStashSchema>;

export const gitRemoteSchema = z.object({
  name: z.string(),
  fetch: z.string(),
});
export type GitRemote = z.infer<typeof gitRemoteSchema>;

export const gitResultSchema = z.object({
  ok: z.boolean(),
  output: z.string(),
});
export type GitResult = z.infer<typeof gitResultSchema>;

export const githubAuthSchema = z.object({
  available: z.boolean(),
  login: z.string().nullable(),
  error: z.string().optional(),
});
export type GithubAuth = z.infer<typeof githubAuthSchema>;

export const githubPrSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  head: z.string(),
});
export type GithubPr = z.infer<typeof githubPrSchema>;

export const githubCheckSchema = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
});
export type GithubCheck = z.infer<typeof githubCheckSchema>;

export const gitLineSchema = z.object({
  line: z.number().int().positive(),
  kind: z.enum(['added', 'modified']),
});
export type GitLine = z.infer<typeof gitLineSchema>;

/** Explorer letter for one status entry. Worktree wins over the index. */
export function decorationFor(file: GitFile): GitDecoration {
  if (file.untracked) return { letter: 'U', tone: 'added' };
  if (file.conflict) return { letter: 'C', tone: 'modified' };
  const letter = file.worktree !== '.' ? file.worktree : file.index;
  if (letter === 'D') return { letter, tone: 'deleted' };
  if (letter === 'A' || letter === 'R' || letter === 'C' || letter === '?') return { letter, tone: 'added' };
  if (letter === '!') return { letter, tone: 'ignored' };
  return { letter: letter === '.' ? 'M' : letter, tone: 'modified' };
}

/** What the background sync does after a fetch: fast-forward only a clean branch that is only behind. */
export function shouldAutoPull(status: GitStatus): boolean {
  return (
    status.repo &&
    !status.detached &&
    status.upstream !== null &&
    status.behind > 0 &&
    status.ahead === 0 &&
    status.files.every((file) => file.untracked)
  );
}

export const gitGenerateKindSchema = z.enum(['commit', 'pullRequest']);
export type GitGenerateKind = z.infer<typeof gitGenerateKindSchema>;

export const generatedTextSchema = z.object({
  title: z.string(),
  body: z.string(),
});
export type GeneratedText = z.infer<typeof generatedTextSchema>;

/** Characters of diff sent to a model; the stat line list always goes first. */
export const GENERATE_DIFF_LIMIT = 24_000;

export function commitMessagePrompt(stat: string, diff: string): string {
  return [
    'Write a git commit message for the staged changes below.',
    'Reply with only the message: a subject line of at most 72 characters in the imperative mood, then optionally a blank line and a short body.',
    'Do not use Markdown code fences, do not run tools, and do not change any files.',
    '',
    'Files:',
    stat.trim(),
    '',
    'Diff:',
    clip(diff, GENERATE_DIFF_LIMIT),
  ].join('\n');
}

export function pullRequestPrompt(branch: string, base: string, log: string, stat: string, diff: string): string {
  return [
    `Write a GitHub pull request title and description for branch ${branch} into ${base}.`,
    'Reply with only the title on the first line (at most 72 characters, no prefix), a blank line, then a Markdown description: what changed and why, and how it was tested if the commits say.',
    'Do not run tools and do not change any files.',
    '',
    'Commits:',
    log.trim(),
    '',
    'Files:',
    stat.trim(),
    '',
    'Diff:',
    clip(diff, GENERATE_DIFF_LIMIT),
  ].join('\n');
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[diff truncated]`;
}

/** Splits an agent's reply into a title and body, dropping code fences, quotes and `Title:` labels. */
export function parseGeneratedText(reply: string): GeneratedText {
  const lines = reply
    .replace(/^```[^\n]*\n?/gm, '')
    .trim()
    .split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first === -1) return { title: '', body: '' };
  const title = (lines[first] ?? '')
    .trim()
    .replace(/^(#+\s*|(?:commit message|subject|title)\s*:\s*)/i, '')
    .replace(/^["'`](.*)["'`]$/, '$1')
    .trim();
  const body = lines
    .slice(first + 1)
    .join('\n')
    .replace(/^\s*(?:body|description)\s*:\s*/i, '')
    .trim();
  return { title, body };
}

/** A branch name for a generated pull request title, under `arbora/`. */
export function branchNameFor(title: string, taken: readonly string[] = []): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/, '') || 'changes';
  const base = `arbora/${slug}`;
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** One background fetch (and maybe fast-forward pull) of the open project. */
export const gitSyncResultSchema = z.object({
  at: z.number().int(),
  pulled: z.boolean(),
  error: z.string().optional(),
});
export type GitSyncResult = z.infer<typeof gitSyncResultSchema>;
