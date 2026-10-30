import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import clsx from 'clsx';
import { ArrowLeft, Bot, ChevronRight, Cpu, LoaderCircle, Pin, Settings, Star } from 'lucide-react';
import { openSettings, showToast, useApp } from '../../store';
import { createThread, showThreads, useAgents } from '../../agent-store';
import { toggleDefaultAgent, toggleDefaultModel, toggleFavoriteModel } from '../../agent-defaults';
import { shortModelName, useAutoVerify, usePickableAgents, type PickableAgent } from '../../agent-pickers';

/** Up/down/home/end over `count` rows; returns the new index, or null for keys it does not handle. */
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

/**
 * The second step: one agent's visible models, its default first, then favourites, then the
 * rest. Enter or a click starts the thread on that model.
 */
function ModelStep({
  entry,
  creating,
  onBack,
  onStart,
}: {
  entry: PickableAgent;
  creating: boolean;
  onBack: () => void;
  onStart: (model: string) => void;
}) {
  const { agent, models } = entry;
  const defaultModel = useApp((s) => s.settings.agents.defaultModels[agent.id]);
  const favorites = useApp((s) => s.settings.agents.favoriteModels[agent.id]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const index = Math.min(active, models.length - 1);
  useScrollActive(listRef, index);
  useEffect(() => {
    listRef.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const next = moveIndex(event.key, index, models.length);
    if (next !== null) setActive(next);
    else if (event.key === 'Enter') {
      const model = models[index];
      if (model) onStart(model.value);
    } else if (event.key === 'ArrowLeft' || event.key === 'Escape' || event.key === 'Backspace') onBack();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="model-step" data-agent={agent.id}>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-left text-[12px] text-fg-muted hover:text-fg"
      >
        <ArrowLeft size={12} />
        <Bot size={13} className="text-accent" />
        <span className="font-medium text-fg">{agent.name}</span>
        <span className="text-fg-subtle">· choose a model</span>
      </button>
      <ul
        ref={listRef}
        role="listbox"
        aria-label={`${agent.name} models`}
        aria-activedescendant={`pick-model-option-${index}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-y-auto p-2 focus:outline-none"
      >
        {models.map((model, i) => {
          const selected = i === index;
          const isDefault = model.value === defaultModel;
          const isFavorite = favorites?.includes(model.value) ?? false;
          const previous = models[i - 1];
          const previousGroup =
            previous === undefined
              ? null
              : previous.value === defaultModel
                ? 'default'
                : favorites?.includes(previous.value)
                  ? 'favorite'
                  : 'other';
          const group = isDefault ? 'default' : isFavorite ? 'favorite' : 'other';
          return (
            <li
              key={model.value}
              id={`pick-model-option-${i}`}
              role="option"
              aria-selected={selected}
              data-index={i}
              className="group relative"
            >
              {previousGroup !== null && previousGroup !== group && group === 'other' && (
                <div className="mx-1 my-1 border-t border-border" aria-hidden />
              )}
              <button
                type="button"
                tabIndex={-1}
                data-testid={`pick-model-${model.value}`}
                data-active={selected || undefined}
                disabled={creating}
                onMouseEnter={() => setActive(i)}
                onClick={() => onStart(model.value)}
                className={clsx(
                  'mb-1 flex w-full items-center gap-2 rounded border py-1.5 pr-16 pl-2 text-left text-[12.5px] disabled:opacity-60',
                  selected ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-bg-muted',
                )}
              >
                <Cpu size={13} className="shrink-0 text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate">{model.name}</span>
                {isDefault && (
                  <span className="rounded bg-accent px-1 text-[10px] text-accent-fg" data-testid="default-model-badge">
                    default
                  </span>
                )}
              </button>
              <span className="absolute top-1 right-1 flex items-center gap-0.5">
                <button
                  type="button"
                  tabIndex={-1}
                  title={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
                  aria-label={isFavorite ? `Unfavourite ${model.name}` : `Favourite ${model.name}`}
                  aria-pressed={isFavorite}
                  onClick={() => toggleFavoriteModel(agent.id, model.value)}
                  className={clsx(
                    'flex h-6 w-6 items-center justify-center rounded hover:bg-bg',
                    isFavorite ? 'text-accent' : 'text-fg-subtle opacity-0 group-hover:opacity-100',
                  )}
                >
                  <Star size={12} fill={isFavorite ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  title={isDefault ? `Stop using as the ${agent.name} default` : `Use for new ${agent.name} threads`}
                  aria-label={isDefault ? `Unset ${model.name} as default` : `Make ${model.name} the default`}
                  aria-pressed={isDefault}
                  onClick={() => toggleDefaultModel(agent.id, model.value)}
                  className={clsx(
                    'flex h-6 w-6 items-center justify-center rounded hover:bg-bg',
                    isDefault ? 'text-accent' : 'text-fg-subtle opacity-0 group-hover:opacity-100',
                  )}
                >
                  <Pin size={12} fill={isDefault ? 'currentColor' : 'none'} />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-border px-3 py-1.5 text-[11px] text-fg-subtle">
        ↑↓ move · Enter start · ← back · ★ favourite · pin sets the default
      </div>
    </div>
  );
}

/**
 * New-thread picker: signed-in agents you have not hidden, the default first and highlighted.
 * Enter or a click starts the agent on its default model; → or the chevron picks another model.
 */
export function AgentPicker() {
  const pickable = usePickableAgents();
  const total = useAgents((s) => s.agents.length);
  const hasThreads = useAgents((s) => s.threads.length > 0);
  const focusRequest = useAgents((s) => s.pickerFocusRequest);
  const checking = useApp((s) => s.checkingAgents.length > 0);
  const appDefault = useApp((s) => s.settings.agents.defaultAgent);
  const projectDefault = useApp((s) => s.project?.settings.defaultAgent);
  const [creating, setCreating] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [modelsFor, setModelsFor] = useState<string | null>(null);
  const [seenRequest, setSeenRequest] = useState(focusRequest);
  if (seenRequest !== focusRequest) {
    setSeenRequest(focusRequest);
    setActive(0);
    setModelsFor(null);
  }
  const listRef = useRef<HTMLUListElement>(null);
  useAutoVerify();

  const index = Math.min(active, Math.max(0, pickable.length - 1));
  const hiddenCount = total - pickable.length;
  const modelEntry = modelsFor ? pickable.find((entry) => entry.agent.id === modelsFor) : undefined;

  useEffect(() => {
    if (!modelEntry) listRef.current?.focus();
  }, [focusRequest, pickable.length, modelEntry]);
  useScrollActive(listRef, index);

  const start = async (agentId: string, model?: string): Promise<void> => {
    if (creating) return;
    setCreating(agentId);
    try {
      await createThread(agentId, model);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setCreating(null);
    }
  };

  const startDefault = (entry: PickableAgent): void => {
    void start(entry.agent.id, entry.models[0]?.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const entry = pickable[index];
    const next = moveIndex(event.key, index, pickable.length);
    if (next !== null) setActive(next);
    else if (event.key === 'Enter' && entry) startDefault(entry);
    else if (event.key === 'ArrowRight' && entry && entry.models.length > 1) setModelsFor(entry.agent.id);
    else if (event.key === 'Escape' && hasThreads) showThreads();
    else return;
    event.preventDefault();
  };

  if (modelEntry) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="agent-picker">
        <ModelStep
          entry={modelEntry}
          creating={creating !== null}
          onBack={() => {
            setModelsFor(null);
            setActive(pickable.indexOf(modelEntry));
          }}
          onStart={(model) => void start(modelEntry.agent.id, model)}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="agent-picker">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 text-[12px]">
        {hasThreads && (
          <button
            type="button"
            aria-label="Back to threads"
            onClick={showThreads}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
          >
            <ArrowLeft size={13} />
          </button>
        )}
        <span className="font-medium">Choose an agent</span>
        <button
          type="button"
          title="Agent settings"
          aria-label="Open settings"
          onClick={() => openSettings('agents')}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
        >
          <Settings size={13} />
        </button>
      </div>
      {pickable.length === 0 ? (
        <div className="flex flex-col gap-2 p-3 text-xs text-fg-muted" data-testid="agent-picker-empty">
          {checking ? (
            <p className="flex items-center gap-1.5">
              <LoaderCircle size={12} className="animate-spin" /> Checking which agents are signed in…
            </p>
          ) : (
            <p>No signed-in agent is shown. Sign in to one, or show it, in Settings.</p>
          )}
          <button
            type="button"
            onClick={() => openSettings('agents')}
            className="self-start text-accent hover:underline"
          >
            Open Settings
          </button>
        </div>
      ) : (
        <ul
          ref={listRef}
          role="listbox"
          aria-label="Agents"
          aria-activedescendant={`pick-agent-option-${index}`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 overflow-y-auto p-2 focus:outline-none"
        >
          {pickable.map((entry, i) => {
            const { agent, models, isDefault } = entry;
            const selected = i === index;
            return (
              <li
                key={agent.id}
                id={`pick-agent-option-${i}`}
                role="option"
                aria-selected={selected}
                data-index={i}
                className="group relative mb-1.5"
              >
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid={`pick-agent-${agent.id}`}
                  data-active={selected || undefined}
                  disabled={creating !== null}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => startDefault(entry)}
                  className={clsx(
                    'flex w-full items-start gap-2 rounded border py-2 pr-16 pl-2 text-left disabled:opacity-60',
                    selected ? 'border-accent bg-accent-soft' : 'border-border hover:bg-bg-muted',
                  )}
                >
                  <Bot size={16} className="mt-0.5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                      {agent.name}
                      {!agent.builtIn && (
                        <span className="rounded bg-bg-muted px-1 text-[10px] text-fg-subtle">custom</span>
                      )}
                      {isDefault && (
                        <span
                          className="rounded bg-accent px-1 text-[10px] text-accent-fg"
                          data-testid="default-agent-badge"
                          title={
                            agent.id === projectDefault
                              ? 'Default for this project (defaultAgent in .arbora/project.json)'
                              : 'Default for new threads'
                          }
                        >
                          default
                        </span>
                      )}
                      {creating === agent.id && <LoaderCircle size={12} className="animate-spin text-fg-subtle" />}
                    </span>
                    <span className="block truncate text-[11px] text-fg-subtle">
                      {models[0]
                        ? `${shortModelName(models[0].name)}${models.length > 1 ? ` · ${models.length} models` : ''}`
                        : `${agent.command} ${agent.args.join(' ')}`}
                    </span>
                  </span>
                </button>
                <span className="absolute top-1.5 right-1.5 flex items-center gap-0.5">
                  <button
                    type="button"
                    tabIndex={-1}
                    data-testid={`default-agent-${agent.id}`}
                    aria-pressed={agent.id === appDefault}
                    title={
                      agent.id === appDefault
                        ? 'Stop using as the default agent'
                        : 'Use as the default agent for new threads'
                    }
                    aria-label={
                      agent.id === appDefault ? `Unset ${agent.name} as default` : `Make ${agent.name} the default`
                    }
                    onClick={() => toggleDefaultAgent(agent.id)}
                    className={clsx(
                      'flex h-6 w-6 items-center justify-center rounded hover:bg-bg',
                      agent.id === appDefault
                        ? 'text-accent'
                        : 'text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-fg',
                    )}
                  >
                    <Pin size={12} fill={agent.id === appDefault ? 'currentColor' : 'none'} />
                  </button>
                  {models.length > 1 && (
                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid={`pick-models-${agent.id}`}
                      title={`Choose a ${agent.name} model`}
                      aria-label={`Choose a ${agent.name} model`}
                      onClick={() => setModelsFor(agent.id)}
                      className={clsx(
                        'flex h-6 w-6 items-center justify-center rounded hover:bg-bg hover:text-fg',
                        selected ? 'text-fg' : 'text-fg-subtle',
                      )}
                    >
                      <ChevronRight size={14} />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-[11px] text-fg-subtle">
        <span className="flex-1">{pickable.length > 0 ? '↑↓ move · Enter start · → choose model' : ''}</span>
        {hiddenCount > 0 && (
          <button
            type="button"
            data-testid="agent-picker-hidden"
            onClick={() => openSettings('agents')}
            className="hover:text-fg hover:underline"
          >
            {hiddenCount} hidden or not signed in
          </button>
        )}
      </div>
    </div>
  );
}
