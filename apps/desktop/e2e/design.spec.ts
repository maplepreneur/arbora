import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { NavigationState } from '@arbora/shared';
import { DESKTOP_ROOT, FIXTURES, launch, switchWorkspace, tempUserData } from './app';
import { startViteFixture, type RunningServer } from './servers';

const FAKE_AGENT = resolve(DESKTOP_ROOT, '../../packages/acp-client/src/testing/fake-agent.ts');
const CARD = '[data-testid="card-counter"]';
const OVERLAY = '!!document.querySelector("[data-arbora-design]")';

function userData(): string {
  const dir = tempUserData();
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      version: 3,
      agents: {
        custom: [
          { id: 'fake', name: 'Fake agent', command: process.execPath, args: [FAKE_AGENT], env: {} },
          {
            id: 'fake-locked',
            name: 'Locked agent',
            command: process.execPath,
            args: [FAKE_AGENT],
            env: { FAKE_AGENT_AUTH: '1' },
          },
        ],
        permissions: {},
        // Checks run from Settings below; never start the built-in npx adapters in CI.
        autoVerify: false,
      },
    }),
  );
  return dir;
}

function browserState(page: Page): Promise<NavigationState | null> {
  return page.evaluate(() => window.arbora.invoke('browser.getState'));
}

function inPage<T>(app: ElectronApplication, code: string): Promise<T> {
  return app.evaluate(async ({ webContents }, source) => {
    // A parked project keeps its page, so prefer the one that loaded the fixture.
    const pages = webContents
      .getAllWebContents()
      .filter((wc) => wc.session.storagePath?.includes('arbora-browser-') && !wc.getURL().startsWith('devtools:'));
    const page = pages.find((wc) => wc.getURL().startsWith('http')) ?? pages[0];
    if (!page) throw new Error('No browser panel webContents');
    return (await page.executeJavaScript(source)) as T;
  }, code);
}

async function clickInPage(app: ElectronApplication, selector: string): Promise<void> {
  const box = await inPage<{ x: number; y: number; width: number; height: number }>(
    app,
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
  );
  await app.evaluate(
    ({ webContents }, point) => {
      const page = webContents
        .getAllWebContents()
        .find((wc) => wc.session.storagePath?.includes('arbora-browser-') && !wc.getURL().startsWith('devtools:'));
      if (!page) throw new Error('No browser panel webContents');
      page.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
      page.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      page.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    },
    { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) },
  );
}

async function openAndWait(page: Page, url: string): Promise<void> {
  await expect.poll(() => browserState(page)).not.toBeNull();
  const input = page.getByTestId('url-input');
  await input.click();
  await input.fill(url);
  await input.press('Enter');
  await expect
    .poll(
      async () => {
        const state = await browserState(page);
        return Boolean(state?.url.startsWith(url) && !state.loading && state.pageReady);
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

async function deleteThreads(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (const thread of await window.arbora.invoke('agent.listThreads')) {
      await window.arbora.invoke('agent.deleteThread', { threadId: thread.id });
    }
  });
}

function cleanArtefacts(project: string): void {
  for (const folder of ['screenshots', 'design-sessions']) {
    const dir = join(project, '.arbora', folder);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (file !== '.gitignore') rmSync(join(dir, file));
    }
  }
}

/**
 * Mod+, opens Settings over the browser pane. Checks both fake agents, makes "smart" the default
 * model, and closes it again.
 */
