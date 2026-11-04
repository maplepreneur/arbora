import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Download, ExternalLink, FolderOpen, Search, Trash2 } from 'lucide-react';
import type { LibrarySkill, SkillLibrary, SkillSearchResult, SkillTarget, SkillTargetId } from '@arbora/shared';
import { showToast } from '../../store';
import { inputClass, SectionTitle } from './controls';

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(error);
}

function formatInstalls(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

/** Folders a new skill links into: every agent that is installed, else all of them. */
function defaultTargets(targets: readonly SkillTarget[]): SkillTargetId[] {
  const installed = targets.filter((target) => target.installed).map((target) => target.id);
  return installed.length > 0 ? installed : targets.map((target) => target.id);
}

export function SkillsSection() {
  const [library, setLibrary] = useState<SkillLibrary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void window.arbora.invoke('skills.list', undefined).then(
      (next) => live && setLibrary(next),
      (error: unknown) => showToast(`Skills: ${messageOf(error)}`),
    );
    return () => {
      live = false;
    };
  }, []);

  const run = async (key: string, action: () => Promise<SkillLibrary>): Promise<boolean> => {
    setBusy(key);
    try {
      setLibrary(await action());
      return true;
    } catch (error) {
      showToast(messageOf(error));
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (!library) return <div className="text-xs text-fg-subtle">Loading skills…</div>;
  const installed = new Set(library.skills.map((skill) => skill.name));
  return (
    <div data-testid="skills-settings">
      <SectionTitle>Your skills</SectionTitle>
      <div className="mb-2 flex items-center gap-2 text-xs text-fg-subtle">
        <span className="min-w-0 flex-1">
          One copy in <span className="font-mono">{library.libraryPath}</span>, linked into each agent's skills folder.
          Agents pick up changes in new threads.
        </span>
        <button
          type="button"
          onClick={() => void window.arbora.invoke('skills.reveal', { name: null })}
          className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 hover:bg-bg-muted"
        >
          <FolderOpen size={12} /> Open folder
        </button>
      </div>
      {library.skills.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-fg-subtle">
          No skills yet. Find some on skills.sh below, or add the ones your agents already have.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border" data-testid="skill-list">
          {library.skills.map((skill) => (
            <SkillRow
              key={skill.name}
              skill={skill}
              targets={library.targets}
              busy={busy === skill.name}
              onTargets={(targets) =>
                void run(skill.name, () => window.arbora.invoke('skills.setTargets', { name: skill.name, targets }))
              }
              onRemove={() => void run(skill.name, () => window.arbora.invoke('skills.remove', { name: skill.name }))}
            />
          ))}
        </ul>
      )}

      <SkillSearch
        installed={installed}
        busy={busy}
        onInstall={(result) =>
          void run(`install:${result.id}`, () =>
            window.arbora.invoke('skills.install', {
              source: result.source,
              skillId: result.skillId,
              targets: defaultTargets(library.targets),
            }),
          ).then((ok) => ok && showToast(`Installed ${result.skillId}`))
        }
      />

      {library.found.length > 0 && (
        <>
          <SectionTitle>Found in your agents' folders</SectionTitle>
          <p className="mb-2 text-xs text-fg-subtle">
            Add moves the skill into the library and links it back, so you can turn it on for other agents.
          </p>
          <ul className="divide-y divide-border rounded-md border border-border" data-testid="skill-found">
            {library.found.map((skill) => (
              <li
                key={skill.name}
                className="flex items-center gap-3 px-3 py-2"
                data-testid={`skill-found-${skill.name}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs">{skill.name}</div>
                  <div className="truncate text-xs text-fg-subtle">
                    {skill.targets
                      .map((id) => library.targets.find((target) => target.id === id)?.label ?? id)
                      .join(', ')}
                    {skill.description && ` · ${skill.description}`}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy !== null}
                  data-testid={`skill-adopt-${skill.name}`}
                  onClick={() => void run(skill.name, () => window.arbora.invoke('skills.adopt', { name: skill.name }))}
                  className="shrink-0 rounded border border-border px-2 py-1 text-xs hover:bg-bg-muted disabled:opacity-40"
                >
                  Add to library
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SkillRow({
  skill,
  targets,
  busy,
  onTargets,
  onRemove,
}: {
  skill: LibrarySkill;
  targets: readonly SkillTarget[];
  busy: boolean;
  onTargets: (targets: SkillTargetId[]) => void;
  onRemove: () => void;
}) {
  const linked = targets.filter((target) => skill.links[target.id] === 'linked').map((target) => target.id);
  const linkable = targets.filter((target) => skill.links[target.id] !== 'other').map((target) => target.id);
  const all = linkable.every((id) => linked.includes(id));
  return (
    <li className="px-3 py-2" data-testid={`skill-${skill.name}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-medium">{skill.name}</span>
            {skill.source && (
              <button
                type="button"
                title={`skills.sh/${skill.source}`}
                onClick={() =>
                  void window.arbora.invoke('app.openExternal', { url: `https://skills.sh/${skill.source}` })
                }
                className="truncate text-[11px] text-fg-subtle hover:text-accent"
              >
                {skill.source.split('/').slice(0, 2).join('/')}
              </button>
            )}
          </div>
          {skill.description && <div className="line-clamp-2 text-xs text-fg-subtle">{skill.description}</div>}
        </div>
        <button
          type="button"
          aria-label={`Show ${skill.name} in the file manager`}
          title="Show in folder"
          onClick={() => void window.arbora.invoke('skills.reveal', { name: skill.name })}
          className="rounded p-1 text-fg-subtle hover:bg-bg-muted hover:text-fg"
        >
          <FolderOpen size={13} />
        </button>
        <button
          type="button"
          aria-label={`Remove ${skill.name}`}
          title="Remove from every agent and delete"
          disabled={busy}
          data-testid={`skill-remove-${skill.name}`}
          onClick={onRemove}
          className="rounded p-1 text-fg-subtle hover:bg-bg-muted hover:text-danger disabled:opacity-40"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1" role="group" aria-label={`Agents using ${skill.name}`}>
        <button
          type="button"
          disabled={busy}
          aria-pressed={all}
          data-testid={`skill-all-${skill.name}`}
          onClick={() => onTargets(all ? [] : linkable)}
          className={clsx(
            'rounded-full border px-2 py-0.5 text-[11px] disabled:opacity-50',
            all ? 'border-accent bg-accent-soft text-accent' : 'border-border text-fg-subtle hover:text-fg',
          )}
        >
          All agents
        </button>
        {targets.map((target) => {
          const state = skill.links[target.id];
          const on = state === 'linked';
          return (
            <button
              key={target.id}
              type="button"
              disabled={busy || state === 'other'}
              aria-pressed={on}
              data-testid={`skill-link-${skill.name}-${target.id}`}
              title={
                state === 'other'
                  ? `${target.path} already has a different ${skill.name}`
                  : `${target.path}${target.installed ? '' : ' (agent not found)'}`
              }
              onClick={() => onTargets(on ? linked.filter((id) => id !== target.id) : [...linked, target.id])}
              className={clsx(
                'rounded-full border px-2 py-0.5 text-[11px] disabled:cursor-not-allowed',
                on
                  ? 'border-accent bg-accent text-accent-fg'
                  : state === 'other'
                    ? 'border-amber-500/50 text-amber-600 dark:text-amber-400'
                    : 'border-border text-fg-muted hover:bg-bg-muted',
                !target.installed && !on && 'opacity-50',
              )}
            >
              {target.label}
              {state === 'other' && ' (other copy)'}
            </button>
          );
        })}
      </div>
    </li>
  );
}

function SkillSearch({
  installed,
  busy,
  onInstall,
}: {
  installed: ReadonlySet<string>;
  busy: string | null;
  onInstall: (result: SkillSearchResult) => void;
}) {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<{
    query: string;
    results: SkillSearchResult[] | null;
    error: string | null;
  } | null>(null);
  const trimmed = query.trim();
  const searchable = trimmed.length >= 2;

  useEffect(() => {
    if (!searchable) return;
    let live = true;
    const timer = setTimeout(() => {
      window.arbora.invoke('skills.search', { query: trimmed }).then(
        (results) => live && setAnswer({ query: trimmed, results, error: null }),
        (failure: unknown) => live && setAnswer({ query: trimmed, results: null, error: messageOf(failure) }),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [trimmed, searchable]);

  const current = searchable && answer?.query === trimmed ? answer : null;
  const loading = searchable && current === null;
  const results = searchable ? (current?.results ?? answer?.results ?? null) : null;
  const error = current?.error ?? null;

  return (
    <>
      <SectionTitle>Find skills on skills.sh</SectionTitle>
      <label className="relative mb-2 flex items-center">
        <Search size={13} className="pointer-events-none absolute left-2 text-fg-subtle" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search skills (react, testing, design…)"
          aria-label="Search skills.sh"
          data-testid="skills-search"
          className={clsx(inputClass, 'w-full pl-7')}
        />
      </label>
      {loading && <div className="text-xs text-fg-subtle">Searching…</div>}
      {error && <div className="text-xs text-danger">{error}</div>}
      {current?.results?.length === 0 && <div className="text-xs text-fg-subtle">No skills found.</div>}
      {results && results.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border" data-testid="skills-results">
          {results.map((result) => {
            const has = installed.has(result.skillId);
            const installing = busy === `install:${result.id}`;
            return (
              <li key={result.id} className="flex items-center gap-3 px-3 py-2" data-testid="skills-result">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs font-medium">{result.name}</div>
                  <div className="truncate text-[11px] text-fg-subtle">
                    {result.source} · {formatInstalls(result.installs)} installs
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Open ${result.name} on skills.sh`}
                  title="Open on skills.sh"
                  onClick={() =>
                    void window.arbora.invoke('app.openExternal', { url: `https://skills.sh/${result.id}` })
                  }
                  className="rounded p-1 text-fg-subtle hover:bg-bg-muted hover:text-fg"
                >
                  <ExternalLink size={13} />
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  data-testid={`skills-install-${result.skillId}`}
                  onClick={() => onInstall(result)}
                  className={clsx(
                    'flex w-24 shrink-0 items-center justify-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50',
                    has
                      ? 'border border-border text-fg-muted hover:bg-bg-muted'
                      : 'bg-accent text-accent-fg hover:opacity-90',
                  )}
                >
                  <Download size={12} />
                  {installing ? 'Installing…' : has ? 'Update' : 'Install'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
