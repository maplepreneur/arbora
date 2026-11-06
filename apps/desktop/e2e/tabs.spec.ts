import { chmodSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { WebContentsView } from 'electron';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { BrowserTabSnapshot, NavigationState } from '@arbora/shared';
import { checkedAgents, DESKTOP_ROOT, FIXTURES, focusChrome, launch, showRight, startAgent, tempUserData } from './app';
import { startStaticFixture, startViteFixture } from './servers';

const FAKE_AGENT = join(DESKTOP_ROOT, '../../packages/acp-client/src/testing/fake-agent.ts');
const LOGIN = join(FIXTURES, 'login');
const DESIGN = join(FIXTURES, 'design-reference');
const VITE_REACT = join(FIXTURES, 'vite-react');
const PASSWORD = 's3cret-fixture-value';
const OTP = '918273';
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
        return (
          (path.includes('arbora-browser-') || path.includes('arbora-web')) && !wc.getURL().startsWith('devtools:')
        );
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
  test('sends the tab that was right-clicked, not the active one', async () => {
    const { app, page } = await launch(tempUserData(), [DESIGN]);
    try {
      await page.getByTestId('browser-tab-new').click();
      const open = await tabs(page);
      const reference = open.find((tab) => tab.role === 'reference');
      const appTab = open.find((tab) => tab.role === 'app');
      if (!reference || !appTab) throw new Error('Need an app tab and a reference tab');
      await page.evaluate((id) => window.arbora.invoke('browser.tabs.activate', { id }), appTab.id);
      const referenceTab = page.locator(`[data-testid="browser-tab"][data-tab-id="${reference.id}"]`);
      await expect(referenceTab).toHaveAttribute('data-active', 'false');
      await referenceTab.click({ button: 'right' });
      await expect
        .poll(() => app.evaluate(() => Boolean((global as { arboraContextMenu?: unknown }).arboraContextMenu)))
        .toBe(true);
      await app.evaluate(() => {
        const menu = (
          global as {
            arboraContextMenu?: { items: { label: string; click: () => void }[]; closePopup: () => void };
          }
        ).arboraContextMenu;
        const item = menu?.items.find((entry) => entry.label === 'Send tab to agent');
        if (!menu || !item) throw new Error('Send tab to agent is not in the tab menu');
        item.click();
        menu.closePopup();
      });
      const popover = page.getByTestId('browser-send-tab');
      await expect(popover).toBeVisible({ timeout: 5_000 });
      await expect(popover).toHaveAttribute('data-tab-id', reference.id);
    } finally {
      await app.close();
    }
  });

  test('shows memory and CPU on a tab hover', async () => {
    const design = await startStaticFixture(DESIGN);
    const { app, page } = await launch(tempUserData(), [DESIGN]);
    try {
      await openUrl(page, design.url);
      await page.locator('[data-testid="browser-tab"][data-tab-role="app"]').hover();
      const card = page.getByTestId('browser-tab-stats');
      await expect(card).toBeVisible();
      await expect(card).toContainText('MB');
      await expect(card).toContainText('CPU');
      await expect(card).not.toContainText('Not loaded');
      const appTab = page.locator('[data-testid="browser-tab"][data-tab-role="app"]');
      await expect(appTab.getByTestId('browser-tab-role')).toHaveAttribute('data-role', 'app');
      await expect(appTab.getByTestId('browser-tab-title')).toContainText('design reference');
    } finally {
      await app.close();
      await design.close();
    }
  });

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
      const reference = page.locator('[data-testid="browser-tab"][data-tab-role="reference"]');
      await expect(reference.getByTestId('browser-tab-role')).toHaveAttribute('data-role', 'reference');
      await expect(reference.getByTestId('browser-tab-title')).toHaveText('New tab');
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
if (args.join(' ').includes(${JSON.stringify(PASSWORD)}) || args.join(' ').includes(${JSON.stringify(OTP)})) {
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
if (args[1] === 'get' && args.includes('--otp')) {
  process.stdout.write(${JSON.stringify(OTP)} + String.fromCharCode(10));
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
      await page.getByTestId('permission-allow_always').click({ timeout: 20_000 });
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
      const appTab = (await tabs(page)).find((tab) => tab.role === 'app');
      if (!appTab) throw new Error('No app tab');
      await page.evaluate((id) => window.arbora.invoke('browser.tabs.activate', { id }), appTab.id);
      const shot = await page.evaluate(() =>
        window.arbora.invoke('browser.screenshot', { mode: 'viewport', save: false }),
      );
      const centers = await launched.app.evaluate(async ({ webContents }, pageUrl) => {
        const view = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith(pageUrl));
        if (!view) return [];
        return (await view.executeJavaScript(`(() => {
          const nodes = document.querySelectorAll('input[type="password"], input[autocomplete="one-time-code"]');
          return [...nodes].filter((el) => el.value).map((el) => {
            const box = el.getBoundingClientRect();
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          });
        })()`)) as { x: number; y: number }[];
      }, login.url);
      expect(centers.length).toBeGreaterThanOrEqual(2);
      const samples = await launched.app.evaluate(
        ({ nativeImage }, input) => {
          const image = nativeImage.createFromBuffer(Buffer.from(input.pngBase64, 'base64'));
          const size = image.getSize();
          const bitmap = image.toBitmap();
          return input.centers.map((center) => {
            const x = Math.min(size.width - 1, Math.max(0, Math.round(center.x * input.dpr)));
            const y = Math.min(size.height - 1, Math.max(0, Math.round(center.y * input.dpr)));
            const index = (y * size.width + x) * 4;
            return [bitmap[index + 2], bitmap[index + 1], bitmap[index]];
          });
        },
        { pngBase64: shot.pngBase64, dpr: shot.dpr, centers },
      );
      for (const [red, green, blue] of samples) expect([red, green, blue]).toEqual([0x3a, 0x3a, 0x3a]);
      const transcript = await page.getByTestId('transcript').innerText();
      expect(transcript).not.toContain(PASSWORD);
      expect(transcript).not.toContain(OTP);
      const log = await page.evaluate(async () => {
        const threads = await window.arbora.invoke('agent.listThreads');
        const thread = threads[0];
        if (!thread) return '';
        const entries = await window.arbora.invoke('agent.getLog', { threadId: thread.id });
        return JSON.stringify(entries);
      });
      expect(log).not.toContain(PASSWORD);
      expect(log).not.toContain(OTP);
      const origin = new URL(login.url).origin;
      await page.keyboard.press('ControlOrMeta+Comma');
      await page.getByTestId('settings-nav-passwords').click();
      await expect(page.getByTestId('passwords-allow-origin')).toContainText(origin);
      await page.getByTestId('passwords-allow-remove').click();
      await expect
        .poll(() => {
          const saved = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as {
            passwords: { alwaysAllow: string[] };
          };
          return saved.passwords.alwaysAllow;
        })
        .toEqual([]);
    } finally {
      await app?.close();
      await login.close();
      await design.close();
    }
  });

  test('saves a submitted login through op and keeps the password out of the window', async () => {
    const login = await startStaticFixture(LOGIN);
    const userData = tempUserData();
    const opDir = mkdtempSync(join(tmpdir(), 'arbora-op-save-'));
    const saveFile = join(opDir, 'saved.json');
    const savedPassword = 'saved-fixture-secret';
    const op = join(opDir, 'op');
    writeFileSync(
      op,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.join(' ').includes(${JSON.stringify(savedPassword)})) {
  process.stderr.write('secret leaked to argv\\n');
  process.exit(3);
}
if (args[1] === 'create') {
  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => {
    require('fs').writeFileSync(${JSON.stringify(saveFile)}, Buffer.concat(chunks));
    process.stdout.write('{"id":"saved"}\\n');
    process.exit(0);
  });
} else {
  process.stderr.write('unexpected op\\n');
  process.exit(2);
}
`,
    );
    chmodSync(op, 0o755);
    writeFileSync(
      join(userData, 'settings.json'),
      JSON.stringify({
        version: 7,
        passwords: { provider: '1password', mode: 'cli', agentLogins: 'ask', alwaysAllow: [] },
      }),
    );
    const { app, page } = await launch(userData, [LOGIN], { ARBORA_OP: op });
    try {
      await openUrl(page, login.url);
      await expect(page.getByTestId('browser-fill-password')).toBeVisible();
      await app.evaluate(
        ({ webContents }, input) => {
          const view = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith(input.url));
          if (!view) throw new Error('Login page is not open');
          return view.executeJavaScript(`(() => {
          const set = (el, value) => {
            const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
            if (setter) setter.call(el, value);
            else el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          };
          set(document.querySelector('input[name="user"]'), ${JSON.stringify(input.user)});
          set(document.querySelector('input[type="password"]'), ${JSON.stringify(input.password)});
          document.getElementById('login').requestSubmit();
        })()`);
        },
        { url: login.url, user: 'ada@example.com', password: savedPassword },
      );
      await expect(page.getByTestId('toast')).toContainText('Save the login', { timeout: 15_000 });
      expect(await page.locator('body').innerText()).not.toContain(savedPassword);
      await page.getByTestId('toast-action').click();
      await expect(page.getByTestId('toast')).toContainText('Saved to 1Password', { timeout: 15_000 });
      const saved = JSON.parse(readFileSync(saveFile, 'utf8')) as {
        fields: { purpose: string; value: string }[];
      };
      expect(saved.fields.find((field) => field.purpose === 'PASSWORD')?.value).toBe(savedPassword);
      expect(await page.locator('body').innerText()).not.toContain(savedPassword);
    } finally {
      await app.close();
      await login.close();
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

  test('closes an agent tab when the session ends and keeps a pinned one', async () => {
    const design = await startStaticFixture(DESIGN);
    const userData = tempUserData();
    fakeAgentSettings(userData);
    const { app, page } = await launch(userData, [DESIGN]);
    try {
      await openUrl(page, design.url);
      await startAgent(page, 'fake');
      const threads = await page.evaluate(() => window.arbora.invoke('agent.listThreads'));
      const threadId = threads[0]?.id;
      if (!threadId) throw new Error('No thread');
      const input = page.getByTestId('composer-input');
      await input.fill(`hold tab ${design.url}`);
      await input.press('Enter');
      await expect(page.getByTestId('agent-message').last()).toContainText('Holding tab', { timeout: 20_000 });
      const opened = (await tabs(page)).find((tab) => tab.openedByAgent);
      if (!opened) throw new Error('No agent tab');
      await page.evaluate((id) => window.arbora.invoke('agent.stopProcess', { threadId: id }), threadId);
      await expect.poll(async () => (await tabs(page)).some((tab) => tab.id === opened.id)).toBe(false);

      const before = await page.getByTestId('agent-message').count();
      await input.click();
      await input.fill(`hold tab ${design.url}#kept`);
      await input.press('Enter');
      await expect
        .poll(async () => page.getByTestId('agent-message').count(), { timeout: 20_000 })
        .toBeGreaterThan(before);
      await expect(page.getByTestId('agent-message').last()).toContainText('Holding tab');
      const kept = (await tabs(page)).find((tab) => tab.openedByAgent);
      if (!kept) throw new Error('No agent tab to pin');
      await page.evaluate((id) => window.arbora.invoke('browser.tabs.pin', { id, pinned: true }), kept.id);
      await page.evaluate((id) => window.arbora.invoke('agent.stopProcess', { threadId: id }), threadId);
      await expect.poll(async () => (await tabs(page)).find((tab) => tab.id === kept.id)?.pinned).toBe(true);
    } finally {
      await app.close();
      await design.close();
    }
  });

  test('sends a mailto link to the operating system instead of opening a tab', async () => {
    const design = await startStaticFixture(DESIGN);
    const { app, page } = await launch(tempUserData(), [DESIGN]);
    const windowCount = (): Promise<number> =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    try {
      await openUrl(page, design.url);
      const before = (await tabs(page)).length;
      await app.evaluate(({ webContents }, url) => {
        const view = webContents
          .getAllWebContents()
          .find((wc) => (wc.session.storagePath ?? '').includes('arbora-browser-') && wc.getURL().startsWith(url));
        if (!view) throw new Error('No app page');
        setTimeout(() => {
          void view.executeJavaScript(`location.href = 'mailto:person@example.com'`);
        }, 0);
      }, design.url);
      await expect
        .poll(() => app.evaluate(() => (global as { arboraExternalOpen?: string }).arboraExternalOpen ?? ''))
        .toBe('mailto:person@example.com');
      await app.evaluate(({ webContents }, url) => {
        const view = webContents
          .getAllWebContents()
          .find((wc) => (wc.session.storagePath ?? '').includes('arbora-browser-') && wc.getURL().startsWith(url));
        if (!view) throw new Error('No app page');
        setTimeout(() => {
          void view.executeJavaScript(`window.open('mailto:other@example.com')`);
        }, 0);
      }, design.url);
      await expect
        .poll(() => app.evaluate(() => (global as { arboraExternalOpen?: string }).arboraExternalOpen ?? ''))
        .toBe('mailto:other@example.com');
      expect((await tabs(page)).length).toBe(before);
      expect(await windowCount()).toBe(1);
      expect((await tabs(page)).some((tab) => tab.url.startsWith('mailto:'))).toBe(false);
    } finally {
      await app.close();
      await design.close();
    }
  });

  test('opens a plain link as a shared-partition tab and an OAuth popup as a child window', async () => {
    test.setTimeout(60_000);
    const design = await startStaticFixture(DESIGN);
    const { app, page } = await launch(tempUserData(), [DESIGN]);
    const windowCount = (): Promise<number> =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    try {
      await openUrl(page, design.url);
      const reference = await page.evaluate((url) => window.arbora.invoke('browser.tabs.open', { url }), design.url);
      await page.evaluate((id) => window.arbora.invoke('browser.tabs.activate', { id }), reference.id);
      await expect
        .poll(async () => (await tabs(page)).find((tab) => tab.id === reference.id)?.url)
        .toContain(design.url);

      // Opening the window inside the evaluate deadlocks Playwright's Electron driver.
      await app.evaluate(({ webContents }, url) => {
        const view = webContents
          .getAllWebContents()
          .find((wc) => (wc.session.storagePath ?? '').includes('arbora-web') && wc.getURL().startsWith(url));
        if (!view) throw new Error('No reference tab on the shared partition');
        setTimeout(() => {
          void view.executeJavaScript(`window.open(${JSON.stringify(`${url}#linked`)})`);
        }, 0);
      }, design.url);
      await expect
        .poll(async () => (await tabs(page)).find((tab) => tab.url.includes('#linked'))?.role ?? '', {
          timeout: 15_000,
        })
        .toBe('reference');
      expect(await windowCount()).toBe(1);
      const linkedPartition = await app.evaluate(({ webContents }, fragment) => {
        const view = webContents.getAllWebContents().find((wc) => wc.getURL().includes(fragment));
        return view?.session.storagePath ?? '';
      }, '#linked');
      expect(linkedPartition).toContain('arbora-web');

      await app.evaluate(({ webContents }, url) => {
        const view = webContents
          .getAllWebContents()
          .find(
            (wc) =>
              (wc.session.storagePath ?? '').includes('arbora-web') &&
              wc.getURL().startsWith(url) &&
              !wc.getURL().includes('#'),
          );
        if (!view) throw new Error('The opener tab is gone');
        setTimeout(() => {
          void view.executeJavaScript(
            `window.open(${JSON.stringify(`${url}#oauth`)}, 'oauth', 'popup=yes,width=480,height=640')`,
          );
        }, 0);
      }, design.url);
      await expect.poll(windowCount, { timeout: 15_000 }).toBe(2);
      expect((await tabs(page)).some((tab) => tab.url.includes('#oauth'))).toBe(false);
      const popup = await app.evaluate(({ BrowserWindow }) => {
        const child = BrowserWindow.getAllWindows().find((win) => win.getParentWindow() !== null);
        if (!child) return null;
        return {
          partition: child.webContents.session.storagePath ?? '',
          url: child.webContents.getURL(),
        };
      });
      expect(popup?.partition).toContain('arbora-web');

      await page.evaluate((id) => window.arbora.invoke('browser.tabs.close', { id }), reference.id);
      await expect.poll(windowCount, { timeout: 10_000 }).toBe(1);
    } finally {
      await app
        .evaluate(({ BrowserWindow }) => {
          for (const win of BrowserWindow.getAllWindows().slice(1)) win.destroy();
        })
        .catch(() => undefined);
      await app.close();
      await design.close();
    }
  });

  test('use project session shares the app tab cookies with that reference tab', async () => {
    const design = await startStaticFixture(DESIGN);
    const userData = tempUserData();
    const { app, page } = await launch(userData, [DESIGN]);
    const cookiesOn = (partition: string): Promise<string[]> =>
      app.evaluate(
        async ({ webContents }, input) => {
          const pages = webContents.getAllWebContents().filter((wc) => {
            const path = wc.session.storagePath ?? '';
            return path.includes(input.partition) && wc.getURL().startsWith(input.url);
          });
          const values: string[] = [];
          for (const wc of pages) values.push(String(await wc.executeJavaScript('document.cookie')));
          return values;
        },
        { partition, url: design.url },
      );
    try {
      await openUrl(page, design.url);
      await app.evaluate(({ webContents }, url) => {
        const view = webContents
          .getAllWebContents()
          .find((wc) => (wc.session.storagePath ?? '').includes('arbora-browser-') && wc.getURL().startsWith(url));
        if (!view) throw new Error('No app tab');
        return view.executeJavaScript('document.cookie = "arbora_project=yes; path=/"; document.cookie');
      }, design.url);
      await expect
        .poll(async () => {
          const values = await cookiesOn('arbora-browser-');
          return values.length === 1 && values[0]?.includes('arbora_project=yes');
        })
        .toBe(true);

      const reference = await page.evaluate((url) => window.arbora.invoke('browser.tabs.open', { url }), design.url);
      await expect
        .poll(async () => {
          const values = await cookiesOn('arbora-web');
          return values.length === 1 && values[0] === '';
        })
        .toBe(true);

      await page.evaluate((id) => window.arbora.invoke('browser.tabs.setSession', { id, project: true }), reference.id);
      await expect
        .poll(async () => {
          const values = await cookiesOn('arbora-browser-');
          return values.length === 2 && values.every((value) => value.includes('arbora_project=yes'));
        })
        .toBe(true);
      expect(await cookiesOn('arbora-web')).toEqual([]);
      expect((await tabs(page)).find((tab) => tab.id === reference.id)?.useProjectSession).toBe(true);

      await page.evaluate(
        (id) => window.arbora.invoke('browser.tabs.setSession', { id, project: false }),
        reference.id,
      );
      await expect
        .poll(async () => {
          const values = await cookiesOn('arbora-web');
          return values.length === 1 && values[0] === '';
        })
        .toBe(true);
      expect((await tabs(page)).find((tab) => tab.id === reference.id)?.useProjectSession).toBe(false);
    } finally {
      await app.close();
      await design.close();
    }
  });

  test('making a tab the app tab swaps the project and shared sessions', async () => {
    const design = await startStaticFixture(DESIGN);
    const userData = tempUserData();
    const { app, page } = await launch(userData, [DESIGN]);
    const cookiesOn = (partition: string): Promise<string[]> =>
      app.evaluate(
        async ({ webContents }, input) => {
          const pages = webContents.getAllWebContents().filter((wc) => {
            const path = wc.session.storagePath ?? '';
            return path.includes(input.partition) && wc.getURL().startsWith(input.url);
          });
          const values: string[] = [];
          for (const wc of pages) values.push(String(await wc.executeJavaScript('document.cookie')));
          return values;
        },
        { partition, url: design.url },
      );
    try {
      await openUrl(page, design.url);
      await app.evaluate(({ webContents }, url) => {
        const view = webContents
          .getAllWebContents()
          .find((wc) => (wc.session.storagePath ?? '').includes('arbora-browser-') && wc.getURL().startsWith(url));
        if (!view) throw new Error('No app tab');
        return view.executeJavaScript('document.cookie = "arbora_project=yes; path=/"; document.cookie');
      }, design.url);
      const reference = await page.evaluate((url) => window.arbora.invoke('browser.tabs.open', { url }), design.url);
      const appId = (await tabs(page)).find((tab) => tab.role === 'app')?.id;
      if (!appId) throw new Error('No app tab');
      await expect
        .poll(async () => {
          const project = await cookiesOn('arbora-browser-');
          const shared = await cookiesOn('arbora-web');
          return project.length === 1 && project[0]?.includes('arbora_project=yes') && shared.length === 1;
        })
        .toBe(true);

      await page.evaluate((id) => window.arbora.invoke('browser.tabs.setRole', { id, role: 'app' }), reference.id);
      await expect
        .poll(async () => {
          const project = await cookiesOn('arbora-browser-');
          const shared = await cookiesOn('arbora-web');
          return (
            project.length === 1 &&
            project[0]?.includes('arbora_project=yes') &&
            shared.length === 1 &&
            shared[0] === ''
          );
        })
        .toBe(true);
      const after = await tabs(page);
      expect(after.find((tab) => tab.id === reference.id)).toMatchObject({ role: 'app', useProjectSession: true });
      expect(after.find((tab) => tab.id === appId)).toMatchObject({ role: 'reference', useProjectSession: false });
    } finally {
      await app.close();
      await design.close();
    }
  });

  test('a reference-tab login is shared with another project', async () => {
    const design = await startStaticFixture(DESIGN);
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'arbora-other-web-')));
    const userData = tempUserData();
    const { app, page } = await launch(userData, [DESIGN]);
    const cookiesOn = (): Promise<string[]> =>
      app.evaluate(async ({ webContents }, url) => {
        const pages = webContents.getAllWebContents().filter((wc) => {
          const path = wc.session.storagePath ?? '';
          return path.includes('arbora-web') && wc.getURL().startsWith(url);
        });
        const values: string[] = [];
        for (const wc of pages) values.push(String(await wc.executeJavaScript('document.cookie')));
        return values;
      }, design.url);
    try {
      await openUrl(page, design.url);
      await page.evaluate((url) => window.arbora.invoke('browser.tabs.open', { url }), design.url);
      await expect.poll(async () => (await cookiesOn()).length).toBe(1);
      await app.evaluate(({ webContents }, url) => {
        const view = webContents
          .getAllWebContents()
          .find((wc) => (wc.session.storagePath ?? '').includes('arbora-web') && wc.getURL().startsWith(url));
        if (!view) throw new Error('No reference tab');
        return view.executeJavaScript('document.cookie = "arbora_shared=yes; path=/"; document.cookie');
      }, design.url);
      await expect.poll(async () => (await cookiesOn())[0] ?? '').toContain('arbora_shared=yes');

      const name = basename(other);
      await page.evaluate((path) => {
        setTimeout(() => {
          void window.arbora.invoke('project.openInWindow', { path });
        }, 0);
      }, other);
      await expect
        .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), { timeout: 15_000 })
        .toBeGreaterThan(1);
      await app.evaluate(
        async ({ BrowserWindow }, input) => {
          const win = BrowserWindow.getAllWindows().find((item) => item.getTitle().startsWith(input.name));
          if (!win) throw new Error('The other project window is not open');
          await win.webContents.executeJavaScript(
            `window.arbora.invoke('browser.tabs.open', { url: ${JSON.stringify(input.url)} })`,
          );
        },
        { name, url: design.url },
      );
      await expect
        .poll(async () => {
          const values = await cookiesOn();
          return values.length === 2 && values.every((value) => value.includes('arbora_shared=yes'));
        })
        .toBe(true);
    } finally {
      await app
        .evaluate(({ BrowserWindow }) => {
          for (const win of BrowserWindow.getAllWindows().slice(1)) win.destroy();
        })
        .catch(() => undefined);
      await app.close();
      await design.close();
      rmSync(other, { recursive: true, force: true });
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

  test('drops the grant chip when that tab closes', async () => {
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
            target: { type: 'new', agentId: 'fake' },
          }),
        reference.id,
      );
      await page.locator(`[data-testid="grove-row"][data-thread-id="${sent.threadId}"]`).click();
      await expect(page.getByTestId('tab-grants')).toBeVisible({ timeout: 20_000 });
      await page.evaluate((id) => window.arbora.invoke('browser.tabs.close', { id }), reference.id);
      await expect(page.getByTestId('tab-grants')).toHaveCount(0);
      expect(
        await page.evaluate((threadId) => window.arbora.invoke('agent.listGrants', { threadId }), sent.threadId),
      ).toEqual([]);
    } finally {
      await app.close();
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
            target: { type: 'new', agentId: 'fake' },
          }),
        reference.id,
      );
      await page.locator(`[data-testid="grove-row"][data-thread-id="${sent.threadId}"]`).click();
      await expect(page.getByTestId('user-message').last()).toContainText('App tab');
      await expect(page.getByTestId('user-message').last()).toContainText('Stop at 0.92');
      await expect(page.getByTestId('agent-message').last()).toContainText('Grant check: allowed', { timeout: 30_000 });
      await expect(page.getByTestId('tab-grants')).toBeVisible();
      await expect(page.getByTestId('grant-chip-favicon')).toHaveAttribute('src', /^data:image\/png/);
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

  test('send tab can include a full-page screenshot and names the app tab', async () => {
    const design = await startStaticFixture(DESIGN);
    const userData = tempUserData();
    fakeAgentSettings(userData);
    const settingsPath = join(userData, 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { agents: { defaultAgent?: string } };
    settings.agents.defaultAgent = 'fake';
    writeFileSync(settingsPath, JSON.stringify(settings));
    const { app, page } = await launch(userData, [DESIGN]);
    try {
      await openUrl(page, design.url);
      const existing = new Set(
        await page
          .locator('[data-testid="grove-row"]')
          .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-thread-id'))),
      );
      await page.getByTestId('browser-tab-send').click();
      await page.getByTestId('browser-send-text').fill('Match this frame');
      await page.getByTestId('browser-send-target').selectOption('new:fake');
      await page.getByTestId('browser-send-full-page').check();
      await page.getByTestId('browser-send-confirm').click();
      const row = page.locator('[data-testid="grove-row"]').filter({ hasText: 'Match this frame' });
      await expect
        .poll(
          async () =>
            (await row.evaluateAll((rows) => rows.map((item) => item.getAttribute('data-thread-id')))).find(
              (id) => id && !existing.has(id),
            ) ?? '',
          { timeout: 20_000 },
        )
        .not.toBe('');
      const created = (await row.evaluateAll((rows) => rows.map((item) => item.getAttribute('data-thread-id')))).find(
        (id) => id && !existing.has(id),
      );
      await page.locator(`[data-testid="grove-row"][data-thread-id="${created}"]`).click();
      const message = page.getByTestId('user-message').last();
      await expect(message).toContainText('Match this frame', { timeout: 20_000 });
      await expect(message).toContainText('App tab');
      await expect(message).toContainText('full-page screenshot');
      await expect(message).toContainText('Stop at 0.92');
    } finally {
      await app.close();
      await design.close();
    }
  });

  test('sends a tab into a thread that is already open', async () => {
    const design = await startStaticFixture(DESIGN);
    const userData = tempUserData();
    fakeAgentSettings(userData);
    const { app, page } = await launch(userData, [DESIGN]);
    try {
      await openUrl(page, design.url);
      await startAgent(page, 'fake');
      const threadId = await page
        .locator('[data-testid="grove-row"][aria-current="true"]')
        .getAttribute('data-thread-id');
      if (!threadId) throw new Error('No open thread');
      const before = await page.locator('[data-testid="grove-row"]').count();
      await page.getByTestId('browser-tab-send').click();
      await page.getByTestId('browser-send-text').fill('Look at this tab');
      await page.getByTestId('browser-send-target').selectOption(`thread:${threadId}`);
      await page.getByTestId('browser-send-confirm').click();
      await page.locator(`[data-testid="grove-row"][data-thread-id="${threadId}"]`).click();
      await expect(page.getByTestId('user-message').last()).toContainText('Look at this tab', { timeout: 20_000 });
      await expect(page.getByTestId('user-message').last()).toContainText('is granted to this thread');
      await expect(page.locator('[data-testid="grove-row"]')).toHaveCount(before);
    } finally {
      await app.close();
      await design.close();
    }
  });

  test('reads a canvas frame, ignores its chrome, and matches the card', async () => {
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
      await expect
        .poll(async () => (await browserState(page))?.title, { timeout: 20_000 })
        .toBe('Arbora fixture: Vite + React');
      await startAgent(page, 'fake');
      const input = page.getByTestId('composer-input');
      await input.fill(`match figma ${new URL('figma.html', design.url).href}`);
      await input.press('Enter');
      const allow = page.getByTestId('permission-allow_once');
      const reported = page.getByTestId('agent-message').filter({ hasText: /Frame scores:|Compare failed:/ });
      await expect
        .poll(
          async () => {
            if ((await reported.count()) > 0) return 'done';
            if ((await allow.count()) > 0) await allow.first().click();
            return 'wait';
          },
          { timeout: 90_000 },
        )
        .toBe('done');
      const text = await reported.last().innerText();
      expect(text, text).toContain('Inspect: fill #1f6b4a, padding 24px');
      expect(text, text).toContain('Full page ok');
      const scores = /Frame scores: ([0-9.]+) chrome ([0-9.]+) frame ([0-9.]+) overlay ([0-9.]+) diff ([0-9.]+)/.exec(
        text,
      );
      expect(scores, text).not.toBeNull();
      expect(Number(scores?.[1])).toBeLessThan(0.92);
      expect(Number(scores?.[2])).toBeLessThan(0.92);
      expect(Number(scores?.[3])).toBeGreaterThanOrEqual(0.92);
      expect(Number(scores?.[4])).toBeGreaterThanOrEqual(0.92);
      expect(Number(scores?.[5])).toBeGreaterThanOrEqual(0.92);
      await expect(page.getByTestId('matching-design')).toBeVisible();
    } finally {
      writeFileSync(appFile, original);
      await app?.close();
      await vite.close();
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
      await expect
        .poll(async () => (await browserState(page))?.title, { timeout: 20_000 })
        .toBe('Arbora fixture: Vite + React');
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
      const history = await page.getByTestId('matching-design-scores').innerText();
      expect(history.split('Matching design').length - 1).toBeGreaterThanOrEqual(2);
      await expect(page.getByTestId('matching-design-file')).toContainText('.arbora/screenshots/');
      await expect(page.getByTestId('matching-design-round')).toHaveText('Round 2');
      await expect(page.getByTestId('matching-design-shot')).toBeVisible();
      const saved = readdirSync(join(VITE_REACT, '.arbora', 'screenshots'), { recursive: true }).map(String);
      expect(saved.some((name) => name.endsWith('round-1.png'))).toBe(true);
      expect(saved.some((name) => name.endsWith('round-2.png'))).toBe(true);
    } finally {
      writeFileSync(appFile, original);
      await app?.close();
      await vite.close();
      await design.close();
    }
  });

  test('shows the app tab in Problems while a reference tab has its own errors', async () => {
    const design = await startStaticFixture(DESIGN);
    const { app, page } = await launch(tempUserData(), [DESIGN]);
    const logOn = (partition: 'arbora-browser-' | 'arbora-web', message: string): Promise<void> =>
      app.evaluate(
        ({ webContents }, input) => {
          const target = webContents.getAllWebContents().find((wc) => {
            const path = wc.session.storagePath ?? '';
            return path.includes(input.partition) && !wc.getURL().startsWith('devtools:');
          });
          if (!target) throw new Error(`No page for ${input.partition}`);
          return target.executeJavaScript(`console.error(${JSON.stringify(input.message)})`);
        },
        { partition, message },
      );
    try {
      await openUrl(page, design.url);
      await logOn('arbora-browser-', 'app-tab-problem');
      await page.evaluate((url) => window.arbora.invoke('browser.tabs.open', { url }), design.url);
      await expect
        .poll(async () =>
          (await tabs(page)).some((tab) => tab.role === 'reference' && tab.url.startsWith(design.url) && !tab.loading),
        )
        .toBe(true);
      await logOn('arbora-web', 'reference-tab-problem');
      await showRight(page, 'problems');
      const rows = page.getByTestId('problem-row');
      await expect(rows.filter({ hasText: 'app-tab-problem' })).toBeVisible();
      await expect(rows.filter({ hasText: 'reference-tab-problem' })).toHaveCount(0);
      const reference = (await tabs(page)).find((tab) => tab.role === 'reference');
      if (!reference) throw new Error('No reference tab');
      await page.getByTestId('problems-tab').selectOption(reference.id);
      await expect(rows.filter({ hasText: 'reference-tab-problem' })).toBeVisible();
      await expect(rows.filter({ hasText: 'app-tab-problem' })).toHaveCount(0);
      const appTab = (await tabs(page)).find((tab) => tab.role === 'app');
      if (!appTab) throw new Error('No app tab');
      await page.getByTestId('problems-tab').selectOption(appTab.id);
      await expect(rows.filter({ hasText: 'app-tab-problem' })).toBeVisible();
    } finally {
      await app.close();
      await design.close();
    }
  });

  test('shows a 1Password key on a focused login field and hides it again', async () => {
    const login = await startStaticFixture(LOGIN);
    const userData = tempUserData();
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ version: 7, passwords: { provider: 'none' } }));
    const { app, page } = await launch(userData, [LOGIN]);
    const inLogin = (source: string): Promise<boolean> =>
      app.evaluate(({ webContents }, code) => {
        const target = webContents.getAllWebContents().find((wc) => {
          const path = wc.session.storagePath ?? '';
          return path.includes('arbora-browser-') && !wc.getURL().startsWith('devtools:');
        });
        if (!target) throw new Error('No app page');
        return target.executeJavaScript(code);
      }, source);
    try {
      await openUrl(page, login.url);
      await inLogin(`document.querySelector('input[name="user"]').focus()`);
      expect(await inLogin(`Boolean(document.querySelector('[data-testid="password-field-key"]'))`)).toBe(false);
      await page.evaluate(() => window.arbora.invoke('settings.update', { passwords: { provider: '1password' } }));
      await expect
        .poll(() => inLogin(`Boolean(document.querySelector('[data-testid="password-field-key"]'))`))
        .toBe(true);
      await inLogin(`document.querySelector('input[name="user"]').blur()`);
      await expect
        .poll(() => inLogin(`Boolean(document.querySelector('[data-testid="password-field-key"]'))`))
        .toBe(false);
    } finally {
      await app.close();
      await login.close();
    }
  });

  test('offers 1Password setup from Settings without opening a terminal', async () => {
    const { app, page } = await launch(tempUserData(), [DESIGN]);
    try {
      await page.keyboard.press('ControlOrMeta+Comma');
      await page.getByTestId('settings-nav-passwords').click();
      await page.getByTestId('passwords-setup').click();
      await expect(page.getByTestId('passwords-setup-result')).toContainText('setup-1password.sh');
    } finally {
      await app.close();
    }
  });

  test('offers 1Password during setup and turns it on later from Extensions', async () => {
    const userData = tempUserData();
    const project = mkdtempSync(join(tmpdir(), 'arbora-optional-1password-'));
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'optional-1password', private: true }));
    const read = (): { passwords?: { provider?: string }; extensions?: { enabled?: string[] } } =>
      JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as {
        passwords?: { provider?: string };
        extensions?: { enabled?: string[] };
      };
    const { app, page } = await launch(userData, [project], { ARBORA_SKIP_ONBOARDING: '0' });
    try {
      await expect(page.getByTestId('onboarding')).toBeVisible();
      await page.getByRole('navigation', { name: 'Setup steps' }).getByRole('button', { name: 'Passwords' }).click();
      const step = page.getByTestId('onboarding-step-passwords');
      await expect(step).toContainText('Arbora works without it');
      await expect(step).toContainText('Settings → Extensions');
      await expect(page.getByTestId('onboarding-passwords')).not.toBeChecked();
      await page.getByTestId('onboarding-next').click();
      await expect(page.getByTestId('onboarding-step-finish')).toBeVisible();
      await page.getByRole('navigation', { name: 'Setup steps' }).getByRole('button', { name: 'Passwords' }).click();
      await page.getByTestId('onboarding-passwords').click();
      await expect.poll(() => read().passwords?.provider).toBe('1password');
      expect(read().extensions?.enabled).toEqual(
        expect.arrayContaining(['1password', 'react-devtools', 'vue-devtools']),
      );
      await page.getByTestId('onboarding-passwords').click();
      await expect.poll(() => read().passwords?.provider).toBe('none');
      expect(read().extensions?.enabled ?? []).not.toContain('1password');
      await page.getByTestId('onboarding-skip').click();
      await expect(page.getByTestId('onboarding')).toHaveCount(0);
      await focusChrome(page);
      await page.keyboard.press('ControlOrMeta+Comma');
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await page.getByTestId('settings-nav-extensions').click();
      const toggle = page.getByTestId('extension-1password');
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await toggle.click();
      await expect.poll(() => read().passwords?.provider).toBe('1password');
      expect(read().extensions?.enabled).toContain('1password');
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await toggle.click();
      await expect.poll(() => read().passwords?.provider).toBe('none');
      expect(read().extensions?.enabled ?? []).not.toContain('1password');
      expect(read().extensions?.enabled).toEqual(expect.arrayContaining(['react-devtools', 'vue-devtools']));
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('design mode opens on the app tab, not the reference tab', async () => {
    const design = await startStaticFixture(DESIGN);
    const { app, page } = await launch(tempUserData(), [DESIGN]);
    const designOn = (kind: 'app' | 'reference'): Promise<boolean> =>
      app.evaluate(({ webContents }, which) => {
        const target = webContents.getAllWebContents().find((wc) => {
          const path = wc.session.storagePath ?? '';
          if (wc.getURL().startsWith('devtools:')) return false;
          return which === 'app' ? path.includes('arbora-browser-') : path.includes('arbora-web');
        });
        if (!target) return false;
        return target.executeJavaScript('!!document.querySelector("[data-arbora-design]")') as Promise<boolean>;
      }, kind);
    try {
      await openUrl(page, design.url);
      const reference = await page.evaluate((url) => window.arbora.invoke('browser.tabs.open', { url }), design.url);
      await page.evaluate((id) => window.arbora.invoke('browser.tabs.activate', { id }), reference.id);
      await focusChrome(page);
      await page.keyboard.press('ControlOrMeta+D');
      await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'design');
      await expect.poll(async () => (await tabs(page)).find((tab) => tab.active)?.role).toBe('app');
      await expect.poll(() => designOn('app')).toBe(true);
      expect(await designOn('reference')).toBe(false);
      await page.evaluate((id) => window.arbora.invoke('browser.tabs.activate', { id }), reference.id);
      await expect.poll(async () => (await tabs(page)).find((tab) => tab.active)?.role).toBe('app');
    } finally {
      await app.close();
      await design.close();
    }
  });

  test('inspects a reference tab and follows the visible tab', async () => {
    const design = await startStaticFixture(DESIGN);
    const userData = tempUserData();
    const { app, page } = await launch(userData, [DESIGN]);
    const overlayOn = (kind: 'app' | 'reference'): Promise<boolean> =>
      app.evaluate(({ webContents }, which) => {
        const target = webContents.getAllWebContents().find((wc) => {
          const path = wc.session.storagePath ?? '';
          if (wc.getURL().startsWith('devtools:')) return false;
          return which === 'app' ? path.includes('arbora-browser-') : path.includes('arbora-web');
        });
        if (!target) return false;
        return target.executeJavaScript('!!document.querySelector("[data-arbora-overlay]")') as Promise<boolean>;
      }, kind);
    try {
      await openUrl(page, design.url);
      const reference = await page.evaluate((url) => window.arbora.invoke('browser.tabs.open', { url }), design.url);
      await page.evaluate((id) => window.arbora.invoke('browser.tabs.activate', { id }), reference.id);
      await focusChrome(page);
      await page.keyboard.press('ControlOrMeta+K');
      await expect.poll(() => overlayOn('reference')).toBe(true);
      expect(await overlayOn('app')).toBe(false);
      const appTab = (await tabs(page)).find((tab) => tab.role === 'app');
      if (!appTab) throw new Error('No app tab');
      await page.evaluate((id) => window.arbora.invoke('browser.tabs.activate', { id }), appTab.id);
      await expect.poll(() => overlayOn('app')).toBe(true);
      expect(await overlayOn('reference')).toBe(false);
    } finally {
      await app.close();
      await design.close();
    }
  });
});
