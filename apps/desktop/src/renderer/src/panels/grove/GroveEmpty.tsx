import { Loader2, Trees } from 'lucide-react';
import { useAgents } from '../../agent-store';
import { useDefaultAgentId } from '../../agent-defaults';
import { defaultModelFor, openLauncher, setStartDefaultOnOpen, startSession, useGrove } from '../../grove-store';
import { useApp } from '../../store';

const primary =
  'h-8 rounded bg-accent px-3 text-[12.5px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-60';
const secondary = 'h-8 rounded border border-border px-3 text-[12.5px] hover:bg-bg-muted';

/** Nothing listed and nothing started on its own: say so, and offer the default agent. */
export function GroveEmpty() {
  const defaultId = useDefaultAgentId();
  const agent = useAgents((s) => s.agents.find((entry) => entry.id === defaultId));
  const starting = useGrove((s) => s.starting);
  const startError = useGrove((s) => s.startError);
  const startOnOpen = useApp((s) => s.project?.settings.startDefaultOnOpen !== false);
  return (
    <div
      data-testid="grove-empty"
      className="flex h-full flex-col items-center justify-center gap-3 bg-bg p-6 text-center text-[12.5px]"
    >
      <Trees size={28} className="text-fg-subtle" aria-hidden />
      {starting ? (
        <p className="flex items-center gap-1.5 text-fg-muted" data-testid="grove-empty-starting">
          <Loader2 size={13} className="animate-spin" /> Starting {agent?.name ?? 'the agent'}…
        </p>
      ) : (
        <p className="text-[14px] font-medium">No agents running.</p>
      )}
      {startError && (
        <p role="alert" data-testid="grove-start-error" className="max-w-md text-danger">
          {startError}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {agent ? (
          <>
            <button
              type="button"
              data-testid="grove-empty-start"
              disabled={starting}
              onClick={() => void startSession({ agentId: agent.id, model: defaultModelFor(agent.id) })}
              className={primary}
            >
              {startError ? 'Retry' : `Start ${agent.name}`}
            </button>
            <button type="button" data-testid="grove-empty-launch" onClick={openLauncher} className={secondary}>
              New agent with a task…
            </button>
          </>
        ) : (
          <button type="button" data-testid="grove-empty-choose" onClick={openLauncher} className={primary}>
            Choose an agent
          </button>
        )}
      </div>
      {agent && (
        <label className="flex items-center gap-1.5 text-fg-muted">
          <input
            type="checkbox"
            data-testid="grove-empty-start-on-open"
            checked={startOnOpen}
            onChange={(event) => void setStartDefaultOnOpen(event.target.checked)}
          />
          Start {agent.name} when Grove opens empty
        </label>
      )}
      <p className="max-w-sm text-[11.5px] text-fg-subtle">
        Agents keep running while you switch back to the browser. Quitting Arbora stops them.
      </p>
    </div>
  );
}
