import { useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';
import type { GitFile, GitHunk, GitStatus, GithubPr } from '@arbora/shared';
import { baseName } from '@arbora/shared';
import { useAgents } from '../agent-store';
import { refreshGit, useGit } from '../git-client';
import { openDiff } from '../files-store';
import { showToast } from '../store';

type Group = 'staged' | 'changes' | 'untracked';

/** A file with both staged and unstaged edits appears in both groups. */
function filesIn(status: GitStatus, group: Group): GitFile[] {
  return status.files.filter((file) => {
    if (group === 'untracked') return file.untracked;
    if (group === 'staged') return file.index !== '.' && file.index !== '!' && !file.untracked;
    return file.worktree !== '.' && file.worktree !== '!' && !file.untracked;
  });
}

export default function GitPanel({ variant }: { variant: 'sidebar' | 'panel' }) {
  const status = useGit((s) => s.status);
  const branches = useGit((s) => s.branches);
  const log = useGit((s) => s.log);
  const stashes = useGit((s) => s.stashes);
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prs, setPrs] = useState<GithubPr[] | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);
  const agentFiles = useAgents((s) => s.changedFiles);

  async function run(action: () => Promise<{ ok: boolean; output: string } | undefined>): Promise<void> {
    setBusy(true);
    try {
      const result = await action();
      if (result && !result.ok) showToast(result.output || 'Git command failed');
      await refreshGit();
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <p className="p-3 text-xs text-fg-subtle">Loading git…</p>;
  if (!status.repo) {
    return <p className="p-3 text-xs text-fg-muted">{status.error ?? 'This folder is not a git repository.'}</p>;
  }

  const agentPaths = [...new Set(agentFiles.map((file) => file.path))].filter((path) =>
    status.files.some((file) => file.path === path),
  );

  return (
    <div className="flex h-full flex-col overflow-hidden text-xs" data-testid="git-panel">
      <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <GitBranch className="size-3.5 shrink-0 text-fg-subtle" />
        <select
          aria-label="Branch"
          className="min-w-0 flex-1 truncate bg-transparent text-fg outline-none"
          value={status.branch ?? ''}
          disabled={busy || status.detached}
          onChange={(event) => void run(() => window.arbora.invoke('git.checkout', { name: event.target.value }))}
        >
          {status.detached && <option value="">detached</option>}
          {(branches.length > 0 ? branches : status.branch ? [{ name: status.branch, current: true }] : []).map(
            (branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ),
          )}
        </select>
        <span className="shrink-0 tabular-nums text-fg-subtle">
          {status.ahead > 0 ? `+${status.ahead}` : ''}
          {status.behind > 0 ? ` -${status.behind}` : ''}
        </span>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-bg-muted"
          disabled={busy}
          onClick={() => void run(() => window.arbora.invoke('git.fetch'))}
        >
          Fetch
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-bg-muted"
          disabled={busy}
          onClick={() => void run(() => window.arbora.invoke('git.pull'))}
        >
          Pull
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-bg-muted"
          disabled={busy}
          onClick={() => void run(() => window.arbora.invoke('git.push'))}
        >
          Push
        </button>
      </header>
      <div className="shrink-0 border-b border-border p-2">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Commit message"
          rows={variant === 'sidebar' ? 2 : 3}
          className="w-full resize-none rounded border border-border bg-bg px-2 py-1 text-fg outline-none focus-visible:border-accent"
        />
        <div className="mt-1 flex items-center gap-2">
          <label className="flex items-center gap-1 text-fg-muted">
            <input type="checkbox" checked={amend} onChange={(event) => setAmend(event.target.checked)} />
            Amend
          </label>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-fg-muted hover:bg-bg-muted"
            disabled={busy}
            onClick={() => void generateMessage(setMessage)}
          >
            Generate
          </button>
          <button
            type="button"
            className="ml-auto rounded bg-accent px-2 py-0.5 text-accent-fg disabled:opacity-50"
            disabled={busy || message.trim() === ''}
            onClick={() =>
              void run(async () => {
                const result = await window.arbora.invoke('git.commit', { message: message.trim(), amend });
                if (result.ok) setMessage('');
                return result;
              })
            }
          >
            Commit
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <TrackedArboraNotice status={status} busy={busy} run={run} />
        <Section
          title="Staged"
          files={filesIn(status, 'staged')}
          staged
          busy={busy}
          onChange={() => void refreshGit()}
        />
        <Section
          title="Changes"
          files={filesIn(status, 'changes')}
          staged={false}
          busy={busy}
          onChange={() => void refreshGit()}
        />
        <Section
          title="Untracked"
          files={filesIn(status, 'untracked')}
          staged={false}
          busy={busy}
          onChange={() => void refreshGit()}
        />
        <div className="border-b border-border px-2 py-1.5">
          <div className="mb-1 flex items-center gap-2 font-medium text-fg">
            Agent changes
            <button
              type="button"
              className="ml-auto font-normal text-fg-muted hover:text-fg"
              disabled={agentPaths.length === 0 || busy}
              onClick={() =>
                void run(async () => {
                  await window.arbora.invoke('git.stage', { paths: agentPaths });
                })
              }
            >
              Accept all
            </button>
            <button
              type="button"
              className="font-normal text-fg-muted hover:text-fg"
              disabled={agentPaths.length === 0 || busy}
              onClick={() => {
                if (!window.confirm(`Discard ${agentPaths.length} agent change${agentPaths.length === 1 ? '' : 's'}?`))
                  return;
                void run(async () => {
                  await window.arbora.invoke('git.discard', { paths: agentPaths });
                });
              }}
            >
              Revert
            </button>
          </div>
          {agentPaths.length === 0 ? (
            <p className="text-fg-subtle">No files from this session's agent turns.</p>
          ) : (
            agentPaths.map((path) => (
              <FileRow key={path} path={path} letter="A" onOpen={() => void openChange(path, false)} />
            ))
          )}
        </div>
        {stashes.length > 0 && (
          <div className="border-b border-border px-2 py-1.5">
            <p className="mb-1 font-medium">Stash</p>
            {stashes.map((stash) => (
              <div key={stash.index} className="flex items-center gap-2 py-0.5">
                <span className="min-w-0 flex-1 truncate" title={stash.message}>
                  {stash.message}
                </span>
                <button
                  type="button"
                  className="text-fg-muted hover:text-fg"
                  onClick={() =>
                    void run(() => window.arbora.invoke('git.stashApply', { index: stash.index, pop: true }))
                  }
                >
                  Pop
                </button>
                <button
                  type="button"
                  className="text-fg-muted hover:text-fg"
                  onClick={() => void run(() => window.arbora.invoke('git.stashDrop', { index: stash.index }))}
                >
                  Drop
                </button>
              </div>
            ))}
          </div>
        )}
        {variant === 'panel' && (
          <div className="border-b border-border px-2 py-1.5">
            <p className="mb-1 font-medium">History</p>
            {log.map((commit) => (
              <div key={commit.hash} className="flex gap-2 py-0.5" title={commit.hash}>
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-accent" />
                <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
                <span className="shrink-0 text-fg-subtle">{commit.hash.slice(0, 7)}</span>
              </div>
            ))}
          </div>
        )}
        <GithubSection
          prs={prs}
          error={githubError}
          busy={busy}
          onLoad={() => void loadGithub(setPrs, setGithubError)}
          onCreate={(title, body) =>
            void run(async () => {
              const created = await window.arbora.invoke('git.createPullRequest', { title, body });
              showToast(created.url);
              await loadGithub(setPrs, setGithubError);
              return { ok: true, output: created.url };
            })
          }
        />
      </div>
    </div>
  );
}

/**
 * `.arbora/.gitignore` only stops new files; ones committed before it stay tracked, so offer to
 * remove them from the index (the files stay on disk).
 */
function TrackedArboraNotice({
  status,
  busy,
  run,
}: {
  status: GitStatus;
  busy: boolean;
  run: (action: () => Promise<{ ok: boolean; output: string } | undefined>) => Promise<void>;
}) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    void window.arbora
      .invoke('git.arboraTracked')
      .then((result) => {
        if (live) setCount(result.count);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [status]);
  if (count === 0) return null;
  return (
    <div
      className="flex items-center gap-2 border-b border-border bg-attention-soft px-2 py-1.5 text-attention"
      data-testid="git-arbora-tracked"
    >
      <span className="min-w-0 flex-1">
        {count} file{count === 1 ? '' : 's'} in .arbora {count === 1 ? 'is' : 'are'} committed. Arbora keeps that folder
        out of git.
      </span>
      <button
        type="button"
        disabled={busy}
        title="Runs git rm -r --cached .arbora. The files stay on disk; commit to record it."
        className="shrink-0 rounded border border-current px-1.5 py-0.5 hover:bg-bg/40"
        onClick={() => void run(() => window.arbora.invoke('git.untrackArbora'))}
      >
        Stop tracking
      </button>
    </div>
  );
}

function Section({
  title,
  files,
  staged,
  busy,
  onChange,
}: {
  title: string;
  files: GitFile[];
  staged: boolean;
  busy: boolean;
  onChange: () => void;
}) {
  return (
    <div className="border-b border-border px-2 py-1.5">
      <p className="mb-1 font-medium">{title}</p>
      {files.length === 0 ? (
        <p className="text-fg-subtle">None</p>
      ) : (
        files.map((file) => (
          <ChangeRow key={`${title}:${file.path}`} file={file} staged={staged} busy={busy} onChange={onChange} />
        ))
      )}
    </div>
  );
}

function ChangeRow({
  file,
  staged,
  busy,
  onChange,
}: {
  file: GitFile;
  staged: boolean;
  busy: boolean;
  onChange: () => void;
}) {
  const [hunks, setHunks] = useState<GitHunk[] | null>(null);
  const letter = staged ? file.index : file.untracked ? 'U' : file.worktree;
  return (
    <div className="py-0.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-testid="git-file"
          data-path={file.path}
          className="min-w-0 flex-1 truncate text-left hover:text-accent"
          title={file.path}
          onClick={() => void openChange(file.path, staged)}
        >
          <span className="mr-1 font-mono text-fg-subtle">{letter}</span>
          {baseName(file.path)}
          <span className="ml-1 text-fg-subtle">
            {file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''}
          </span>
        </button>
        {!file.untracked && (
          <button
            type="button"
            className="text-fg-muted hover:text-fg"
            disabled={busy}
            onClick={() => void toggleHunks(file.path, staged, hunks, setHunks)}
          >
            Hunks
          </button>
        )}
        <button
          type="button"
          className="text-fg-muted hover:text-fg"
          disabled={busy}
          onClick={() =>
            void window.arbora
              .invoke(staged ? 'git.unstage' : 'git.stage', { paths: [file.path] })
              .then(onChange)
              .catch((error: unknown) => showToast((error as Error).message))
          }
        >
          {staged ? 'Unstage' : 'Stage'}
        </button>
        <button
          type="button"
          className="text-fg-muted hover:text-fg"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(`Discard changes to ${file.path}?`)) return;
            void window.arbora.invoke('git.discard', { paths: [file.path] }).then(onChange);
          }}
        >
          Discard
        </button>
      </div>
      {hunks?.map((hunk) => (
        <button
          key={hunk.index}
          type="button"
          className="mt-0.5 block w-full truncate rounded px-2 py-0.5 text-left font-mono text-[10px] text-fg-muted hover:bg-bg-muted"
          onClick={() =>
            void window.arbora
              .invoke('git.stageHunk', { path: file.path, index: hunk.index, staged })
              .then(onChange)
              .catch((error: unknown) => showToast((error as Error).message))
          }
        >
          {staged ? 'Unstage' : 'Stage'} {hunk.header}
        </button>
      ))}
    </div>
  );
}

