import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitPullRequest,
  ListTree,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import {
  baseName,
  CommandId,
  decorationFor,
  type GitFile,
  type GitHunk,
  type GitStatus,
  type GithubPr,
} from '@arbora/shared';
import { useAgents } from '../agent-store';
import { PullRequestUsage } from '../components/UsageBadge';
import { openDiff } from '../files-store';
import { aiPullRequest, commitStaged, fetchRemote, generateCommitMessage, pull, push, stageAll } from '../git-actions';
import { refreshGit, useGit } from '../git-client';
import { ipcError } from '../ipc-error';
import { useChordLabel } from '../keybindings';
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

function withChord(label: string, chord: string | undefined): string {
  return chord ? `${label} (${chord})` : label;
}

export default function GitPanel({ variant }: { variant: 'sidebar' | 'panel' }) {
  const status = useGit((s) => s.status);
  const branches = useGit((s) => s.branches);
  const log = useGit((s) => s.log);
  const stashes = useGit((s) => s.stashes);
  const busy = useGit((s) => s.busy);
  const agentFiles = useAgents((s) => s.changedFiles);

  async function run(fn: () => Promise<{ ok: boolean; output: string } | undefined>): Promise<void> {
    try {
      const result = await fn();
      if (result && !result.ok) showToast(result.output || 'Git command failed');
    } catch (error) {
      showToast(ipcError(error));
    } finally {
      await refreshGit();
    }
  }

  if (!status) return <p className="p-3 text-xs text-fg-subtle">Loading git…</p>;
  if (!status.repo) {
    return <p className="p-3 text-xs text-fg-muted">{status.error ?? 'This folder is not a git repository.'}</p>;
  }

  const agentPaths = [...new Set(agentFiles.map((file) => file.path))].filter((path) =>
    status.files.some((file) => file.path === path),
  );
  const staged = filesIn(status, 'staged');
  const changes = filesIn(status, 'changes');
  const untracked = filesIn(status, 'untracked');
  const disabled = busy !== null;

  return (
    <div className="flex h-full flex-col overflow-hidden text-xs" data-testid="git-panel">
      <header className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
        <GitBranch className="size-3.5 shrink-0 text-fg-subtle" />
        <select
          aria-label="Branch"
          className="min-w-0 flex-1 truncate bg-transparent font-medium text-fg outline-none"
          value={status.branch ?? ''}
          disabled={disabled || status.detached}
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
        <SyncButtons status={status} disabled={disabled} />
      </header>
      <StatusLine status={status} />
      <CommitBox variant={variant} stagedCount={staged.length} changeCount={status.files.length} />
      <div className="min-h-0 flex-1 overflow-auto">
        <TrackedArboraNotice status={status} disabled={disabled} run={run} />
        <Section
          title="Staged"
          testId="git-section-staged"
          count={staged.length}
          actions={
            <IconButton
              icon={Minus}
              label="Unstage all"
              disabled={disabled || staged.length === 0}
              onClick={() => void run(() => window.arbora.invoke('git.unstage', { paths: staged.map((f) => f.path) }))}
            />
          }
        >
          {staged.map((file) => (
            <ChangeRow key={`staged:${file.path}`} file={file} staged disabled={disabled} />
          ))}
        </Section>
        <Section
          title="Changes"
          testId="git-section-changes"
          count={changes.length}
          actions={
            <IconButton
              icon={Plus}
              label="Stage all changes"
              disabled={disabled || changes.length === 0}
              onClick={() => void run(() => window.arbora.invoke('git.stage', { paths: changes.map((f) => f.path) }))}
            />
          }
        >
          {changes.map((file) => (
            <ChangeRow key={`changes:${file.path}`} file={file} staged={false} disabled={disabled} />
          ))}
        </Section>
        <Section
          title="Untracked"
          testId="git-section-untracked"
          count={untracked.length}
          actions={
            <IconButton
              icon={Plus}
              label="Stage all untracked files"
              disabled={disabled || untracked.length === 0}
              onClick={() => void run(() => window.arbora.invoke('git.stage', { paths: untracked.map((f) => f.path) }))}
            />
          }
        >
          {untracked.map((file) => (
            <ChangeRow key={`untracked:${file.path}`} file={file} staged={false} disabled={disabled} />
          ))}
        </Section>
        <Section
          title="Agent changes"
          testId="git-section-agent"
          count={agentPaths.length}
          empty="No files from this session's agent turns."
          actions={
            <>
              <IconButton
                icon={Check}
                label="Accept all: stage the agent's files"
                disabled={agentPaths.length === 0 || disabled}
                onClick={() =>
                  void run(async () => {
                    await window.arbora.invoke('git.stage', { paths: agentPaths });
                    return undefined;
                  })
                }
              />
              <IconButton
                icon={Undo2}
                label="Revert all agent changes"
                tone="danger"
                disabled={agentPaths.length === 0 || disabled}
                onClick={() => {
                  if (
                    !window.confirm(`Discard ${agentPaths.length} agent change${agentPaths.length === 1 ? '' : 's'}?`)
                  )
                    return;
                  void run(async () => {
                    await window.arbora.invoke('git.discard', { paths: agentPaths });
                    return undefined;
                  });
                }}
              />
            </>
          }
        >
          {agentPaths.map((path) => (
            <FileRow key={path} path={path} onOpen={() => void openChange(path, false)} />
          ))}
        </Section>
        {stashes.length > 0 && (
          <Section title="Stash" testId="git-section-stash" count={stashes.length} defaultOpen={false}>
            {stashes.map((stash) => (
              <div key={stash.index} className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-bg-muted">
                <span className="min-w-0 flex-1 truncate" title={stash.message}>
                  {stash.message}
                </span>
                <IconButton
                  icon={ArchiveRestore}
                  label="Pop: apply and remove"
                  onClick={() =>
                    void run(() => window.arbora.invoke('git.stashApply', { index: stash.index, pop: true }))
                  }
                />
                <IconButton
                  icon={Trash2}
                  label="Drop"
                  tone="danger"
                  onClick={() => void run(() => window.arbora.invoke('git.stashDrop', { index: stash.index }))}
                />
              </div>
            ))}
          </Section>
        )}
        {log.length > 0 && (
          <Section title="History" testId="git-section-history" count={log.length} defaultOpen={variant === 'panel'}>
            {log.map((commit) => (
              <div key={commit.hash} className="flex gap-2 px-1 py-0.5" title={commit.hash}>
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-accent" />
                <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
                <span className="shrink-0 font-mono text-fg-subtle">{commit.hash.slice(0, 7)}</span>
              </div>
            ))}
          </Section>
        )}
        <GithubSection disabled={disabled} />
      </div>
    </div>
  );
}

