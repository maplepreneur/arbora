import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebContentsView } from 'electron';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { BrowserTabSnapshot, NavigationState } from '@arbora/shared';
import { checkedAgents, DESKTOP_ROOT, FIXTURES, launch, startAgent, tempUserData } from './app';
import { startStaticFixture, startViteFixture } from './servers';

const FAKE_AGENT = join(DESKTOP_ROOT, '../../packages/acp-client/src/testing/fake-agent.ts');
const LOGIN = join(FIXTURES, 'login');
const DESIGN = join(FIXTURES, 'design-reference');
const VITE_REACT = join(FIXTURES, 'vite-react');
const PASSWORD = 's3cret-fixture-value';
const MOD = process.platform === 'darwin' ? 'meta' : 'control';

function fakeAgentSettings(userData: string): void {
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      version: 7,
      agents: {
        custom: [{ id: 'fake', name: 'Fake agent', command: process.execPath, args: [FAKE_AGENT], env: {} }],
        permissions: {},
        ...checkedAgents(['fake']),
      },
    }),
  );
}

function keyInVisiblePage(app: ElectronApplication, keyCode: string, modifiers: string[] = []): Promise<void> {
  return app.evaluate(
    ({ BrowserWindow }, input) => {
      const view = BrowserWindow.getAllWindows()
        .flatMap((win) => win.contentView.children)
        .find((child) => child.getVisible());
      const page = (view as WebContentsView | undefined)?.webContents;
      if (!page) throw new Error('No visible browser view');
      page.focus();
      page.sendInputEvent({ type: 'keyDown', keyCode: input.keyCode, modifiers: input.modifiers as ['control'] });
      page.sendInputEvent({ type: 'keyUp', keyCode: input.keyCode, modifiers: input.modifiers as ['control'] });
    },
    { keyCode, modifiers },
  );
}

function livePages(app: ElectronApplication): Promise<number> {
  return app.evaluate(
    ({ webContents }) =>
      webContents.getAllWebContents().filter((wc) => {
        const path = wc.session.storagePath ?? '';
        return (path.includes('arbora-browser-') || path.includes('arbora-web')) && !wc.getURL().startsWith('devtools:');
      }).length,
  );
}

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

  test('opens and closes a tab from the page, and the app tab stays', async () => {
    const design = await startStaticFixture(DESIGN);
    const { app, page } = await launch(tempUserData(), [DESIGN]);
    try {
      await openUrl(page, design.url);
      await expect(page.locator('[data-testid="browser-tab"][data-tab-role="app"]')).toHaveCount(1);
      await page.evaluate((url) => window.arbora.invoke('browser.tabs.open', { url }), design.url);
      await expect.poll(async () => (await tabs(page)).length).toBe(2);
      await keyInVisiblePage(app, 'W', [MOD]);
      await expect.poll(async () => (await tabs(page)).length).toBe(1);
      await keyInVisiblePage(app, 'W', [MOD]);
      expect((await tabs(page))[0]?.role).toBe('app');
      await keyInVisiblePage(app, 'T', [MOD]);
      await expect.poll(async () => (await tabs(page)).length).toBe(2);
      expect((await tabs(page)).some((tab) => tab.role === 'app')).toBe(true);
    } finally {
      await app.close();
      await design.close();
    }
  });

  test('restores three tabs and loads only the active one', async () => {
    const design = await startStaticFixture(DESIGN);
    const userData = tempUserData();
    const first = await launch(userData, [DESIGN]);
    try {
      await openUrl(first.page, design.url);
      await first.page.evaluate((url) => window.arbora.invoke('browser.tabs.open', { url }), design.url);
      await first.page.evaluate((url) => window.arbora.invoke('browser.tabs.open', { url }), `${design.url}index.html`);
      await expect.poll(async () => (await tabs(first.page)).length).toBe(3);
    } finally {
      await first.app.close();
    }
    const second = await launch(userData, [DESIGN]);
    try {
      await expect.poll(async () => (await tabs(second.page)).length).toBe(3);
      const restored = await tabs(second.page);
      expect(restored.filter((tab) => !tab.discarded)).toHaveLength(1);
      expect(restored.some((tab) => tab.role === 'app')).toBe(true);
      await expect.poll(() => livePages(second.app)).toBe(1);
    } finally {
      await second.app.close();
      await design.close();
    }
  });

  test('grants a sent tab and stops after revoke', async () => {
    const design = await startStaticFixture(DESIGN);
    const userData = tempUserData();
    fakeAgentSettings(userData);
    const { app, page } = await launch(userData, [DESIGN]);
    try {
      await openUrl(page, design.url);
      const reference = await page.evaluate((url) => window.arbora.invoke('browser.tabs.open', { url }), design.url);
      await startAgent(page, 'fake');
      const sent = await page.evaluate(
        (tabId) =>
          window.arbora.invoke('browser.tabs.send', {
            tabId,
            text: 'Implement this design',
            agentId: 'fake',
          }),
        reference.id,
      );
      await page.locator(`[data-testid="grove-row"][data-thread-id="${sent.threadId}"]`).click();
      await expect(page.getByTestId('agent-message').last()).toContainText('Grant check: allowed', { timeout: 30_000 });
      await expect(page.getByTestId('tab-grants')).toBeVisible();
      await page.getByTestId('tab-grants').locator('button').click();
      await expect(page.getByTestId('tab-grants')).toHaveCount(0);
      const input = page.getByTestId('composer-input');
      await input.fill(`tab grant ${reference.id}`);
      await input.press('Enter');
      await expect(page.getByTestId('agent-message').last()).toContainText('tab not granted', { timeout: 20_000 });
    } finally {
      await app.close();
      await design.close();
    }
  });

  test('scores a design below the threshold, then above after the scripted edit', async () => {
    test.setTimeout(120_000);
    const appFile = join(VITE_REACT, 'src/App.tsx');
    const original = readFileSync(appFile, 'utf8');
    const vite = await startViteFixture();
    const design = await startStaticFixture(DESIGN);
    const userData = tempUserData();
    fakeAgentSettings(userData);
    let app: ElectronApplication | undefined;
    try {
      const launched = await launch(userData, [VITE_REACT]);
      app = launched.app;
      const { page } = launched;
      await openUrl(page, vite.url);
      await expect.poll(async () => (await browserState(page))?.title, { timeout: 20_000 }).toBe(
        'Arbora fixture: Vite + React',
      );
      await startAgent(page, 'fake');
      const input = page.getByTestId('composer-input');
      await input.fill(`match design ${design.url}`);
      await input.press('Enter');
      const allow = page.getByTestId('permission-allow_once');
      const reported = page.getByTestId('agent-message').filter({ hasText: /Compare scores:|Compare failed:/ });
      await expect(allow.or(reported)).toBeVisible({ timeout: 40_000 });
      if (await allow.count()) await allow.click();
      await expect(reported).toBeVisible({ timeout: 40_000 });
      const text = await reported.last().innerText();
      const scores = /Compare scores: ([0-9.]+) then ([0-9.]+)/.exec(text);
      expect(scores, text).not.toBeNull();
      expect(Number(scores?.[1])).toBeLessThan(0.92);
      expect(Number(scores?.[2])).toBeGreaterThanOrEqual(0.92);
      await expect(page.getByTestId('matching-design')).toBeVisible();
    } finally {
      writeFileSync(appFile, original);
      await app?.close();
      await vite.close();
      await design.close();
    }
  });
});