function FileRow({ path, letter, onOpen }: { path: string; letter: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-1 truncate py-0.5 text-left hover:text-accent"
      onClick={onOpen}
    >
      <span className="font-mono text-fg-subtle">{letter}</span>
      {path}
    </button>
  );
}

function GithubSection({
  prs,
  error,
  busy,
  onLoad,
  onCreate,
}: {
  prs: GithubPr[] | null;
  error: string | null;
  busy: boolean;
  onLoad: () => void;
  onCreate: (title: string, body: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <div className="px-2 py-1.5">
      <div className="mb-1 flex items-center gap-2">
        <p className="font-medium">GitHub</p>
        <button type="button" className="text-fg-muted hover:text-fg" disabled={busy} onClick={onLoad}>
          {prs ? 'Refresh' : 'Load'}
        </button>
      </div>
      {error && <p className="text-fg-subtle">{error}</p>}
      {prs?.map((pr) => (
        <button
          key={pr.number}
          type="button"
          className="block w-full truncate py-0.5 text-left hover:text-accent"
          onClick={() =>
            void window.arbora
              .invoke('git.checks', { number: pr.number })
              .then((checks) => {
                const summary = checks.map((check) => `${check.name}: ${check.conclusion ?? check.status}`).join(', ');
                showToast(summary || `PR #${pr.number} has no checks`);
                window.open(pr.url, '_blank', 'noopener');
              })
              .catch((loadError: unknown) => showToast((loadError as Error).message))
          }
        >
          #{pr.number} {pr.title}
        </button>
      ))}
      <button type="button" className="mt-1 text-fg-muted hover:text-fg" onClick={() => setOpen((value) => !value)}>
        New pull request
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-1">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title"
            className="rounded border border-border bg-bg px-2 py-1"
          />
          <button
            type="button"
            className="self-start rounded bg-bg-muted px-2 py-0.5 disabled:opacity-50"
            disabled={title.trim() === '' || busy}
            onClick={() => onCreate(title.trim(), '')}
          >
            Create
          </button>
        </div>
      )}
    </div>
  );
}

