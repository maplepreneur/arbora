import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  costUsd,
  priceFor,
  usageLedgerFileSchema,
  type ModelPriceOverride,
  type TokenCount,
  type UsagePr,
  type UsageTurn,
} from '@arbora/shared';
import { GitService } from '../git/git-service.js';
import { listPullRequests } from '../git/github.js';
import {
  ARBORA_DIR,
  ensureArboraGitignore,
  readProjectSettings,
  updateProjectSettingsFile,
} from '../project-settings.js';
import { writeJsonAtomic } from '../settings-store.js';

export type UsageTurnInput = Omit<
  UsageTurn,
  'at' | 'branch' | 'pr' | 'price' | 'costUsd' | 'projectLabel' | 'usageProjectId' | 'syncedAt'
>;

export interface UsageLedgerOptions {
  readonly projectPath: string;
  readonly priceOverrides: () => readonly ModelPriceOverride[];
  readonly environment: () => Promise<NodeJS.ProcessEnv>;
  readonly onChanged: (threadId: string) => void;
  readonly now?: () => number;
  readonly listPrs?: (root: string, env: NodeJS.ProcessEnv) => Promise<UsagePr[]>;
}

export class UsageLedger {
  private readonly now: () => number;
  private readonly listPrs: (root: string, env: NodeJS.ProcessEnv) => Promise<UsagePr[]>;
  private tail: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly options: UsageLedgerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.listPrs = options.listPrs ?? listPullRequests;
  }

  record(input: UsageTurnInput, lastReport: { modelId: string; tokens: TokenCount } | null): UsageTurn {
    const price = priceFor(input.modelId, this.options.priceOverrides());
    const tokens = {
      input: input.inputTokens,
      output: input.outputTokens,
      cacheRead: input.cacheReadTokens,
      cacheWrite: input.cacheWriteTokens,
    };
    const turn: UsageTurn = {
      ...input,
      at: new Date(this.now()).toISOString(),
      branch: null,
      pr: null,
      price,
      costUsd: input.tokensReported ? costUsd(tokens, price) : null,
      projectLabel: basename(this.options.projectPath),
      usageProjectId: this.projectId(),
      syncedAt: null,
    };
    const file = this.readThread(input.threadId);
    this.writeThread(input.threadId, { ...file, turns: [...file.turns, turn], lastReport });
    this.options.onChanged(input.threadId);
    this.tail = this.tail
      .then(() => this.enrich(turn.id))
      .catch((error: unknown) => console.warn(`[usage] could not link turn to git: ${(error as Error).message}`));
    return turn;
  }

  list(): UsageTurn[] {
    const directory = this.directory();
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .flatMap((name) => this.readThread(name.slice(0, -5)).turns)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  lastReport(threadId: string): { modelId: string; tokens: TokenCount } | null {
    return this.readThread(threadId).lastReport;
  }

  relinkPullRequests(): Promise<void> {
    this.tail = this.tail
      .then(() => this.relink())
      .catch((error: unknown) => console.warn(`[usage] could not relink pull requests: ${(error as Error).message}`));
    return this.tail;
  }

  export(format: 'json' | 'csv'): string {
    const turns = this.list();
    if (format === 'json') return `${JSON.stringify({ version: 1, turns }, null, 2)}\n`;
    const columns = [
      'id',
      'at',
      'agentId',
      'modelId',
      'threadId',
      'projectLabel',
      'usageProjectId',
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'tokensReported',
      'durationMs',
      'costUsd',
      'branch',
      'prNumber',
      'prUrl',
    ] as const;
    const rows = turns.map((turn) =>
      columns
        .map((column) => {
          if (column === 'prNumber') return turn.pr?.number ?? '';
          if (column === 'prUrl') return turn.pr?.url ?? '';
          const value = turn[column];
          return value === null ? '' : String(value);
        })
        .map(csvCell)
        .join(','),
    );
    return `${columns.join(',')}\n${rows.join('\n')}\n`;
  }

  dispose(): void {
    this.disposed = true;
  }

  private async enrich(turnId: string): Promise<void> {
    if (this.disposed) return;
    const env = await this.options.environment();
    const git = new GitService({ root: this.options.projectPath, env: () => Promise.resolve(env) });
    const status = await git.status().catch(() => null);
    const branch = status?.repo ? status.branch : null;
    let prs: UsagePr[] = [];
    if (branch) prs = await this.listPrs(this.options.projectPath, env).catch(() => []);
    this.updateTurn(turnId, (turn) => ({
      ...turn,
      branch: turn.branch ?? branch,
      pr: turn.pr ?? (branch ? (prs.find((candidate) => candidate.head === branch) ?? null) : null),
    }));
  }

  private async relink(): Promise<void> {
    if (this.disposed) return;
    const turns = this.list().filter((turn) => turn.branch !== null && turn.pr === null);
    if (turns.length === 0) return;
    const prs = await this.listPrs(this.options.projectPath, await this.options.environment()).catch(() => []);
    if (prs.length === 0) return;
    for (const turn of turns) {
      const pr = prs.find((candidate) => candidate.head === turn.branch);
      if (pr) this.updateTurn(turn.id, (current) => ({ ...current, pr: current.pr ?? pr }));
    }
  }

  private updateTurn(turnId: string, update: (turn: UsageTurn) => UsageTurn): void {
    for (const threadId of new Set(this.list().map((turn) => turn.threadId))) {
      const file = this.readThread(threadId);
      if (!file.turns.some((turn) => turn.id === turnId)) continue;
      const turns = file.turns.map((turn) => (turn.id === turnId ? update(turn) : turn));
      this.writeThread(threadId, { ...file, turns });
      this.options.onChanged(threadId);
      return;
    }
  }

  private projectId(): string {
    const existing = readProjectSettings(this.options.projectPath).settings.usageProjectId;
    if (existing) return existing;
    const usageProjectId = randomUUID();
    updateProjectSettingsFile(this.options.projectPath, { usageProjectId });
    return usageProjectId;
  }

  private directory(): string {
    return join(this.options.projectPath, ARBORA_DIR, 'usage');
  }

  private pathFor(threadId: string): string {
    if (!/^[\w-]+$/.test(threadId)) throw new Error(`Invalid thread id ${threadId}`);
    return join(this.directory(), `${threadId}.json`);
  }

  private readThread(threadId: string): ReturnType<typeof usageLedgerFileSchema.parse> {
    try {
      const parsed = usageLedgerFileSchema.safeParse(JSON.parse(readFileSync(this.pathFor(threadId), 'utf8')));
      if (parsed.success) return parsed.data;
    } catch {
      // A missing or damaged thread ledger starts empty; other thread ledgers remain readable.
    }
    return { version: 1, turns: [], lastReport: null };
  }

  private writeThread(threadId: string, file: ReturnType<typeof usageLedgerFileSchema.parse>): void {
    writeJsonAtomic(this.pathFor(threadId), file);
    ensureArboraGitignore(this.options.projectPath);
  }
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
