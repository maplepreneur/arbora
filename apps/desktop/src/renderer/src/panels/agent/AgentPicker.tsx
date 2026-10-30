import { useState } from 'react';
import clsx from 'clsx';
import { ArrowLeft, Bot, CircleAlert, ExternalLink, Pin, Settings } from 'lucide-react';
import { CommandId } from '@arbora/shared';
import { executeCommand } from '../../commands';
import { showToast, useApp } from '../../store';
import { createThread, showThreads, useAgents } from '../../agent-store';
import { toggleDefaultAgent, useDefaultAgentId } from '../../agent-defaults';

export function AgentPicker() {
  const agents = useAgents((s) => s.agents);
  const availability = useAgents((s) => s.availability);
  const hasThreads = useAgents((s) => s.threads.length > 0);
  const [creating, setCreating] = useState<string | null>(null);
  const defaultAgentId = useDefaultAgentId();
  const appDefault = useApp((s) => s.settings.agents.defaultAgent);
  const projectDefault = useApp((s) => s.project?.settings.defaultAgent);

  const start = async (agentId: string): Promise<void> => {
    setCreating(agentId);
    try {
      await createThread(agentId);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setCreating(null);
    }
  };

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
          title="Custom agents live in settings.json under agents.custom"
          aria-label="Open settings"
          onClick={() => executeCommand(CommandId.openSettingsFile)}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
        >
          <Settings size={13} />
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {agents.map((agent) => {
          const detected = availability.find((a) => a.id === agent.id);
          const available = detected?.available ?? false;
          return (
            <li key={agent.id} className="group relative mb-1.5">
              <button
                type="button"
                data-testid={`pick-agent-${agent.id}`}
                disabled={creating !== null}
                onClick={() => void start(agent.id)}
                className={clsx(
                  'flex w-full items-start gap-2 rounded border border-border py-2 pr-8 pl-2 text-left hover:bg-bg-muted disabled:opacity-60',
                  creating === agent.id && 'bg-bg-muted',
                )}
              >
                <Bot size={16} className={clsx('mt-0.5 shrink-0', available ? 'text-accent' : 'text-fg-subtle')} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                    {agent.name}
                    {!agent.builtIn && (
                      <span className="rounded bg-bg-muted px-1 text-[10px] text-fg-subtle">custom</span>
                    )}
                    {!available && <CircleAlert size={12} className="text-amber-500" />}
                    {agent.id === defaultAgentId && (
                      <span
                        className="rounded bg-accent-soft px-1 text-[10px] text-accent"
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
                  </span>
                  <span
                    className="block truncate font-mono text-[11px] text-fg-subtle"
                    title={detected?.resolvedCommand ?? agent.command}
                  >
                    {agent.command} {agent.args.join(' ')}
                  </span>
                  {!available && agent.installHint && (
                    <span className="mt-0.5 block text-[11px] text-fg-muted">
                      Not found on PATH. {agent.installHint}
                    </span>
                  )}
                </span>
                {agent.docsUrl && (
                  <a
                    href={agent.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${agent.name} docs`}
                    onClick={(event) => event.stopPropagation()}
                    className="mt-0.5 text-fg-subtle hover:text-fg"
                  >
                    <ExternalLink size={12} />
                  </a>
                )}
              </button>
              <button
                type="button"
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
                  'absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded hover:bg-bg',
                  agent.id === appDefault
                    ? 'text-accent'
                    : 'text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-fg',
                )}
              >
                <Pin size={12} fill={agent.id === appDefault ? 'currentColor' : 'none'} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
