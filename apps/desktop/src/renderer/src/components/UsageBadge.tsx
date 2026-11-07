import { useEffect } from 'react';
import { formatCost, formatDuration, formatTokens, totalTokens, turnTokens } from '@arbora/shared';
import { openSettings } from '../store';
import { loadUsage, useUsage } from '../usage-store';

function usageText(turns: ReturnType<typeof useUsage.getState>['turns']): {
  durationMs: number;
  tokens: number;
  reported: boolean;
  cost: number | null;
} {
  return {
    durationMs: turns.reduce((sum, turn) => sum + turn.durationMs, 0),
    tokens: turns.reduce((sum, turn) => sum + totalTokens(turnTokens(turn)), 0),
    reported: turns.some((turn) => turn.tokensReported),
    cost: turns.reduce<number | null>((sum, turn) => (turn.costUsd === null ? sum : (sum ?? 0) + turn.costUsd), null),
  };
}

export function UsageBadge({ threadId, includeHelpers = false }: { threadId: string; includeHelpers?: boolean }) {
  const turns = useUsage((s) => s.turns);
  useEffect(() => {
    void loadUsage();
  }, []);
  const own = turns.filter(
    (turn) => turn.threadId === threadId || (includeHelpers && turn.parentThreadId === threadId),
  );
  if (own.length === 0) return null;
  const durationMs = own.reduce((sum, turn) => sum + turn.durationMs, 0);
  const tokens = own.reduce((sum, turn) => sum + totalTokens(turnTokens(turn)), 0);
  const reported = own.some((turn) => turn.tokensReported);
  const priced = own.some((turn) => turn.costUsd !== null);
  const cost = own.reduce<number | null>(
    (sum, turn) => (turn.costUsd === null ? sum : (sum ?? 0) + turn.costUsd),
    null,
  );
  const detail = cost !== null ? `~${formatCost(cost)}` : reported ? formatTokens(tokens) : 'tokens not reported';
  return (
    <button
      type="button"
      data-testid="session-usage"
      onClick={() => openSettings('usage')}
      title={`${tokens.toLocaleString()} tokens${priced ? ` · $${(cost ?? 0).toFixed(4)} estimated from published API prices` : ''}. Show usage.`}
      className="hidden min-w-0 shrink truncate rounded px-1 text-[11px] text-fg-subtle hover:bg-bg-muted hover:text-fg @2xl:inline"
    >
      worked {formatDuration(durationMs)} · {detail}
    </button>
  );
}

export function PullRequestUsage({ number }: { number: number }) {
  const turns = useUsage((s) => s.turns);
  useEffect(() => {
    void loadUsage();
  }, []);
  const own = turns.filter((turn) => turn.pr?.number === number);
  if (own.length === 0) return null;
  const usage = usageText(own);
  const detail =
    usage.cost !== null
      ? `~${formatCost(usage.cost)}`
      : usage.reported
        ? formatTokens(usage.tokens)
        : 'tokens not reported';
  return (
    <span
      data-testid={`pr-usage-${number}`}
      title={`${usage.tokens.toLocaleString()} tokens${usage.cost !== null ? ` · $${usage.cost.toFixed(4)} estimated from published API prices` : ''}`}
      className="ml-auto shrink-0 text-[10px] font-normal text-fg-subtle"
    >
      worked {formatDuration(usage.durationMs)} · {detail}
    </span>
  );
}
