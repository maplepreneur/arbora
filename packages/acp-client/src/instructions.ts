export interface PrefaceContext {
  readonly projectPath: string;
  /** The dev server URL loaded in Arbora's browser panel, if one is running. */
  readonly devUrl: string | null;
}

/** Agents read Windows paths fine either way, but prompts read better with forward slashes. */
export function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}

/** First line of the preface; agents that title a thread after its first prompt echo it. */
export const PREFACE_OPENING = 'You are working inside Arbora';

/** Whether an agent-supplied thread title is just the preface read back. */
export function isPrefaceTitle(title: string): boolean {
  return title.trimStart().startsWith(PREFACE_OPENING);
}

/**
 * Short preface sent with the first prompt of every thread. Stage 5 extends it with the browser
 * tools and the verify loop.
 */
export function firstPromptPreface(context: PrefaceContext): string {
  const project = toPosixPath(context.projectPath);
  const dev = context.devUrl
    ? `The project's dev server is running and Arbora's embedded browser shows ${context.devUrl}.`
    : 'No dev server is running yet; the user can start one from the Terminal panel.';
  return [
    `${PREFACE_OPENING}, a desktop app for building web apps by pointing at the running page.`,
    `The project folder (your working directory) is ${project}. Use absolute paths.`,
    dev,
    'Edit source files directly; the dev server hot-reloads. Keep replies concise and mention which files you changed.',
  ].join('\n');
}