function SyncButtons({ status, disabled }: { status: GitStatus; disabled: boolean }) {
  const pushChord = useChordLabel(CommandId.gitPush);
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <IconButton
        icon={RefreshCw}
        label="Fetch"
        testId="git-fetch"
        disabled={disabled}
        onClick={() => void fetchRemote()}
      />
      <IconButton
        icon={ArrowDown}
        label={status.behind > 0 ? `Pull ${status.behind} commit${status.behind === 1 ? '' : 's'}` : 'Pull'}
        testId="git-pull"
        disabled={disabled}
        count={status.behind}
        onClick={() => void pull()}
      />
      <IconButton
        icon={ArrowUp}
        label={withChord(
          status.ahead > 0 ? `Push ${status.ahead} commit${status.ahead === 1 ? '' : 's'}` : 'Push',
          pushChord,
        )}
        testId="git-push"
        disabled={disabled}
        count={status.ahead}
        onClick={() => void push()}
      />
    </div>
  );
}

function StatusLine({ status }: { status: GitStatus }) {
  const busy = useGit((s) => s.busy);
  const lastSync = useGit((s) => s.lastSync);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  let text: ReactNode;
  if (busy) {
    text = (
      <span className="flex items-center gap-1 text-accent" data-testid="git-busy">
        <Loader2 className="size-3 animate-spin" />
        {busy}
      </span>
    );
  } else if (lastSync?.error) {
    text = (
      <span className="truncate text-danger" title={lastSync.error}>
        Sync failed: {lastSync.error}
      </span>
    );
  } else {
    const upstream = status.upstream ? `Tracking ${status.upstream}` : 'Not published';
    text = (
      <span className="truncate text-fg-subtle">
        {upstream}
        {lastSync ? ` · ${lastSync.pulled ? 'pulled' : 'fetched'} ${ago(lastSync.at)}` : ''}
      </span>
    );
  }
  return <div className="flex h-6 shrink-0 items-center border-b border-border px-2">{text}</div>;
}

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

