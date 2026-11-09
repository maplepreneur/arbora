import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { checkedAgents, DESKTOP_ROOT, focusChrome, launch, startAgent, tempUserData } from './app';

const FAKE_AGENT = resolve(DESKTOP_ROOT, '../../packages/acp-client/src/testing/fake-agent.ts');
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
        permissions: {},
        ...checkedAgents([FAKE_ID]),
      },
      usage: {
        priceOverrides: [{ modelId: 'fast', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
      },
    }),
  );
  return { project, userData };
}

async function send(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('composer-input');
  await input.fill(text);
  await input.press('Enter');
  await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', { timeout: 20_000 });
}

async function openUsage(page: Page): Promise<void> {
  await focusChrome(page);
  await page.keyboard.press('ControlOrMeta+,');
  await page.getByTestId('settings-nav-usage').click();
  await expect(page.getByTestId('usage-section')).toBeVisible();
}

test('records priced and context-only prompts, shows allowances and survives restart', async () => {
  const { project, userData } = fixture();
  const first = await launch(userData, [project]);
  try {
    await startAgent(first.page, FAKE_ID);
    await send(first.page, 'usage tokens');
    await expect(first.page.getByTestId('session-usage')).toContainText('~$11.10');

    await startAgent(first.page, FAKE_ID);
    await send(first.page, 'usage context');
    await expect(first.page.getByTestId('session-usage')).toContainText('tokens not reported');

    await openUsage(first.page);
    await expect(first.page.getByTestId('usage-prompt-row')).toHaveCount(2);
    await expect(first.page.getByTestId('usage-group-row').first()).toContainText('$11.10');
    await expect(first.page.getByTestId('usage-section')).toContainText('3.5M');
    await expect(first.page.getByTestId('usage-section')).toContainText('Cache rhythm');

    const budget = first.page.getByLabel('Fake agent token budget');
    await budget.fill('1000000');
    await budget.press('Enter');
    await expect(first.page.getByTestId(`usage-allowance-${FAKE_ID}`)).toContainText('0 left');
    await expect(first.page.getByTestId(`usage-allowance-${FAKE_ID}`)).toContainText('350.0% used');
  } finally {
    await first.app.close();
  }

  const second = await launch(userData, [project]);
  try {
    await openUsage(second.page);
    await expect(second.page.getByTestId('usage-prompt-row')).toHaveCount(2);
    await expect(second.page.getByTestId('usage-group-row').first()).toContainText('$11.10');
    await expect(second.page.getByLabel('Fake agent token budget')).toHaveValue('1000000');
  } finally {
    await second.app.close();
  }
});
