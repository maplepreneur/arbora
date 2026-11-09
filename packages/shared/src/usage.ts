import { z } from 'zod';

export const tokenCountSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
});
export type TokenCount = z.infer<typeof tokenCountSchema>;

export const modelPriceSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  per: z.literal(1_000_000),
  asOf: z.string().min(1),
});
export type ModelPrice = z.infer<typeof modelPriceSchema>;

export const modelPriceOverrideSchema = modelPriceSchema
  .omit({ per: true, asOf: true })
  .extend({ modelId: z.string().min(1).max(300) });
export type ModelPriceOverride = z.infer<typeof modelPriceOverrideSchema>;

export const usagePrSchema = z.object({
  number: z.number().int().positive(),
  url: z.url(),
  head: z.string().min(1),
});
export type UsagePr = z.infer<typeof usagePrSchema>;

export const usageTurnSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  at: z.iso.datetime(),
  agentId: z.string().min(1),
  modelId: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  tokensReported: z.boolean().default(false),
  durationMs: z.number().int().nonnegative(),
  branch: z.string().nullable(),
  pr: usagePrSchema.nullable(),
  price: modelPriceSchema.nullable(),
  costUsd: z.number().nonnegative().nullable(),
  reportedCost: z.object({ amount: z.number().nonnegative(), currency: z.string().min(1) }).nullable(),
  projectLabel: z.string().min(1),
  usageProjectId: z.uuid(),
  parentThreadId: z.string().nullable().default(null),
  syncedAt: z.iso.datetime().nullable(),
});
export type UsageTurn = z.infer<typeof usageTurnSchema>;

export const usageLedgerFileSchema = z.object({
  version: z.literal(1),
  turns: z.array(usageTurnSchema),
  lastReport: z
    .object({ modelId: z.string().min(1), tokens: tokenCountSchema })
    .nullable()
    .default(null),
});
export type UsageLedgerFile = z.infer<typeof usageLedgerFileSchema>;

export const usageAllowancePeriodSchema = z.enum(['session', 'week', 'month']);
export type UsageAllowancePeriod = z.infer<typeof usageAllowancePeriodSchema>;

export const usageAllowanceSchema = z.object({
  period: usageAllowancePeriodSchema.default('week'),
  tokenLimit: z.number().int().positive().max(1_000_000_000_000).nullable().default(null),
});
export type UsageAllowance = z.infer<typeof usageAllowanceSchema>;

export const usageRangeSchema = z.enum(['today', '7d', '30d', 'all']);
export type UsageRange = z.infer<typeof usageRangeSchema>;

export interface UsageReport {
  readonly modelId: string | null;
  readonly tokens: TokenCount | null;
  readonly context: { readonly used: number; readonly size: number } | null;
  readonly reportedCost: { readonly amount: number; readonly currency: string } | null;
}