async function checkAgentsInSettings(page: Page): Promise<void> {
  await page.getByTestId('browser-toolbar').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('ControlOrMeta+Comma');
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await expect(page.getByTestId('browser-panel')).toHaveCount(0);
  await page.getByTestId('settings-verify-fake').click();
  await page.getByTestId('settings-verify-fake-locked').click();
  await expect(page.getByTestId('settings-agent-fake')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  await expect(page.getByTestId('settings-agent-fake-locked')).toHaveAttribute('data-status', 'auth_required', {
    timeout: 30_000,
  });
  await page.getByTestId('settings-agent-fake').getByRole('button', { name: 'Expand Fake agent' }).click();
  await expect(page.getByTestId('settings-model')).toHaveCount(2);
  await page.getByTestId('settings-model-default-smart').click();
  await expect(page.getByTestId('settings-model-default-smart')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('settings-default-fake').click();
  await expect(page.getByTestId('settings-default-fake')).toHaveAttribute('aria-pressed', 'true');
  // The summary at the top shows what new threads and design changes start with.
  await expect(page.getByTestId('settings-default-agent')).toHaveAttribute('data-value', 'fake');
  await expect(page.getByTestId('settings-default-model')).toHaveAttribute('data-value', 'smart');
  await page.keyboard.press('ControlOrMeta+Comma');
  await expect(page.getByTestId('settings-page')).toHaveCount(0);
  await expect(page.getByTestId('browser-panel')).toBeVisible();
}

test.describe('Stage 6 design mode', () => {
  const project = join(FIXTURES, 'vite-react');
  let vite: RunningServer;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    vite = await startViteFixture();
  });

  test.afterAll(async () => {
    await vite.close();
    cleanArtefacts(project);
  });

  test('edits padding and text, undoes, and saves two screenshots plus the change list', async () => {
    test.setTimeout(120_000);
    cleanArtefacts(project);
    const { app, page } = await launch(userData(), [project]);
    try {
      await openAndWait(page, vite.url);
      await checkAgentsInSettings(page);
      await page.getByTestId('browser-toolbar').click({ position: { x: 2, y: 2 } });
      await page.keyboard.press('ControlOrMeta+D');
      await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'design');
      await expect.poll(() => inPage<boolean>(app, OVERLAY)).toBe(true);

      await clickInPage(app, CARD);
      await expect(page.getByTestId('design-selection')).toBeVisible({ timeout: 20_000 });

      await page.getByTestId('design-padding-top').fill('40px');
      await page.getByTestId('design-padding-top').press('Enter');
      await expect
        .poll(() => inPage<string>(app, `document.querySelector(${JSON.stringify(CARD)}).style.paddingTop`))
        .toBe('40px');

      await page.getByTestId('design-text').fill('Total');
      await page.getByTestId('design-text').press('Tab');
      await expect
        .poll(() => inPage<string>(app, `document.querySelector(${JSON.stringify(CARD)}).textContent`))
        .toContain('Total');

      await page.getByTestId('design-undo').click();
      await expect
        .poll(() => inPage<string>(app, `document.querySelector(${JSON.stringify(CARD)}).textContent`))
        .toContain('Counter');
      await page.getByTestId('design-redo').click();
      await expect
        .poll(() => inPage<string>(app, `document.querySelector(${JSON.stringify(CARD)}).textContent`))
        .toContain('Total');

      // Preview before sending: the Changes tab lists both edits, and Compare shows the original.
      await page.getByTestId('design-tab-changes').click();
      await expect(page.getByTestId('design-change')).toHaveCount(2);
      await page.getByTestId('design-compare').click();
      await expect
        .poll(() => inPage<string>(app, `document.querySelector(${JSON.stringify(CARD)}).style.paddingTop`))
        .toBe('');
      await page.getByTestId('design-compare').click();
      await expect
        .poll(() => inPage<string>(app, `document.querySelector(${JSON.stringify(CARD)}).style.paddingTop`))
        .toBe('40px');

      // One change can be switched off and on without dropping it; switched-off changes are not sent.
      const paddingRow = page.getByTestId('design-change').first();
      await paddingRow.hover();
      await paddingRow.getByTestId('design-change-toggle').click();
      await expect(paddingRow).toHaveAttribute('data-muted', 'true');
      await expect
        .poll(() => inPage<string>(app, `document.querySelector(${JSON.stringify(CARD)}).style.paddingTop`))
        .toBe('');
      await expect(page.getByTestId('design-save')).toContainText('Send 1 change to');
      await paddingRow.getByTestId('design-change-toggle').click();
      await expect
        .poll(() => inPage<string>(app, `document.querySelector(${JSON.stringify(CARD)}).style.paddingTop`))
        .toBe('40px');

      // Clicking a change selects its element and opens its styles for editing.
      await page.getByTestId('design-tab-style').click();
      await clickInPage(app, 'h1');
      await expect(page.getByTestId('design-selection')).not.toHaveAttribute('data-selector', CARD);
      await page.getByTestId('design-tab-changes').click();
      await paddingRow.click();
      await expect(page.getByTestId('design-tab-style')).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('design-selection')).toHaveAttribute('data-selector', CARD);

      // Only the signed-in agent is offered, and its default model (set in Settings) comes first.
      await expect(page.getByTestId('design-target')).toHaveAttribute('data-value', 'new:fake');
      await page.getByTestId('design-target').click();
      const offered = await page
        .locator('[data-testid="design-target-option"]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-value')));
      // A thread the default agent started on its own may be listed too; new threads are only the signed-in agent.
      expect(offered.filter((value) => value?.startsWith('new:'))).toEqual(['new:fake']);
      await page.getByTestId('design-target').click();
      await expect(page.getByTestId('design-model')).toHaveAttribute('data-value', 'smart');
      await expect(page.getByTestId('design-save')).toContainText('Send 2 changes to Fake agent');
      await page.getByTestId('design-save').click();
      // The right panel becomes the agent's thread as soon as the prompt goes out.
      await expect(page.getByTestId('design-panel')).toHaveCount(0);
      await expect(page.getByTestId('thread-view')).toBeVisible();
      const message = page.getByTestId('user-message').first();
      await expect(message).toContainText('do not add inline styles', { timeout: 30_000 });
      await expect(message).toContainText('padding-top:');
      await expect(message).toContainText('pt-10');
      await expect(message).toContainText('40px');
      await expect(message).toContainText('Total');
      await expect(message.locator('img')).toHaveCount(2);
      // The new thread (the one in the chat) started on the model picked in the send bar.
      const designThread = await page.getByTestId('grove-pane').getAttribute('data-thread-id');
      await expect
        .poll(async () =>
          page.evaluate(async (threadId) => {
            const thread = threadId ? await window.arbora.invoke('agent.getThread', { threadId }) : null;
            const model = thread?.state.configOptions.find((o) => o.category === 'model');
            return model?.type === 'select' ? model.currentValue : null;
          }, designThread),
        )
        .toBe('smart');
      await expect.poll(() => inPage<boolean>(app, OVERLAY)).toBe(false);
      await expect
        .poll(() => inPage<string>(app, `document.querySelector(${JSON.stringify(CARD)}).style.paddingTop`))
        .toBe('');

      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', {
        timeout: 30_000,
      });
      const threadCount = async (): Promise<number> =>
        (await page.evaluate(() => window.arbora.invoke('agent.listThreads'))).length;
      const beforeResend = await threadCount();
      await page.keyboard.press('ControlOrMeta+D');
      await page.getByTestId('design-tab-changes').click();
      await expect(page.getByTestId('design-sessions')).toBeVisible();
      await page.getByTestId('design-compare-session').click();
      await expect(page.getByTestId('design-history')).toBeVisible();
      await expect(page.getByTestId('design-history-before').locator('img')).toBeVisible();
      await expect(page.getByTestId('design-history-after').locator('img')).toBeVisible();
      await expect(page.getByTestId('design-history-changes')).toContainText('padding-top');
      const sessionId = await page.getByTestId('design-compare-session').getAttribute('data-session-id');
      const markdown = await page.evaluate(async (id) => {
        if (!id) return '';
        return (await window.arbora.invoke('design.readSession', { id })).markdown;
      }, sessionId);
      expect(markdown).toContain('# Design session');
      expect(markdown).toContain('pt-10');
      expect(markdown).toContain('## Screenshots');
      await page.getByTestId('design-resend').click();
      // The agent picked earlier is remembered, so the resend starts another Fake agent thread.
      await expect.poll(threadCount, { timeout: 30_000 }).toBe(beforeResend + 1);
      await expect(page.getByTestId('user-message').first()).toContainText('do not add inline styles', {
        timeout: 30_000,
      });
    } finally {
      await deleteThreads(page).catch(() => undefined);
      await app.close();
      cleanArtefacts(project);
    }
  });

  test('discard restores the page without a reload', async () => {
    test.setTimeout(120_000);
    const { app, page } = await launch(userData(), [project]);
    try {
      await openAndWait(page, vite.url);
      await page.getByTestId('browser-toolbar').click({ position: { x: 2, y: 2 } });
      await page.keyboard.press('ControlOrMeta+D');
      await expect.poll(() => inPage<boolean>(app, OVERLAY)).toBe(true);
      await clickInPage(app, CARD);
      await expect(page.getByTestId('design-selection')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('design-background').fill('rgb(239, 68, 68)');
      await page.getByTestId('design-background').press('Enter');
      await expect
        .poll(() => inPage<string>(app, `document.querySelector(${JSON.stringify(CARD)}).style.backgroundColor`))
        .not.toBe('');

      // The trash button drops one proposed change and puts the page back.
      await page.getByTestId('design-padding-top').fill('40');
      await page.getByTestId('design-padding-top').press('Enter');
      await page.getByTestId('design-tab-changes').click();
      await expect(page.getByTestId('design-change')).toHaveCount(2);
      const background = page.getByTestId('design-change').first();
      await background.hover();
      await background.getByTestId('design-change-delete').click();
      await expect(page.getByTestId('design-change')).toHaveCount(1);
      await expect
        .poll(() => inPage<string>(app, `document.querySelector(${JSON.stringify(CARD)}).style.backgroundColor`))
        .toBe('');
      await expect
        .poll(() => inPage<string>(app, `document.querySelector(${JSON.stringify(CARD)}).style.paddingTop`))
        .toBe('40px');

      // Switching project would leave the edit behind on a parked page, so it asks first; Keep editing stays.
      const other = join(FIXTURES, 'plain-html');
      await page.evaluate((path) => window.arbora.invoke('grove.addProject', { path }), other);
      const otherRow = page.locator(`[data-testid="grove-project"][data-path="${other}"]`);
      await otherRow.click();
      const confirm = page.getByTestId('design-confirm');
      await expect(confirm).toContainText('before switching project');
      await expect(page.getByTestId('title-project-name')).not.toHaveText('plain-html');
      await page.getByTestId('design-stay').click();
      await expect(confirm).toHaveCount(0);
      await expect(page.getByTestId('design-panel')).toBeVisible();
      await otherRow.click();
      await expect(confirm).toBeVisible();

      // Discard reverts the page, then the switch goes ahead.
      await page.getByTestId('design-discard').click();
      await expect(page.getByTestId('title-project-name')).toHaveText('plain-html');
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      await expect(page.getByTestId('mode-banner')).toHaveCount(0);
      await page.locator(`[data-testid="grove-project"][data-path="${project}"]`).click();
      await expect(page.getByTestId('title-project-name')).not.toHaveText('plain-html');
      await switchWorkspace(page, 'browser');
      await expect
        .poll(() => inPage<string>(app, `document.querySelector(${JSON.stringify(CARD)}).style.backgroundColor`))
        .toBe('');
      await expect
        .poll(() => inPage<string>(app, `document.querySelector(${JSON.stringify(CARD)}).style.paddingTop`))
        .toBe('');
      await expect.poll(() => inPage<boolean>(app, OVERLAY)).toBe(false);
      await expect(page.getByTestId('mode-banner')).toHaveCount(0);
    } finally {
      await deleteThreads(page).catch(() => undefined);
      await app.close();
    }
  });
});
