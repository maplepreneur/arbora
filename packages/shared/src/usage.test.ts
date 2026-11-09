import { describe, expect, it } from 'vitest';
import { buildUsageSummary, costUsd, emptyTokens, parseUsageReport, sliceTokens, type UsageTurn } from './usage.js';

const tokens = { input: 100, output: 40, cacheRead: 20, cacheWrite: 10 };

function turn(patch: Partial<UsageTurn> = {}): UsageTurn {
  return {
    id: 'turn-1',
    threadId: 'thread-1',
    at: '2026-11-07T16:00:00.000Z',
    agentId: 'claude-code',
    modelId: 'claude-sonnet-4-6',
    inputTokens: 100,
    outputTokens: 40,
    cacheReadTokens: 20,
    cacheWriteTokens: 10,
    tokensReported: true,
    durationMs: 65_000,
    branch: 'feature',
    pr: { number: 42, url: 'https://github.com/example/repo/pull/42', head: 'feature' },
    price: null,
    costUsd: null,
    reportedCost: null,
    projectLabel: 'arbora',
    usageProjectId: '8d3f6f85-bbca-4ca3-a9a1-f233af238c34',
    parentThreadId: null,
    syncedAt: null,
    ...patch,
  };
}

describe('usage token slices', () => {
  it('subtracts cumulative counters', () => {
    expect(
      sliceTokens(
        { modelId: 'model', tokens },
        { modelId: 'model', tokens: { input: 160, output: 55, cacheRead: 20, cacheWrite: 15 } },
      ),
    ).toEqual({ input: 60, output: 15, cacheRead: 0, cacheWrite: 5 });
  });

  it('starts a new slice after a counter drop', () => {
    expect(sliceTokens({ modelId: 'model', tokens }, { modelId: 'model', tokens: emptyTokens() })).toEqual(
      emptyTokens(),
    );
  });

  it('does not diff different models', () => {
    expect(sliceTokens({ modelId: 'old', tokens }, { modelId: 'new', tokens })).toEqual(tokens);
  });

  it('adds nothing for a repeated zero report', () => {
    expect(sliceTokens(null, { modelId: 'model', tokens: emptyTokens() })).toEqual(emptyTokens());
  });
});

describe('usage cost', () => {
  it('prices every token class per million', () => {
    expect(
      costUsd(
        { input: 1_000_000, output: 500_000, cacheRead: 2_000_000, cacheWrite: 0 },
        { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      ),
    ).toBeCloseTo(11.1);
  });

  it('leaves unknown prices blank', () => {
    expect(costUsd(tokens, null)).toBeNull();
  });
});

describe('usage update parsing', () => {
  it('accepts wire aliases, context and reported cost', () => {
    expect(
      parseUsageReport({
        used: 500,
        size: 1000,
        modelId: 'model',
        input_tokens: 100,
        outputTokens: 40,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 10,
        cost: { amount: 0.2, currency: 'USD' },
      }),
    ).toEqual({
      modelId: 'model',
      tokens,
      context: { used: 500, size: 1000 },
      reportedCost: { amount: 0.2, currency: 'USD' },
    });
  });

  it('accepts nested tokens and never turns context into billable usage', () => {
    expect(parseUsageReport({ tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } }).tokens).toEqual({
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
    });
    expect(parseUsageReport({ used: 1, size: 2 })).toEqual({
      modelId: null,
      tokens: null,
      context: { used: 1, size: 2 },
      reportedCost: null,
    });
  });
});

describe('usage dashboard aggregation', () => {
  it('groups agents, models, days and PRs and computes prompt and allowance percentages', () => {
    const now = Date.parse('2026-11-07T23:00:00.000Z');
    const other = turn({
      id: 'turn-2',
      agentId: 'codex',
      modelId: 'gpt-5.3-codex',
      inputTokens: 100,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      at: '2026-11-06T16:00:00.000Z',
      pr: null,
    });
    const summary = buildUsageSummary([turn(), other], {
      range: '7d',
      now,
      agents: [
        { id: 'claude-code', name: 'Claude Code' },
        { id: 'codex', name: 'Codex' },
      ],
      allowances: { 'claude-code': { period: 'week', tokenLimit: 1700 } },
    });
    expect(summary.totals.tokens.total).toBe(270);
    expect(summary.byAgent[0]?.label).toBe('Claude Code');
    expect(summary.byPr.find((group) => group.id !== 'unlinked')?.tokens.total).toBe(170);
    expect(summary.prompts.find((prompt) => prompt.id === 'turn-1')).toMatchObject({
      sharePct: (170 / 270) * 100,
      allowancePct: 10,
    });
    expect(summary.allowances.find((allowance) => allowance.agentId === 'claude-code')).toMatchObject({
      usedTokens: 170,
      remainingTokens: 1530,
      usedPct: 10,
    });
    expect(summary.days).toHaveLength(7);
    expect(summary.insights).toHaveLength(4);
  });

  it('keeps working time when tokens are not reported', () => {
    const summary = buildUsageSummary(
      [turn({ tokensReported: false, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })],
      {
        range: 'all',
        now: Date.now(),
        agents: [],
        allowances: {},
      },
    );
    expect(summary.totals.tokensReported).toBe(false);
    expect(summary.totals.durationMs).toBe(65_000);
    expect(summary.totals.costUsd).toBeNull();
  });
});