export function parseUsageReport(raw: unknown): UsageReport {
  const update = objectRecord(raw);
  const nested = objectRecord(update?.['tokens']);
  const read = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = update?.[key] ?? nested?.[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
    }
    return undefined;
  };
  const input = read('inputTokens', 'input_tokens', 'input');
  const output = read('outputTokens', 'output_tokens', 'output');
  const cacheRead = read('cacheReadTokens', 'cache_read_input_tokens', 'cacheRead');
  const cacheWrite = read('cacheWriteTokens', 'cache_creation_input_tokens', 'cacheWrite');
  const anyTokens = [input, output, cacheRead, cacheWrite].some((value) => value !== undefined);
  const model = update?.['modelId'];
  const cost = objectRecord(update?.['cost']);
  const used = read('used');
  const size = read('size');
  return {
    modelId: typeof model === 'string' && model.trim() ? model : null,
    tokens: anyTokens
      ? { input: input ?? 0, output: output ?? 0, cacheRead: cacheRead ?? 0, cacheWrite: cacheWrite ?? 0 }
      : null,
    context: used !== undefined && size !== undefined ? { used, size } : null,
    reportedCost:
      typeof cost?.['amount'] === 'number' && cost['amount'] >= 0 && typeof cost['currency'] === 'string'
        ? { amount: cost['amount'], currency: cost['currency'] }
        : null,
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export interface UsageTotals {
  readonly tokens: TokenCount & { readonly total: number };
  readonly costUsd: number | null;
  readonly durationMs: number;
  readonly prompts: number;
  readonly tokensReported: boolean;
  readonly unpricedTurns: number;
}

export interface UsageGroup extends UsageTotals {
  readonly id: string;
  readonly label: string;
  readonly sharePct: number;
}

export interface UsageDay {
  readonly day: string;
  readonly tokens: number;
  readonly costUsd: number | null;
  readonly prompts: number;
}

export interface UsagePrompt extends UsageTotals {
  readonly id: string;
  readonly at: string;
  readonly threadId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly modelId: string;
  readonly branch: string | null;
  readonly pr: UsagePr | null;
  readonly sharePct: number;
  readonly allowancePct: number | null;
}

export interface UsageAllowanceStatus {
  readonly agentId: string;
  readonly agentName: string;
  readonly period: UsageAllowancePeriod;
  readonly tokenLimit: number | null;
  readonly usedTokens: number;
  readonly remainingTokens: number | null;
  readonly usedPct: number | null;
  readonly windowStart: number;
  readonly resetAt: number | null;
}

export interface UsageInsight {
  readonly id: 'cache' | 'pace' | 'agent' | 'day';
  readonly title: string;
  readonly detail: string;
  readonly value: string;
}

export interface UsageSummary {
  readonly range: UsageRange;
  readonly generatedAt: number;
  readonly totals: UsageTotals;
  readonly byAgent: UsageGroup[];
  readonly byModel: UsageGroup[];
  readonly byProject: UsageGroup[];
  readonly byPr: UsageGroup[];
  readonly days: UsageDay[];
  readonly prompts: UsagePrompt[];
  readonly allowances: UsageAllowanceStatus[];
  readonly insights: UsageInsight[];
}

export function emptyTokens(): TokenCount {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function addTokens(a: TokenCount, b: TokenCount): TokenCount {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

export function totalTokens(tokens: TokenCount): number {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
}

export function turnTokens(turn: UsageTurn): TokenCount {
  return {
    input: turn.inputTokens,
    output: turn.outputTokens,
    cacheRead: turn.cacheReadTokens,
    cacheWrite: turn.cacheWriteTokens,
  };
}

export function sliceTokens(
  previous: { readonly modelId: string; readonly tokens: TokenCount } | null,
  next: { readonly modelId: string; readonly tokens: TokenCount },
): TokenCount {
  if (!previous || previous.modelId !== next.modelId) return next.tokens;
  const cumulative = (['input', 'output', 'cacheRead', 'cacheWrite'] as const).every(
    (key) => next.tokens[key] >= previous.tokens[key],
  );
  if (!cumulative) return next.tokens;
  return {
    input: next.tokens.input - previous.tokens.input,
    output: next.tokens.output - previous.tokens.output,
    cacheRead: next.tokens.cacheRead - previous.tokens.cacheRead,
    cacheWrite: next.tokens.cacheWrite - previous.tokens.cacheWrite,
  };
}

export function costUsd(tokens: TokenCount, price: Omit<ModelPrice, 'per' | 'asOf'> | null): number | null {
  if (!price) return null;
  return (
    (tokens.input / 1_000_000) * price.input +
    (tokens.output / 1_000_000) * price.output +
    (tokens.cacheRead / 1_000_000) * price.cacheRead +
    (tokens.cacheWrite / 1_000_000) * price.cacheWrite
  );
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${trimNumber(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${trimNumber(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimNumber(value / 1_000)}K`;
  return String(Math.round(value));
}

export function formatCost(value: number | null): string {
  if (value === null) return '—';
  if (value > 0 && value < 0.01) return '<$0.01';
  return `$${value.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.max(0, Math.round(ms / 1000))}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function allowanceWindow(period: UsageAllowancePeriod, now: number): { start: number; duration: number } {
  const duration = period === 'session' ? 5 * 60 * 60 * 1000 : period === 'week' ? 7 * 86400000 : 30 * 86400000;
  return { start: now - duration, duration };
}

export function buildUsageSummary(
  turns: readonly UsageTurn[],
  options: {
    readonly range: UsageRange;
    readonly now: number;
    readonly agents: readonly { readonly id: string; readonly name: string }[];
    readonly allowances: Readonly<Record<string, UsageAllowance>>;
    readonly threadId?: string | undefined;
    readonly prNumber?: number | undefined;
  },
): UsageSummary {
  const start = usageRangeStart(options.range, options.now);
  const filtered = turns.filter((turn) => {
    const at = Date.parse(turn.at);
    return (
      at >= start &&
      (options.threadId === undefined || turn.threadId === options.threadId) &&
      (options.prNumber === undefined || turn.pr?.number === options.prNumber)
    );
  });
  const names = new Map(options.agents.map((agent) => [agent.id, agent.name]));
  const totals = summarizeTurns(filtered);
  const total = totals.tokens.total;
  const group = (key: (turn: UsageTurn) => string, label: (turn: UsageTurn, key: string) => string): UsageGroup[] => {
    const groups = new Map<string, { label: string; turns: UsageTurn[] }>();
    for (const turn of filtered) {
      const id = key(turn);
      const existing = groups.get(id);
      if (existing) existing.turns.push(turn);
      else groups.set(id, { label: label(turn, id), turns: [turn] });
    }
    return [...groups.entries()]
      .map(([id, entry]) => ({
        id,
        label: entry.label,
        ...summarizeTurns(entry.turns),
        sharePct: percent(summarizeTurns(entry.turns).tokens.total, total),
      }))
      .sort((a, b) => b.tokens.total - a.tokens.total || b.durationMs - a.durationMs || a.label.localeCompare(b.label));
  };
  const allowanceStatuses = allowanceSummary(turns, options.agents, options.allowances, options.now);
  const allowanceByAgent = new Map(allowanceStatuses.map((status) => [status.agentId, status]));
  const prompts = [...filtered]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 100)
    .map((turn): UsagePrompt => {
      const tokens = turnTokens(turn);
      const count = totalTokens(tokens);
      const allowance = allowanceByAgent.get(turn.agentId);
      return {
        id: turn.id,
        at: turn.at,
        threadId: turn.threadId,
        agentId: turn.agentId,
        agentName: names.get(turn.agentId) ?? turn.agentId,
        modelId: turn.modelId,
        branch: turn.branch,
        pr: turn.pr,
        ...summarizeTurns([turn]),
        sharePct: percent(count, total),
        allowancePct: allowance?.tokenLimit != null && count > 0 ? (count / allowance.tokenLimit) * 100 : null,
      };
    });
  return {
    range: options.range,
    generatedAt: options.now,
    totals,
    byAgent: group(
      (turn) => turn.agentId,
      (turn) => names.get(turn.agentId) ?? turn.agentId,
    ),
    byModel: group(
      (turn) => turn.modelId,
      (turn) => turn.modelId,
    ),
    byProject: group(
      (turn) => turn.usageProjectId,
      (turn) => turn.projectLabel,
    ),
    byPr: group(
      (turn) => turn.pr?.url ?? 'unlinked',
      (turn) => (turn.pr ? `#${turn.pr.number}` : 'No linked PR'),
    ),
    days: dailyUsage(filtered, options.range, start, options.now),
    prompts,
    allowances: allowanceStatuses,
    insights: usageInsights(filtered, totals, names, options.now),
  };
}

export function usageRangeStart(range: UsageRange, now: number): number {
  if (range === 'all') return 0;
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  if (range === 'today') return date.getTime();
  return date.getTime() - (range === '7d' ? 6 : 29) * 86400000;
}

function summarizeTurns(turns: readonly UsageTurn[]): UsageTotals {
  let tokens = emptyTokens();
  let cost: number | null = null;
  let durationMs = 0;
  let tokensReported = false;
  let unpricedTurns = 0;
  for (const turn of turns) {
    tokens = addTokens(tokens, turnTokens(turn));
    if (turn.costUsd !== null) cost = (cost ?? 0) + turn.costUsd;
    if (turn.tokensReported && turn.price === null) unpricedTurns++;
    tokensReported ||= turn.tokensReported;
    durationMs += turn.durationMs;
  }
  return {
    tokens: { ...tokens, total: totalTokens(tokens) },
    costUsd: cost,
    durationMs,
    prompts: turns.length,
    tokensReported,
    unpricedTurns,
  };
}

function allowanceSummary(
  turns: readonly UsageTurn[],
  agents: readonly { readonly id: string; readonly name: string }[],
  configured: Readonly<Record<string, UsageAllowance>>,
  now: number,
): UsageAllowanceStatus[] {
  const known = new Map(agents.map((agent) => [agent.id, agent.name]));
  for (const turn of turns) if (!known.has(turn.agentId)) known.set(turn.agentId, turn.agentId);
  return [...known.entries()]
    .map(([agentId, agentName]): UsageAllowanceStatus => {
      const allowance = configured[agentId] ?? usageAllowanceSchema.parse({});
      const window = allowanceWindow(allowance.period, now);
      const inWindow = turns.filter((turn) => turn.agentId === agentId && Date.parse(turn.at) >= window.start);
      const usedTokens = inWindow.reduce((sum, turn) => sum + totalTokens(turnTokens(turn)), 0);
      const oldest = inWindow.reduce(
        (oldestAt, turn) => Math.min(oldestAt, Date.parse(turn.at)),
        Number.POSITIVE_INFINITY,
      );
      return {
        agentId,
        agentName,
        period: allowance.period,
        tokenLimit: allowance.tokenLimit,
        usedTokens,
        remainingTokens: allowance.tokenLimit === null ? null : Math.max(0, allowance.tokenLimit - usedTokens),
        usedPct: allowance.tokenLimit === null ? null : (usedTokens / allowance.tokenLimit) * 100,
        windowStart: window.start,
        resetAt: Number.isFinite(oldest) ? oldest + window.duration : null,
      };
    })
    .sort((a, b) => (b.usedPct ?? -1) - (a.usedPct ?? -1) || b.usedTokens - a.usedTokens);
}

function dailyUsage(turns: readonly UsageTurn[], range: UsageRange, start: number, now: number): UsageDay[] {
  const byDay = new Map<string, UsageTurn[]>();
  for (const turn of turns) {
    const day = localDay(new Date(Date.parse(turn.at)));
    const rows = byDay.get(day) ?? [];
    rows.push(turn);
    byDay.set(day, rows);
  }
  const days = range === 'all' ? [...byDay.keys()].sort() : enumerateDays(start, now);
  return days.map((day) => {
    const summary = summarizeTurns(byDay.get(day) ?? []);
    return { day, tokens: summary.tokens.total, costUsd: summary.costUsd, prompts: summary.prompts };
  });
}

function usageInsights(
  turns: readonly UsageTurn[],
  totals: UsageTotals,
  names: ReadonlyMap<string, string>,
  now: number,
): UsageInsight[] {
  if (turns.length === 0) return [];
  const input = totals.tokens.input + totals.tokens.cacheRead;
  const cachePct = percent(totals.tokens.cacheRead, input);
  const byAgent = new Map<string, { turns: number; tokens: number }>();
  const byDay = new Map<string, number>();
  for (const turn of turns) {
    const count = totalTokens(turnTokens(turn));
    const agent = byAgent.get(turn.agentId) ?? { turns: 0, tokens: 0 };
    agent.turns++;
    agent.tokens += count;
    byAgent.set(turn.agentId, agent);
    const day = localDay(new Date(Date.parse(turn.at)));
    byDay.set(day, (byDay.get(day) ?? 0) + count);
  }
  const topAgent = [...byAgent.entries()].sort((a, b) => b[1].tokens - a[1].tokens)[0];
  const topDay = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
  return [
    {
      id: 'cache',
      title: 'Cache rhythm',
      value: `${Math.round(cachePct)}%`,
      detail: input > 0 ? 'of input tokens came from cache reads' : 'No cache reads reported yet',
    },
    {
      id: 'pace',
      title: 'Prompt pace',
      value: formatTokens(totals.tokens.total / totals.prompts),
      detail: `tokens per prompt · ${formatDuration(totals.durationMs / totals.prompts)} worked on average`,
    },
    {
      id: 'agent',
      title: 'Most active agent',
      value: topAgent ? (names.get(topAgent[0]) ?? topAgent[0]) : '—',
      detail: topAgent ? `${formatTokens(topAgent[1].tokens)} tokens across ${topAgent[1].turns} prompts` : '',
    },
    {
      id: 'day',
      title: 'Peak day',
      value: topDay ? formatPeakDay(topDay[0], now) : '—',
      detail: topDay ? `${formatTokens(topDay[1])} tokens, your biggest day in this view` : '',
    },
  ];
}

function enumerateDays(start: number, now: number): string[] {
  const days: string[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= now) {
    days.push(localDay(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatPeakDay(day: string, now: number): string {
  if (day === localDay(new Date(now))) return 'Today';
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function percent(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}

function trimNumber(value: number): string {
  return value >= 100
    ? value.toFixed(0)
    : value >= 10
      ? value.toFixed(1).replace(/\.0$/, '')
      : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
