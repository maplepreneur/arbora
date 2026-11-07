import { useEffect, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Bot, Clock3, Coins, Download, Gauge, MessagesSquare, TrendingUp, Zap } from 'lucide-react';
import {
  buildUsageSummary,
  formatCost,
  formatDuration,
  formatTokens,
  MODEL_PRICE_ROWS,
  type UsageAllowancePeriod,
  type UsageGroup,
  type UsageRange,
  type UsageSummary,
} from '@arbora/shared';
import { useAgents } from '../../agent-store';
import { updateSettings } from '../../settings-client';
import { showToast, useApp } from '../../store';
import { loadUsage, useUsage } from '../../usage-store';
import { inputClass, SectionTitle, Segmented, SettingRow, Toggle } from './controls';

const RANGES: readonly { value: UsageRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
];

type Breakdown = 'agent' | 'model' | 'pr' | 'project';

export function UsageSection() {
  const projectPath = useApp((s) => s.project?.path ?? null);
  const turns = useUsage((s) => s.turns);
  const loading = useUsage((s) => s.loading);
  const agents = useAgents((s) => s.agents);
  const usage = useApp((s) => s.settings.usage);
  const [range, setRange] = useState<UsageRange>('7d');
  const [breakdown, setBreakdown] = useState<Breakdown>('agent');
  const [now] = useState(() => Date.now());
  useEffect(() => {
    void loadUsage();
  }, [projectPath]);
  const summary = useMemo(
    () => buildUsageSummary(turns, { range, now, agents, allowances: usage.allowances }),
    [turns, range, now, agents, usage.allowances],
  );
  const groups =
    breakdown === 'agent'
      ? summary.byAgent
      : breakdown === 'model'
        ? summary.byModel
        : breakdown === 'pr'
          ? summary.byPr
          : summary.byProject;
  return (
    <div data-testid="usage-section" className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            Local usage ledger
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">
              On this device
            </span>
          </div>
          <p className="mt-0.5 text-xs text-fg-subtle">
            Token counts and working time stay in .arbora/usage and survive restarts. No prompt text is stored.
          </p>
        </div>
        <ExportButton format="json" />
        <ExportButton format="csv" />
      </div>

      <Segmented label="Usage time range" testId="usage-range" value={range} options={RANGES} onChange={setRange} />

      {loading && turns.length === 0 ? (
        <p className="py-10 text-center text-sm text-fg-muted">Reading the local ledger…</p>
      ) : turns.length === 0 ? (
        <EmptyUsage />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
            <Metric
              icon={<Zap size={15} />}
              label="Tokens"
              value={formatTokens(summary.totals.tokens.total)}
              detail={summary.totals.tokensReported ? 'Reported by agents' : 'Not reported yet'}
            />
            <Metric
              icon={<MessagesSquare size={15} />}
              label="Prompts"
              value={String(summary.totals.prompts)}
              detail={`${formatTokens(summary.totals.tokens.total / Math.max(1, summary.totals.prompts))} tokens on average`}
            />
            <Metric
              icon={<Clock3 size={15} />}
              label="Agent time"
              value={formatDuration(summary.totals.durationMs)}
              detail="Permission waits excluded"
            />
            <Metric
              icon={<Coins size={15} />}
              label="Estimated cost"
              value={formatCost(summary.totals.costUsd)}
              detail={
                summary.totals.unpricedTurns > 0
                  ? `${summary.totals.unpricedTurns} turns without a price`
                  : 'Published API list prices'
              }
            />
          </div>
          <p className="-mt-4 text-[11px] text-fg-subtle">
            Estimated from published API prices. Subscription charges can differ.
          </p>

          {summary.totals.prompts > 0 && (
            <>
              <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
                {summary.insights.map((insight) => (
                  <div key={insight.id} className="rounded-lg border border-border bg-bg-subtle p-3">
                    <div className="text-[10px] font-medium tracking-wide text-fg-subtle uppercase">
                      {insight.title}
                    </div>
                    <div className="mt-1 truncate text-sm font-semibold text-fg" title={insight.value}>
                      {insight.value}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-4 text-fg-muted">{insight.detail}</div>
                  </div>
                ))}
              </div>
              <TokenChart summary={summary} />
            </>
          )}
        </>
      )}

      <section>
        <div className="mb-2 flex items-end gap-3">
          <div className="flex-1">
            <SectionTitle>Agent allowances</SectionTitle>
            <p className="text-xs text-fg-subtle">
              Your own rolling token budgets: 5-hour session, 7-day week, or 30-day month. These are not
              provider-reported limits.
            </p>
          </div>
          <Gauge size={16} className="mb-1 text-fg-subtle" />
        </div>
        <div className="space-y-2">
          {summary.allowances.map((allowance) => (
            <AllowanceCard key={`${allowance.agentId}:${allowance.tokenLimit ?? 'none'}`} allowance={allowance} />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SectionTitle>Breakdown</SectionTitle>
          <div className="flex-1" />
          <Segmented
            label="Group usage by"
            value={breakdown}
            options={[
              { value: 'agent', label: 'Agents' },
              { value: 'model', label: 'Models' },
              { value: 'pr', label: 'PRs' },
              { value: 'project', label: 'Projects' },
            ]}
            onChange={setBreakdown}
          />
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          {groups.length === 0 ? (
            <p className="p-4 text-xs text-fg-muted">No usage in this time range.</p>
          ) : (
            groups.map((group) => <GroupRow key={group.id} group={group} />)
          )}
        </div>
      </section>

      {summary.prompts.length > 0 && (
        <section>
          <SectionTitle>Prompt history</SectionTitle>
          <p className="mb-2 text-xs text-fg-subtle">
            Share is each prompt's percentage of tokens in this view. Allowance is its percentage of that agent's full
            local budget.
          </p>
          <div className="max-h-80 overflow-auto rounded-lg border border-border">
            {summary.prompts.map((prompt) => (
              <div
                key={prompt.id}
                data-testid="usage-prompt-row"
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border px-3 py-2 last:border-0"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium">{prompt.agentName}</span>
                    <span className="truncate font-mono text-[11px] text-fg-muted">{prompt.modelId}</span>
                    {prompt.pr && (
                      <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">
                        PR #{prompt.pr.number}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-fg-subtle">
                    {new Date(prompt.at).toLocaleString()} · {formatDuration(prompt.durationMs)} worked
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-medium">{formatTokens(prompt.tokens.total)} tokens</div>
                  <div className="mt-0.5 text-[11px] text-fg-subtle">
                    {prompt.sharePct.toFixed(1)}% of view
                    {prompt.allowancePct !== null ? ` · ${prompt.allowancePct.toFixed(2)}% of budget` : ''} ·{' '}
                    {formatCost(prompt.costUsd)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <PricingSettings />
      <SectionTitle>Future account sync</SectionTitle>
      <SettingRow
        title="Save usage to my account"
        detail="Available once you are signed in. Local tracking works without an account."
      >
        <Toggle on={false} label="Save usage to my account" onChange={() => undefined} disabled />
      </SettingRow>
    </div>
  );
}

function EmptyUsage() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-bg-subtle px-6 py-10 text-center">
      <TrendingUp size={24} className="mx-auto text-accent" />
      <h3 className="mt-3 text-sm font-semibold">Your token trail starts with the next prompt</h3>
      <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-fg-muted">
        Arbora will chart each agent and model here. Agents that only report context-window size still get working time;
        their token count stays “not reported” rather than guessed.
      </p>
    </div>
  );
}

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 text-[10px] text-fg-subtle">{detail}</div>
    </div>
  );
}

function TokenChart({ summary }: { summary: UsageSummary }) {
  const days = summary.days.slice(-30);
  const max = Math.max(1, ...days.map((day) => day.tokens));
  return (
    <section className="rounded-lg border border-border bg-bg-subtle p-3">
      <div className="mb-3 flex items-center">
        <div>
          <h3 className="text-xs font-semibold">Token trail</h3>
          <p className="text-[11px] text-fg-subtle">Daily tokens, with prompts in the tooltip</p>
        </div>
        <div className="flex-1" />
        <span className="text-[10px] text-fg-subtle">
          {days.length} {days.length === 1 ? 'day' : 'days'}
        </span>
      </div>
      <div className="flex h-24 items-end gap-1" aria-label="Daily token usage">
        {days.map((day) => (
          <div
            key={day.day}
            className="group flex h-full min-w-0 flex-1 flex-col justify-end gap-1"
            title={`${day.day}: ${formatTokens(day.tokens)} tokens · ${day.prompts} prompts · ${formatCost(day.costUsd)} estimated`}
          >
            <div
              className={clsx(
                'min-h-1 rounded-t transition-colors',
                day.tokens > 0 ? 'bg-accent group-hover:opacity-80' : 'bg-border',
              )}
              style={{ height: `${Math.max(4, (day.tokens / max) * 76)}px` }}
            />
            {(days.length <= 10 || day.day.endsWith('-01') || day === days[days.length - 1]) && (
              <span className="truncate text-center text-[8px] text-fg-subtle">
                {new Date(`${day.day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric' })}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function AllowanceCard({ allowance }: { allowance: UsageSummary['allowances'][number] }) {
  const usage = useApp((s) => s.settings.usage);
  const current = usage.allowances[allowance.agentId] ?? { period: 'week' as const, tokenLimit: null };
  const [draft, setDraft] = useState(current.tokenLimit?.toString() ?? '');
  const save = (period: UsageAllowancePeriod, tokenLimit: number | null): void => {
    void updateSettings({
      usage: { allowances: { ...usage.allowances, [allowance.agentId]: { period, tokenLimit } } },
    });
  };
  const pct = Math.min(100, allowance.usedPct ?? 0);
  return (
    <div className="rounded-lg border border-border bg-bg p-3" data-testid={`usage-allowance-${allowance.agentId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Bot size={14} className="text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{allowance.agentName}</span>
        <select
          aria-label={`${allowance.agentName} allowance period`}
          className={inputClass}
          value={current.period}
          onChange={(event) => save(event.target.value as UsageAllowancePeriod, current.tokenLimit)}
        >
          <option value="session">5-hour session</option>
          <option value="week">7-day week</option>
          <option value="month">30-day month</option>
        </select>
        <input
          aria-label={`${allowance.agentName} token budget`}
          className={clsx(inputClass, 'w-32')}
          type="number"
          min="1"
          step="1000"
          placeholder="No token limit"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const parsed = draft.trim() === '' ? null : Number(draft);
            if (parsed === null || (Number.isSafeInteger(parsed) && parsed > 0)) save(current.period, parsed);
            else setDraft(current.tokenLimit?.toString() ?? '');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-muted">
        <div
          className={clsx('h-full rounded-full', pct >= 90 ? 'bg-danger' : pct >= 75 ? 'bg-amber-500' : 'bg-accent')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-1 text-[11px] text-fg-subtle">
        <span>{formatTokens(allowance.usedTokens)} used in this rolling period</span>
        <span>
          {allowance.remainingTokens !== null
            ? `${formatTokens(allowance.remainingTokens)} left · ${(allowance.usedPct ?? 0).toFixed(1)}% used`
            : 'Set a budget to see what is left'}
        </span>
      </div>
    </div>
  );
}

function GroupRow({ group }: { group: UsageGroup }) {
  return (
    <div className="border-b border-border px-3 py-2 last:border-0" data-testid="usage-group-row">
      <div className="flex items-center gap-3 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium" title={group.label}>
          {group.label}
        </span>
        <span className="w-20 text-right">{formatTokens(group.tokens.total)}</span>
        <span className="w-16 text-right text-fg-muted">{group.sharePct.toFixed(1)}%</span>
        <span
          className="w-16 text-right text-fg-muted"
          title={group.costUsd === null ? undefined : `$${group.costUsd.toFixed(4)}`}
        >
          {formatCost(group.costUsd)}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-bg-muted">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, group.sharePct)}%` }} />
        </div>
        <span className="text-[10px] text-fg-subtle">
          {group.prompts} prompts · {formatDuration(group.durationMs)}
        </span>
      </div>
    </div>
  );
}

function ExportButton({ format }: { format: 'json' | 'csv' }) {
  return (
    <button
      type="button"
      data-testid={`usage-export-${format}`}
      onClick={() => {
        void window.arbora
          .invoke('usage.export', { format })
          .then(({ path }) => {
            if (path) showToast(`Usage exported to ${path}`);
          })
          .catch((error: unknown) => showToast(`Could not export usage: ${(error as Error).message}`));
      }}
      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-bg-muted"
    >
      <Download size={11} /> {format.toUpperCase()}
    </button>
  );
}

function PricingSettings() {
  const overrides = useApp((s) => s.settings.usage.priceOverrides);
  return (
    <section>
      <SectionTitle>Model prices</SectionTitle>
      <p className="mb-2 text-xs text-fg-subtle">
        USD per 1M tokens. Rates are snapshots; each turn keeps the rate used at the time.
      </p>
      <div className="overflow-hidden rounded-lg border border-border">
        {MODEL_PRICE_ROWS.map((row) => (
          <div
            key={row.label}
            className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-[11px] last:border-0"
          >
            <div className="min-w-40 flex-1">
              <div className="font-medium">{row.label}</div>
              <div className="text-fg-subtle">
                {row.provider} · {row.price.asOf}
              </div>
            </div>
            <span>In {row.price.input}</span>
            <span>Out {row.price.output}</span>
            <span>Read {row.price.cacheRead}</span>
            <span>Write {row.price.cacheWrite}</span>
          </div>
        ))}
      </div>
      {overrides.length > 0 && (
        <div className="mt-2 space-y-1">
          {overrides.map((override) => (
            <div key={override.modelId} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-mono">{override.modelId}</span>
              <span className="text-fg-subtle">
                Custom: {override.input} / {override.output} / {override.cacheRead} / {override.cacheWrite}
              </span>
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() =>
                  void updateSettings({
                    usage: { priceOverrides: overrides.filter((row) => row.modelId !== override.modelId) },
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <PriceOverrideForm />
    </section>
  );
}

function PriceOverrideForm() {
  const overrides = useApp((s) => s.settings.usage.priceOverrides);
  const [modelId, setModelId] = useState('');
  const [rates, setRates] = useState({ input: '0', output: '0', cacheRead: '0', cacheWrite: '0' });
  const valid =
    modelId.trim() !== '' && Object.values(rates).every((rate) => Number.isFinite(Number(rate)) && Number(rate) >= 0);
  return (
    <div className="mt-3 rounded-lg border border-border bg-bg-subtle p-3">
      <div className="mb-2 text-xs font-medium">Add or update a price override</div>
      <input
        aria-label="Override model id"
        className={clsx(inputClass, 'mb-2 w-full font-mono')}
        placeholder="exact model id"
        value={modelId}
        onChange={(event) => setModelId(event.target.value)}
      />
      <div className="grid grid-cols-4 gap-2">
        {(['input', 'output', 'cacheRead', 'cacheWrite'] as const).map((key) => (
          <label key={key} className="text-[10px] text-fg-subtle">
            {key}
            <input
              aria-label={`Override ${key} price`}
              type="number"
              min="0"
              step="0.01"
              className={clsx(inputClass, 'mt-1 w-full')}
              value={rates[key]}
              onChange={(event) => setRates({ ...rates, [key]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={!valid}
        className="mt-2 rounded bg-accent px-2.5 py-1 text-xs text-accent-fg disabled:opacity-40"
        onClick={() => {
          if (!valid) return;
          const next = {
            modelId: modelId.trim(),
            input: Number(rates.input),
            output: Number(rates.output),
            cacheRead: Number(rates.cacheRead),
            cacheWrite: Number(rates.cacheWrite),
          };
          void updateSettings({
            usage: { priceOverrides: [...overrides.filter((row) => row.modelId !== next.modelId), next] },
          });
          setModelId('');
        }}
      >
        Save override
      </button>
    </div>
  );
}
