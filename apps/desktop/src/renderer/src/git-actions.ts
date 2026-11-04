import { branchNameFor, type GeneratedText, type GitResult } from '@arbora/shared';
import { refreshGit, useGit } from './git-client';
import { ipcError } from './ipc-error';
import { showToast } from './store';

class GitActionError extends Error {}

/** Runs one Git action at a time, with `label` shown in the panel header, and reports failures. */
async function action<T>(label: string, run: () => Promise<T>): Promise<T | undefined> {
  if (useGit.getState().busy !== null) {
    showToast(`Git is busy: ${useGit.getState().busy ?? ''}`);
    return undefined;
  }
  useGit.setState({ busy: label });
  try {
    return await run();
  } catch (error) {
    showToast(error instanceof GitActionError ? error.message : ipcError(error));
    return undefined;
  } finally {
    useGit.setState({ busy: null });
    await refreshGit();
  }
}

function step(label: string): void {
  useGit.setState({ busy: label });
}

function check(result: GitResult, what: string): GitResult {
  if (!result.ok) throw new GitActionError(`${what} failed: ${result.output || 'git exited with an error'}`);
  return result;
}

function commitText(text: GeneratedText): string {
  return text.body ? `${text.title}\n\n${text.body}` : text.title;
}

async function stagedCount(): Promise<number> {
  const status = await refreshGit();
  return status?.files.filter((f) => f.index !== '.' && f.index !== '!' && !f.untracked).length ?? 0;
}

export function stageAll(): Promise<void> {
  return action('Staging…', async () => {
    await window.arbora.invoke('git.stageAll');
    showToast('Staged all changes');
  }).then(() => undefined);
}

/** Commits the staged changes with the message box; an empty box gets a generated message to review. */
export function commitStaged(amend = false): Promise<void> {
  const message = useGit.getState().message.trim();
  if (message === '') return generateCommitMessage(true);
  return action('Committing…', async () => {
    const result = check(await window.arbora.invoke('git.commit', { message, amend }), 'Commit');
    useGit.setState({ message: '' });
    showToast(result.output.split('\n')[0] || 'Committed');
  }).then(() => undefined);
}

/** Fills the message box from the Git task agent; nothing is sent to a visible thread. */
export function generateCommitMessage(focus = false): Promise<void> {
  return action('Writing a commit message…', async () => {
    if ((await stagedCount()) === 0) throw new GitActionError('Stage changes before generating a message.');
    step('Writing a commit message…');
    const text = await window.arbora.invoke('git.generate', { kind: 'commit' });
    useGit.setState((s) => ({ message: commitText(text), focusMessage: focus ? s.focusMessage + 1 : s.focusMessage }));
  }).then(() => undefined);
}

export function push(): Promise<void> {
  return action('Pushing…', async () => {
    check(await window.arbora.invoke('git.push'), 'Push');
    showToast('Pushed');
  }).then(() => undefined);
}

export function pull(): Promise<void> {
  return action('Pulling…', async () => {
    check(await window.arbora.invoke('git.pull'), 'Pull');
  }).then(() => undefined);
}

export function fetchRemote(): Promise<void> {
  return action('Fetching…', async () => {
    check(await window.arbora.invoke('git.fetch'), 'Fetch');
  }).then(() => undefined);
}

/** The background sync, now (fetch, and a fast-forward pull when that setting is on). */
export function syncNow(): Promise<void> {
  return action('Syncing…', async () => {
    const result = await window.arbora.invoke('git.syncNow');
    if (result) useGit.setState({ lastSync: result });
    if (result?.error) throw new GitActionError(`Sync failed: ${result.error}`);
    showToast(result === null ? 'Nothing to sync: no remote, or sync is off' : result.pulled ? 'Pulled' : 'Up to date');
  }).then(() => undefined);
}

/** `git add -A`, a generated message, commit. Returns the commit subject. */
async function stageAndCommitWithAi(): Promise<string | null> {
  step('Staging…');
  await window.arbora.invoke('git.stageAll');
  if ((await stagedCount()) === 0) return null;
  step('Writing a commit message…');
  const text = await window.arbora.invoke('git.generate', { kind: 'commit' });
  step('Committing…');
  check(await window.arbora.invoke('git.commit', { message: commitText(text), amend: false }), 'Commit');
  return text.title;
}

export function aiCommit(): Promise<void> {
  return action('Staging…', async () => {
    const subject = await stageAndCommitWithAi();
    if (subject === null) throw new GitActionError('No changes to commit.');
    showToast(`Committed: ${subject}`);
  }).then(() => undefined);
}

/**
 * Stages everything, commits with a generated message, moves the work to a new `arbora/…` branch
 * when it is on the default branch, pushes, and opens a pull request with generated text.
 */
export function aiPullRequest(): Promise<void> {
  return action('Checking GitHub…', async () => {
    const auth = await window.arbora.invoke('git.github');
    if (!auth.available) throw new GitActionError(auth.error ?? 'Sign in to GitHub with gh auth login first.');
    const status = await refreshGit();
    if (!status?.repo) throw new GitActionError('This folder is not a git repository.');
    if (status.detached) throw new GitActionError('Check out a branch first: HEAD is detached.');
    const base = (await window.arbora.invoke('git.defaultBranch')) ?? 'main';
    const hasChanges = status.files.length > 0;
    if (status.branch === base) {
      if (!hasChanges) throw new GitActionError(`No changes to open a pull request for on ${base}.`);
      step('Writing a commit message…');
      await window.arbora.invoke('git.stageAll');
      const text = await window.arbora.invoke('git.generate', { kind: 'commit' });
      const branches = (await window.arbora.invoke('git.branches')).map((b) => b.name);
      const branch = branchNameFor(text.title, branches);
      step(`Creating ${branch}…`);
      check(await window.arbora.invoke('git.createBranch', { name: branch }), 'Creating the branch');
      step('Committing…');
      check(await window.arbora.invoke('git.commit', { message: commitText(text), amend: false }), 'Commit');
    } else if (hasChanges) {
      await stageAndCommitWithAi();
    }
    step('Pushing…');
    check(await window.arbora.invoke('git.push'), 'Push');
    step('Writing the pull request…');
    const pr = await window.arbora.invoke('git.generate', { kind: 'pullRequest' });
    step('Opening the pull request…');
    const created = await window.arbora.invoke('git.createPullRequest', { title: pr.title, body: pr.body });
    showToast(`Opened ${created.url}`, { label: 'Open', run: () => window.open(created.url, '_blank', 'noopener') });
  }).then(() => undefined);
}
