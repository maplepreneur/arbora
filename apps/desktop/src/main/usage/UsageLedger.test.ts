import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UsageTurnInput } from './UsageLedger.js';
import { UsageLedger } from './UsageLedger.js';

const temporary: string[] = [];

function project(): string {
  const path = mkdtempSync(join(tmpdir(), 'arbora-usage-'));
  temporary.push(path);
  return path;
}

function input(patch: Partial<UsageTurnInput> = {}): UsageTurnInput {
  return {
    id: 'turn-1',
    threadId: 'thread-1',
    agentId: 'fake',
    modelId: 'fast',
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    cacheReadTokens: 2_000_000,
    cacheWriteTokens: 0,
    tokensReported: true,
    durationMs: 1234,
    reportedCost: null,
    parentThreadId: null,
    ...patch,
  };
}

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('UsageLedger', () => {
  it('persists priced turns, the cumulative checkpoint and privacy-safe exports', async () => {
    const root = project();
    execFileSync('git', ['init', '-b', 'feature'], { cwd: root });
    const changes: string[] = [];
    const ledger = new UsageLedger({
      projectPath: root,
      now: () => Date.parse('2026-11-07T16:00:00.000Z'),
      priceOverrides: () => [{ modelId: 'fast', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
      environment: () => Promise.resolve({}),
      onChanged: (threadId) => changes.push(threadId),
      listPrs: () => Promise.resolve([{ number: 42, url: 'https://github.com/example/repo/pull/42', head: 'feature' }]),
    });
    const lastReport = {
      modelId: 'fast',
      tokens: { input: 1_000_000, output: 500_000, cacheRead: 2_000_000, cacheWrite: 0 },
    };
    const recorded = ledger.record(input(), lastReport);
    await ledger.relinkPullRequests();
    expect(recorded.costUsd).toBeCloseTo(11.1);
    expect(ledger.list()[0]?.pr?.number).toBe(42);
    expect(ledger.list()[0]?.branch).toBe('feature');
    expect(ledger.lastReport('thread-1')).toEqual(lastReport);
    expect(ledger.list()).toHaveLength(1);
    expect(changes).toContain('thread-1');

    const reopened = new UsageLedger({
      projectPath: root,
      priceOverrides: () => [],
      environment: () => Promise.resolve({}),
      onChanged: () => undefined,
    });
    expect(reopened.list()[0]).toMatchObject({ costUsd: 11.1, branch: 'feature', pr: { number: 42 } });
    expect(reopened.export('csv')).toContain('cacheReadTokens');
    expect(reopened.export('json')).not.toContain('App.tsx');
    expect(readFileSync(join(root, '.arbora', 'project.json'), 'utf8')).toContain('usageProjectId');
    expect(readFileSync(join(root, '.arbora', '.gitignore'), 'utf8')).toContain('*');
    ledger.dispose();
  });

  it('keeps time visible without a billable split, even when the model has a price', () => {
    const root = project();
    const ledger = new UsageLedger({
      projectPath: root,
      priceOverrides: () => [{ modelId: 'fast', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
      environment: () => Promise.resolve({}),
      onChanged: () => undefined,
    });
    const turn = ledger.record(
      input({ tokensReported: false, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
      null,
    );
    expect(turn.costUsd).toBeNull();
    expect(turn.durationMs).toBe(1234);
    expect(turn.tokensReported).toBe(false);
    ledger.dispose();
  });
});
