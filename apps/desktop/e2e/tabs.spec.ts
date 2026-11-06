import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { BrowserTabSnapshot, NavigationState } from '@arbora/shared';
import { checkedAgents, DESKTOP_ROOT, FIXTURES, launch, startAgent, tempUserData } from './app';
import { startStaticFixture } from './servers';

const FAKE_AGENT = join(DESKTOP_ROOT, '../../packages/acp-client/src/testing/fake-agent.ts');
const LOGIN = join(FIXTURES, 'login');
const DESIGN = join(FIXTURES, 'design-reference');
const PASSWORD = 's3cret-fixture-value';

function browserState(page: Page): Promise<NavigationState | null> {
  return page.evaluate(() => window.arbora.invoke('browser.getState'));
}

function tabs(page: Page): Promise<BrowserTabSnapshot[]> {
  return page.evaluate(() => window.arbora.invoke('browser.tabs.list'));
}

async function openUrl(page: Page, url: string): Promise<void> {
  const input = page.getByTestId('url-input');
  await input.click();
  await input.fill(url);
  await input.press('Enter');
  await expect
    .poll(async () => {
      const state = await browserState(page);
      return Boolean(state?.url.startsWith(url) && !state.loading);
    })
    .toBe(true);
}

test.describe('Stage 12 tabs and 1Password', () => {
  test('keeps the app tab and reopens a closed reference tab', async () => {
    const { app, page } = await launch(tempUserData(), [DESIGN]);
    try {
      await expect(page.getByTestId('browser-panel')).toBeVisible();
      await expect(page.locator('[data-testid="browser-tab"][data-tab-role="app"]')).toHaveCount(1);
      await expect(
        page.locator('[data-testid="browser-tab"][data-tab-role="app"]').getByTestId('browser-tab-close'),
      ).toHaveCount(0);

      await page.getByTestId('browser-tab-new').click();
      await expect(page.getByTestId('browser-tab')).toHaveCount(2);
      const opened = (await tabs(page)).find((tab) => tab.role === 'reference');
      if (!opened) throw new Error('No reference tab');

      await page.evaluate((id) => window.arbora.invoke('browser.tabs.close', { id }), opened.id);
      await expect(page.getByTestId('browser-tab')).toHaveCount(1);
      const reopened = await page.evaluate(() => window.arbora.invoke('browser.tabs.reopen'));
      expect(reopened.id).toBeTruthy();
      await expect(page.getByTestId('browser-tab')).toHaveCount(2);
    } finally {
      await app.close();
    }
  });

  test('refuses an ungranted tab and logs in without revealing the password', async () => {
    const login = await startStaticFixture(LOGIN);
    const design = await startStaticFixture(DESIGN);
    const userData = tempUserData();
    const opDir = mkdtempSync(join(tmpdir(), 'arbora-op-'));
    const op = join(opDir, 'op');
    writeFileSync(
      op,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const origin = process.env.OP_FIXTURE_ORIGIN || '';
if (args.join(' ').includes(${JSON.stringify(PASSWORD)})) {
  process.stderr.write('secret leaked to argv\\n');
  process.exit(3);
}
if (args[0] === '--version') {
  process.stdout.write('2.0.0-fixture\\n');
  process.exit(0);
}
if (args[1] === 'list') {
  process.stdout.write(JSON.stringify([{ id: 'item1', title: 'Fixture login', urls: [{ href: origin + '/' }] }]));
  process.exit(0);
}
if (args[1] === 'get') {
  process.stdout.write(JSON.stringify([
    { purpose: 'USERNAME', value: 'ada@example.com' },
    { purpose: 'PASSWORD', value: ${JSON.stringify(PASSWORD)} },
  ]));
  process.exit(0);
}
process.stderr.write('unexpected op\\n');
process.exit(2);
`,
    );
    chmodSync(op, 0o755);
    writeFileSync(
      join(userData, 'settings.json'),
      JSON.stringify({
        version: 7,
        passwords: { provider: '1password', mode: 'cli', agentLogins: 'ask', alwaysAllow: [] },
        agents: {
          custom: [{ id: 'fake', name: 'Fake agent', command: process.execPath, args: [FAKE_AGENT], env: {} }],
          permissions: {},
          ...checkedAgents(['fake']),
        },
      }),
    );
    let app: ElectronApplication | undefined;
    try {
      const launched = await launch(userData, [LOGIN], {
        ARBORA_OP: op,
        OP_FIXTURE_ORIGIN: new URL(login.url).origin,
      });
      app = launched.app;
      const { page } = launched;
      await expect(page.getByTestId('browser-panel')).toBeVisible();
      await openUrl(page, login.url);

      const reference = await page.evaluate((url) => window.arbora.invoke('browser.tabs.open', { url }), design.url);
      await startAgent(page, 'fake');
      const input = page.getByTestId('composer-input');
      await input.fill(`tab grant ${reference.id}`);
      await input.press('Enter');
      await expect(page.getByTestId('agent-message').last()).toContainText('tab not granted', { timeout: 20_000 });

      await input.fill('vault login');
      await input.press('Enter');
      await page.getByTestId('permission-allow_once').click({ timeout: 20_000 });
      await expect(page.getByTestId('agent-message').last()).toContainText('logged_in', { timeout: 20_000 });
      await expect
        .poll(
          () =>
            launched.app.evaluate(async ({ webContents }, pageUrl) => {
              const view = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith(pageUrl));
              if (!view) return '';
              return (await view.executeJavaScript('document.getElementById("out")?.textContent ?? ""')) as string;
            }, login.url),
          { timeout: 20_000 },
        )
        .toBe('welcome');
      const transcript = await page.getByTestId('transcript').innerText();
      expect(transcript).not.toContain(PASSWORD);
      const log = await page.evaluate(async () => {
        const threads = await window.arbora.invoke('agent.listThreads');
        const thread = threads[0];
        if (!thread) return '';
        const entries = await window.arbora.invoke('agent.getLog', { threadId: thread.id });
        return JSON.stringify(entries);
      });
      expect(log).not.toContain(PASSWORD);
    } finally {
      await app?.close();
      await login.close();
      await design.close();
    }
  });
});