async function openChange(path: string, staged: boolean): Promise<void> {
  const sides = await window.arbora.invoke('git.sides', { path, staged });
  openDiff({
    path,
    title: path,
    left: sides.left,
    right: sides.right,
    leftLabel: 'HEAD',
    rightLabel: staged ? 'Staged' : 'Worktree',
  });
}

async function toggleHunks(
  path: string,
  staged: boolean,
  current: GitHunk[] | null,
  setHunks: (hunks: GitHunk[] | null) => void,
): Promise<void> {
  if (current) {
    setHunks(null);
    return;
  }
  setHunks(await window.arbora.invoke('git.hunks', { path, staged }));
}

async function generateMessage(setMessage: (message: string) => void): Promise<void> {
  const threadId = useAgents.getState().activeThreadId;
  if (!threadId) {
    showToast('Open an agent thread, then generate the message there.');
    return;
  }
  const diff = await window.arbora.invoke('git.diff', { staged: true });
  if (diff.text.trim() === '') {
    showToast('Stage changes before generating a message.');
    return;
  }
  const result = await window.arbora.invoke('agent.prompt', {
    threadId,
    blocks: [
      {
        type: 'text',
        text: `Write a one-line git commit message for this staged diff. Reply with only the message.\n\n${diff.text.slice(0, 20_000)}`,
      },
    ],
  });
  if (result.error) {
    showToast(result.error);
    return;
  }
  const thread = await window.arbora.invoke('agent.getThread', { threadId });
  const message = [...(thread?.events ?? [])].reverse().find((event) => event.kind === 'agent_message');
  const text =
    message?.kind === 'agent_message'
      ? message.blocks
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n')
          .trim()
      : '';
  if (text) setMessage(text.split('\n')[0] ?? text);
  else showToast('The agent did not return a message.');
}

async function loadGithub(setPrs: (prs: GithubPr[]) => void, setError: (error: string | null) => void): Promise<void> {
  const auth = await window.arbora.invoke('git.github');
  if (!auth.available) {
    setError(auth.error ?? 'GitHub CLI is not signed in. Run gh auth login.');
    return;
  }
  try {
    setPrs(await window.arbora.invoke('git.pullRequests'));
    setError(null);
  } catch (error) {
    setError((error as Error).message);
  }
}