function CommitBox({
  variant,
  stagedCount,
  changeCount,
}: {
  variant: 'sidebar' | 'panel';
  stagedCount: number;
  changeCount: number;
}) {
  const message = useGit((s) => s.message);
  const busy = useGit((s) => s.busy);
  const focusMessage = useGit((s) => s.focusMessage);
  const [amend, setAmend] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const commitChord = useChordLabel(CommandId.gitCommit);
  const stageChord = useChordLabel(CommandId.gitStageAll);
  const prChord = useChordLabel(CommandId.gitAiPullRequest);
  useEffect(() => {
    if (focusMessage > 0) input.current?.focus();
  }, [focusMessage]);
  const disabled = busy !== null;
  const canCommit = !disabled && message.trim() !== '' && (stagedCount > 0 || amend);
  return (
    <div className="shrink-0 border-b border-border p-2">
      <div className="relative">
        <textarea
          ref={input}
          value={message}
          data-testid="git-commit-message"
          data-panel-focus
          onChange={(event) => useGit.setState({ message: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (canCommit) void commitStaged(amend);
            }
          }}
          placeholder={
            stagedCount > 0 ? `Message for ${stagedCount} staged file${stagedCount === 1 ? '' : 's'}` : 'Commit message'
          }
          rows={variant === 'sidebar' ? 3 : 4}
          className="w-full resize-none rounded border border-border bg-bg py-1 pr-7 pl-2 text-fg outline-none focus-visible:border-accent"
        />
        <button
          type="button"
          data-testid="git-generate"
          title="Write the message with AI (runs in the background, not in a thread)"
          disabled={disabled}
          onClick={() => void generateCommitMessage(true)}
          className="absolute top-1 right-1 rounded p-1 text-fg-subtle hover:bg-bg-muted hover:text-accent disabled:opacity-40"
        >
          <Sparkles className="size-3.5" />
        </button>
      </div>
      <div className="@container mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          data-testid="git-commit"
          title={withChord('Commit the staged changes', commitChord)}
          disabled={!canCommit}
          onClick={() => void commitStaged(amend)}
          className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded bg-accent px-2 font-medium text-accent-fg disabled:opacity-50"
        >
          <Check className="size-3.5" />
          {amend ? 'Amend' : 'Commit'}
        </button>
        <button
          type="button"
          data-testid="git-stage-all"
          aria-label="Stage all"
          title={withChord('Stage all changes', stageChord)}
          disabled={disabled || changeCount === 0}
          onClick={() => void stageAll()}
          className="flex h-7 items-center gap-1 rounded border border-border px-2 whitespace-nowrap text-fg-muted hover:bg-bg-muted hover:text-fg disabled:opacity-50"
        >
          <Plus className="size-3.5" />
          <span className="hidden @[15rem]:inline">Stage all</span>
        </button>
        <button
          type="button"
          data-testid="git-ai-pr"
          aria-label="AI pull request"
          title={withChord('AI pull request: stage everything, commit, push and open a PR', prChord)}
          disabled={disabled}
          onClick={() => void aiPullRequest()}
          className="flex h-7 items-center gap-1 rounded border border-border px-2 whitespace-nowrap text-fg-muted hover:bg-bg-muted hover:text-fg disabled:opacity-50"
        >
          <GitPullRequest className="size-3.5" />
          <span className="hidden @[15rem]:inline">PR</span>
        </button>
      </div>
      <label className="mt-1.5 flex w-fit items-center gap-1 text-fg-subtle">
        <input type="checkbox" checked={amend} onChange={(event) => setAmend(event.target.checked)} />
        Amend the last commit
      </label>
    </div>
  );
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  tone,
  testId,
  count,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'danger';
  testId?: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={clsx(
        'flex h-6 min-w-6 shrink-0 items-center justify-center gap-0.5 rounded px-1 text-fg-subtle hover:bg-bg-muted disabled:opacity-40',
        tone === 'danger' ? 'hover:text-danger' : 'hover:text-fg',
      )}
    >
      <Icon className="size-3.5" />
      {count !== undefined && count > 0 && <span className="tabular-nums text-[10px] text-fg-muted">{count}</span>}
    </button>
  );
}

