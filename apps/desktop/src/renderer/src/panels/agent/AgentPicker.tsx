import { useState } from 'react';
import clsx from 'clsx';
import { ArrowLeft, Bot, CircleAlert, ExternalLink, Settings } from 'lucide-react';
import { CommandId } from '@arbora/shared';
import { executeCommand } from '../../commands';
import { showToast } from '../../store';
import { createThread, showThreads, useAgents } from '../../agent-store';

export function AgentPicker() {
  const agents = useAgents((s) => s.agents);
  const availability = useAgents((s) => s.availability);
  const hasThreads = useAgents((s) => s.threads.length > 0);
  const [creating, setCreating] = useState<string | null>(null);

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
            <li key={agent.id} className="mb-1.5">
              <button
                type="button"
                data-testid={`pick-agent-${agent.id}`}
                disabled={creating !== null}
                onClick={() => void start(agent.id)}
                className={clsx(
                  'flex w-full items-start gap-2 rounded border border-border px-2 py-2 text-left hover:bg-bg-muted disabled:opacity-60',
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}
