import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { checkedAgents, DESKTOP_ROOT, focusChrome, launch, startAgent, tempUserData } from './app';

const FAKE_AGENT = resolve(DESKTOP_ROOT, 'e2e/fake-terminal-agent.mjs');
const FAKE_ID = 'fake';

function fixture(): { project: string; userData: string } {
  const project = mkdtempSync(join(tmpdir(), 'arbora-usage-project-'));
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'usage-fixture', private: true }));
  const userData = tempUserData();
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      version: 7,
      agents: {
        custom: [{ id: FAKE_ID, name: 'Fake agent', command: process.execPath, args: [FAKE_AGENT], env: {} }],
        ...checkedAgents([FAKE_ID]),
      },
    }),
  );
  return { project, userData };
}

async function send(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('composer-input');
  await input.fill(text);
  await input.press('Enter');
  await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', { timeout: 30_000 });
}

async function openUsage(page: Page): Promise<void> {
  await focusChrome(page);
  await page.keyboard.press('ControlOrMeta+,');
  await page.getByTestId('settings-nav-usage').click();
  await expect(page.getByTestId('usage-section')).toBeVisible();
}

/** The rows this project's ledger recorded on disk. */
function ledgerRows(project: string): { durationMs: number; tokensReported: boolean; costUsd: number | null }[] {
  const dir = join(project, '.arbora', 'usage');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      const file = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { turns?: unknown[] };
      return (file['turns'] ?? []) as { durationMs: number; tokensReported: boolean; costUsd: number | null }[];
    });
}

test("records each turn's working time on the ledger and survives restart", async () => {
  const { project, userData } = fixture();
  const first = await launch(userData, [project]);
  try {
    await startAgent(first.page, FAKE_ID);
    // A turn of about a second: the row keeps the working time, with no protocol tokens to price.
    await send(first.page, 'stream 40');
    await expect.poll(() => ledgerRows(project), { timeout: 30_000 }).toHaveLength(1);
    const [row] = ledgerRows(project);
    expect(row?.durationMs).toBeGreaterThanOrEqual(500);
    expect(row?.tokensReported).toBe(false);
    expect(row?.costUsd).toBeNull();
    // The session badge shows the working time and says tokens were not reported.
    await expect(first.page.getByTestId('session-usage')).toContainText('worked');
    await expect(first.page.getByTestId('session-usage')).toContainText('tokens not reported');

    await send(first.page, 'hello');
    await expect.poll(() => ledgerRows(project), { timeout: 30_000 }).toHaveLength(2);
    await openUsage(first.page);
    await expect(first.page.getByTestId('usage-prompt-row')).toHaveCount(2);
    await expect(first.page.getByTestId('usage-section')).toContainText('0');
  } finally {
    await first.app.close();
  }

  const second = await launch(userData, [project]);
  try {
    await openUsage(second.page);
    await expect(second.page.getByTestId('usage-prompt-row')).toHaveCount(2);
  } finally {
    await second.app.close();
    rmSync(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