function Section({
  title,
  testId,
  count,
  actions,
  empty,
  defaultOpen = true,
  children,
}: {
  title: string;
  testId: string;
  count: number;
  actions?: ReactNode;
  empty?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="border-b border-border py-1" data-testid={testId}>
      <div className="group flex items-center gap-1 px-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-0.5 py-0.5 text-left text-[11px] font-semibold tracking-wide text-fg-muted uppercase hover:text-fg"
        >
          <Chevron className="size-3 shrink-0" />
          {title}
          <span className="ml-1 rounded-full bg-bg-muted px-1.5 text-[10px] font-medium text-fg-subtle tabular-nums">
            {count}
          </span>
        </button>
        <div className="flex items-center opacity-70 group-hover:opacity-100">{actions}</div>
      </div>
      {open && (
        <div className="px-1">
          {count === 0 && <p className="px-5 py-0.5 text-fg-subtle">{empty ?? 'None'}</p>}
          {children}
        </div>
      )}
    </section>
  );
}

const TONE_CLASS = {
  added: 'text-[var(--syn-diff-gutter)]',
  modified: 'text-attention',
  deleted: 'text-danger',
  ignored: 'text-fg-subtle',
} as const;

function ChangeRow({ file, staged, disabled }: { file: GitFile; staged: boolean; disabled: boolean }) {
  const [hunks, setHunks] = useState<GitHunk[] | null>(null);
  const letter = staged ? file.index : file.untracked ? 'U' : file.worktree;
  const tone = decorationFor(staged ? { ...file, worktree: '.' } : file).tone;
  const refresh = (): void => void refreshGit();
  return (
    <div>
      <div className="group flex items-center gap-1 rounded py-0.5 pr-0.5 pl-1 hover:bg-bg-muted">
        <button
          type="button"
          data-testid="git-file"
          data-path={file.path}
          className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left"
          title={file.path}
          onClick={() => void openChange(file.path, staged)}
        >
          <span className={clsx('w-3 shrink-0 text-center font-mono font-semibold', TONE_CLASS[tone])}>{letter}</span>
          <span className="truncate text-fg group-hover:text-accent">{baseName(file.path)}</span>
          <span className="truncate text-fg-subtle">
            {file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''}
          </span>
        </button>
        <div className="flex items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          {!file.untracked && (
            <IconButton
              icon={ListTree}
              label={hunks ? 'Hide hunks' : 'Stage by hunk'}
              disabled={disabled}
              onClick={() => void toggleHunks(file.path, staged, hunks, setHunks)}
            />
          )}
          <IconButton
            icon={Undo2}
            label="Discard changes"
            tone="danger"
            disabled={disabled}
            onClick={() => {
              if (!window.confirm(`Discard changes to ${file.path}?`)) return;
              void window.arbora.invoke('git.discard', { paths: [file.path] }).then(refresh);
            }}
          />
          <IconButton
            icon={staged ? Minus : Plus}
            label={staged ? 'Unstage' : 'Stage'}
            testId={staged ? 'git-unstage' : 'git-stage'}
            disabled={disabled}
            onClick={() =>
              void window.arbora
                .invoke(staged ? 'git.unstage' : 'git.stage', { paths: [file.path] })
                .then(refresh)
                .catch((error: unknown) => showToast(ipcError(error)))
            }
          />
        </div>
      </div>
      {hunks?.map((hunk) => (
        <button
          key={hunk.index}
          type="button"
          className="ml-5 flex w-[calc(100%-1.25rem)] items-center gap-1 truncate rounded px-1.5 py-0.5 text-left font-mono text-[10px] text-fg-muted hover:bg-bg-muted hover:text-fg"
          onClick={() =>
            void window.arbora
              .invoke('git.stageHunk', { path: file.path, index: hunk.index, staged })
              .then(refresh)
              .catch((error: unknown) => showToast(ipcError(error)))
          }
        >
          {staged ? <Minus className="size-3 shrink-0" /> : <Plus className="size-3 shrink-0" />}
          {hunk.header}
        </button>
      ))}
    </div>
  );
}

