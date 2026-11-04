import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import clsx from 'clsx';
import { Bot, Cpu, LoaderCircle, Settings } from 'lucide-react';
import { shortModelName, useAutoVerify, usePickableAgents } from '../../agent-pickers';
import { Dialog } from '../../components/Dialog';
import { closeLauncher, setProjectDefaultAgent, startSession } from '../../grove-store';
import { openSettings, useApp } from '../../store';

/** Up/down/home/end over `count` rows, wrapping; null for other keys. */
function moveIndex(key: string, index: number, count: number): number | null {
  const last = count - 1;
  switch (key) {
    case 'ArrowDown':
      return index >= last ? 0 : index + 1;
    case 'ArrowUp':
      return index <= 0 ? last : index - 1;
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

function useScrollActive(list: RefObject<HTMLUListElement | null>, index: number): void {
  useEffect(() => {
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [list, index]);
}

const option = (selected: boolean): string =>
  clsx(
    'flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-[12.5px]',
    selected ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-bg-muted',
  );

/**
 * New agent with a task: an agent and model, the task, and whether this agent becomes the
 * project's default. Enter starts it; the task's first line names the session.
 *
 * Agents are the same set the browser picker offers (`isPickableAgent`: signed in, and not in
 * `settings.agents.hidden`). The dialog stays inside the viewport; the model list is what scrolls.
 */
export function GroveLauncher() {
  const pickable = usePickableAgents();
  useAutoVerify();
  const checking = useApp((s) => s.checkingAgents.length > 0);
  const projectDefault = useApp((s) => s.project?.settings.defaultAgent);
  const [agentIndex, setAgentIndex] = useState(0);
  const [chosenModels, setChosenModels] = useState<Readonly<Record<string, string>>>({});
  const [task, setTask] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [worktree, setWorktree] = useState(false);
  const agentList = useRef<HTMLUListElement>(null);
  const modelList = useRef<HTMLUListElement>(null);

  const index = Math.min(agentIndex, Math.max(0, pickable.length - 1));
  const entry = pickable[index];
  const models = entry?.models ?? [];
  const model = entry ? (chosenModels[entry.agent.id] ?? models[0]?.value) : undefined;
  const modelIndex = Math.max(
    0,
    models.findIndex((m) => m.value === model),
  );
  const isProjectDefault = entry !== undefined && entry.agent.id === projectDefault;
  useScrollActive(agentList, index);
  useScrollActive(modelList, modelIndex);

  const chooseModel = (value: string): void => {
    if (entry) setChosenModels((current) => ({ ...current, [entry.agent.id]: value }));
  };

  const start = (): void => {
    if (!entry) return;
    const agentId = entry.agent.id;
    // Closed first: the dialog hands focus back when it unmounts, and the new session's composer
    // has to take it after that.
    closeLauncher();
    if (makeDefault && !isProjectDefault) void setProjectDefaultAgent(agentId);
    void startSession({ agentId, model, task, worktree });
  };

  const onAgentKey = (event: KeyboardEvent<HTMLUListElement>): void => {
    const next = moveIndex(event.key, index, pickable.length);
    if (next !== null) setAgentIndex(next);
    else if (event.key === 'Enter') start();
    else if (event.key === 'ArrowRight' && models.length > 0) modelList.current?.focus();
    else return;
    event.preventDefault();
  };

  const onModelKey = (event: KeyboardEvent<HTMLUListElement>): void => {
    const next = moveIndex(event.key, modelIndex, models.length);
    const nextModel = next === null ? undefined : models[next];
    if (nextModel) chooseModel(nextModel.value);
    else if (event.key === 'Enter') start();
    else if (event.key === 'ArrowLeft') agentList.current?.focus();
    else return;
    event.preventDefault();
  };

  return (
    <Dialog label="New agent" testId="grove-launcher" onClose={closeLauncher} width={600}>
      <div className="flex max-h-[calc(100dvh-3rem)] min-h-0 w-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="flex-1 text-sm font-semibold">New agent</h2>
          <button
            type="button"
            title="Agent settings"
            aria-label="Agent settings"
            onClick={() => {
              closeLauncher();
              openSettings('agents');
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
          >
            <Settings size={13} />
          </button>
        </div>
        {pickable.length === 0 ? (
          <div
            className="flex shrink-0 flex-col gap-2 border-b border-border px-4 py-3 text-xs text-fg-muted"
            data-testid="launcher-empty"
          >
            {checking ? (
              <p className="flex items-center gap-1.5">
                <LoaderCircle size={12} className="animate-spin" /> Checking which agents are signed in…
              </p>
            ) : (
              <p>No signed-in agent is shown. Sign in to one, or show it, in Settings → Agents.</p>
            )}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)] overflow-hidden border-b border-border">
            <ul
              ref={agentList}
              role="listbox"
              aria-label="Agent"
              aria-activedescendant={`launcher-agent-option-${index}`}
              tabIndex={0}
              onKeyDown={onAgentKey}
              className="min-h-0 overflow-y-auto border-r border-border p-2 outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset"
            >
              {pickable.map(({ agent, models: agentModels, isDefault }, i) => (
                <li
                  key={agent.id}
                  id={`launcher-agent-option-${i}`}
                  role="option"
                  aria-selected={i === index}
                  data-index={i}
                  className="mb-1"
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    data-testid={`launcher-agent-${agent.id}`}
                    data-active={i === index || undefined}
                    onClick={() => setAgentIndex(i)}
                    onDoubleClick={start}
                    className={option(i === index)}
                  >
                    <Bot size={14} className="shrink-0 text-accent" />
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="flex items-center gap-1.5 font-medium">
                        <span className="truncate">{agent.name}</span>
                        {isDefault && (
                          <span className="rounded bg-accent px-1 text-[10px] text-accent-fg">default</span>
                        )}
                      </span>
                      <span className="truncate text-[11px] text-fg-subtle">
                        {agentModels.length > 0
                          ? `${agentModels.length} model${agentModels.length === 1 ? '' : 's'}`
                          : 'Its own model'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <ul
              ref={modelList}
              role="listbox"
              aria-label={entry ? `${entry.agent.name} models` : 'Models'}
              aria-activedescendant={models.length > 0 ? `launcher-model-option-${modelIndex}` : undefined}
              tabIndex={-1}
              data-testid="launcher-models"
              onKeyDown={onModelKey}
              className="min-h-0 overflow-y-auto p-2 outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset"
            >
              {models.length === 0 ? (
                <li className="px-2 py-1.5 text-[12px] text-fg-subtle">The agent starts on its own default model.</li>
              ) : (
                models.map((entryModel, i) => (
                  <li
                    key={entryModel.value}
                    id={`launcher-model-option-${i}`}
                    role="option"
                    aria-selected={entryModel.value === model}
                    data-index={i}
                    className="mb-1"
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid={`launcher-model-${entryModel.value}`}
                      data-active={entryModel.value === model || undefined}
                      onClick={() => chooseModel(entryModel.value)}
                      onDoubleClick={start}
                      className={option(entryModel.value === model)}
                    >
                      <Cpu size={13} className="shrink-0 text-fg-subtle" />
                      <span className="min-w-0 flex-1 truncate">{shortModelName(entryModel.name)}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
        <div className="flex shrink-0 flex-col gap-2 px-4 py-3">
          <label htmlFor="grove-launcher-task" className="text-xs font-medium">
            Task
          </label>
          <textarea
            id="grove-launcher-task"
            data-autofocus
            data-testid="launcher-task"
            rows={4}
            value={task}
            placeholder="What should it work on? Leave it empty to just start the agent."
            onChange={(event) => setTask(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                start();
                return;
              }
              // A one-line task has no caret to move up or down, so the arrows pick the agent.
              const plain = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
              if (plain && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && !task.includes('\n')) {
                const next = moveIndex(event.key, index, pickable.length);
                if (next !== null) setAgentIndex(next);
                event.preventDefault();
              }
            }}
            className="resize-y rounded border border-border bg-bg px-2 py-1.5 text-[12.5px] outline-none select-text focus:border-accent"
          />
          <label className="flex items-center gap-1.5 text-[12px] text-fg-muted">
            <input
              type="checkbox"
              data-testid="launcher-default"
              checked={makeDefault || isProjectDefault}
              disabled={!entry || isProjectDefault}
              onChange={(event) => setMakeDefault(event.target.checked)}
            />
            Use as default for this project
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-fg-muted">
            <input
              type="checkbox"
              data-testid="launcher-worktree"
              checked={worktree}
              disabled={!entry}
              onChange={(event) => setWorktree(event.target.checked)}
            />
            New git worktree, named from the task
          </label>
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5">
          <span className="min-w-0 flex-1 truncate text-[11px] text-fg-subtle">
            ↑↓ agent · → model · Enter start · Shift+Enter new line
          </span>
          <button
            type="button"
            onClick={closeLauncher}
            className="h-7 rounded border border-border px-3 text-[12px] hover:bg-bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="launcher-start"
            disabled={!entry}
            onClick={start}
            className="h-7 rounded bg-accent px-3 text-[12px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            Start
          </button>
        </div>
      </div>
    </Dialog>
  );
}
