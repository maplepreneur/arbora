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