function FileRow({ path, onOpen }: { path: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-1.5 truncate rounded py-0.5 pl-1 text-left hover:bg-bg-muted hover:text-accent"
      onClick={onOpen}
      title={path}
    >
      <Sparkles className="size-3 shrink-0 text-accent" />
      <span className="truncate">{baseName(path)}</span>
      <span className="truncate text-fg-subtle">{path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''}</span>
    </button>
  );
}

/**
 * `.arbora/.gitignore` only stops new files; ones committed before it stay tracked, so offer to
 * remove them from the index (the files stay on disk).
 */
function TrackedArboraNotice({
  status,
  disabled,
  run,
}: {
  status: GitStatus;
  disabled: boolean;
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
        disabled={disabled}
        title="Runs git rm -r --cached .arbora. The files stay on disk; commit to record it."
        className="shrink-0 rounded border border-current px-1.5 py-0.5 hover:bg-bg/40"
        onClick={() => void run(() => window.arbora.invoke('git.untrackArbora'))}
      >
        Stop tracking
      </button>
    </div>
  );
}

function GithubSection({ disabled }: { disabled: boolean }) {
  const [prs, setPrs] = useState<GithubPr[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [open, setOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const load = (): void => void loadGithub(setPrs, setError);
  return (
    <Section
      title="Pull requests"
      testId="git-section-github"
      count={prs?.length ?? 0}
      empty={error ?? (prs ? 'No open pull requests.' : 'Load to list open pull requests from GitHub.')}
      actions={
        <>
          <IconButton
            icon={RefreshCw}
            label={prs ? 'Refresh' : 'Load from GitHub'}
            disabled={disabled}
            onClick={load}
          />
          <IconButton icon={Plus} label="New pull request" onClick={() => setOpen((value) => !value)} />
        </>
      }
    >
      {prs?.map((pr) => (
        <button
          key={pr.number}
          type="button"
          className="flex w-full items-center gap-1.5 truncate rounded py-0.5 pl-1 text-left hover:bg-bg-muted hover:text-accent"
          onClick={() =>
            void window.arbora
              .invoke('git.checks', { number: pr.number })
              .then((checks) => {
                const summary = checks.map((check) => `${check.name}: ${check.conclusion ?? check.status}`).join(', ');
                showToast(summary || `PR #${pr.number} has no checks`);
                window.open(pr.url, '_blank', 'noopener');
              })
              .catch((loadError: unknown) => showToast(ipcError(loadError)))
          }
        >
          <GitPullRequest className="size-3 shrink-0 text-accent" />
          <span className="shrink-0 text-fg-subtle">#{pr.number}</span>
          <span className="truncate">{pr.title}</span>
          <PullRequestUsage number={pr.number} />
        </button>
      ))}
      {open && (
        <div className="mt-1 flex flex-col gap-1 pb-1" data-testid="git-new-pr">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title"
            className="rounded border border-border bg-bg px-2 py-1"
          />
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Description (Markdown)"
            rows={4}
            className="resize-none rounded border border-border bg-bg px-2 py-1"
          />
          <div className="flex gap-1">
            <button
              type="button"
              className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-fg-muted hover:bg-bg-muted disabled:opacity-50"
              disabled={disabled || writing}
              onClick={() => {
                setWriting(true);
                void window.arbora
                  .invoke('git.generate', { kind: 'pullRequest' })
                  .then((text) => {
                    setTitle(text.title);
                    setBody(text.body);
                  })
                  .catch((generateError: unknown) => showToast(ipcError(generateError)))
                  .finally(() => setWriting(false));
              }}
            >
              {writing ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
              Write with AI
            </button>
            <button
              type="button"
              className="ml-auto rounded bg-accent px-2 py-0.5 text-accent-fg disabled:opacity-50"
              disabled={title.trim() === '' || disabled}
              onClick={() =>
                void window.arbora
                  .invoke('git.createPullRequest', { title: title.trim(), body })
                  .then((created) => {
                    showToast(`Opened ${created.url}`);
                    setOpen(false);
                    setTitle('');
                    setBody('');
                    load();
                  })
                  .catch((createError: unknown) => showToast(ipcError(createError)))
              }
            >
              Create
            </button>
          </div>
        </div>
      )}
    </Section>
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
