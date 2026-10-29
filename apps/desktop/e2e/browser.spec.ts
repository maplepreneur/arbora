import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { NavigationState, ScreenshotResult } from '@arbora/shared';
import { DESKTOP_ROOT, FIXTURES, launch, tempUserData } from './app';
import { freePort, startSelfSignedServer, startViteFixture, type RunningServer } from './servers';

const VITE_REACT = join(FIXTURES, 'vite-react');
const SCREENSHOTS = join(VITE_REACT, '.arbora/screenshots');
const MOD = process.platform === 'darwin' ? 'meta' : 'control';

let vite: RunningServer;

test.beforeAll(async () => {
  vite = await startViteFixture();
});

test.afterAll(async () => {
  await vite.close();
});

function browserState(page: Page): Promise<NavigationState | null> {
  return page.evaluate(() => window.arbora.invoke('browser.getState'));
}

/** Runs `code` in the user's page (main world) inside the browser panel. */
function inPage<T>(app: ElectronApplication, code: string): Promise<T> {
  return app.evaluate(async ({ webContents }, source) => {
    const page = webContents
      .getAllWebContents()
      .find((wc) => wc.session.storagePath?.includes('arbora-browser-') && !wc.getURL().startsWith('devtools:'));
    if (!page) throw new Error('No browser panel webContents');
    return (await page.executeJavaScript(source)) as T;
  }, code);
}

/** Sends native input to the page (goes through `before-input-event`, unlike CDP key events). */
function keyInPage(app: ElectronApplication, keyCode: string, modifiers: string[] = []): Promise<void> {
  return app.evaluate(
    ({ webContents }, input) => {
      const page = webContents
        .getAllWebContents()
        .find((wc) => wc.session.storagePath?.includes('arbora-browser-') && !wc.getURL().startsWith('devtools:'));
      if (!page) throw new Error('No browser panel webContents');
      page.focus();
      page.sendInputEvent({ type: 'keyDown', keyCode: input.keyCode, modifiers: input.modifiers as ['control'] });
      page.sendInputEvent({ type: 'keyUp', keyCode: input.keyCode, modifiers: input.modifiers as ['control'] });
    },
    { keyCode, modifiers },
  );
}

function viewBounds(
  app: ElectronApplication,
): Promise<{ x: number; y: number; width: number; height: number; visible: boolean }> {
  return app.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0]?.contentView.children[0];
    if (!view) throw new Error('No browser view');
    return { ...view.getBounds(), visible: view.getVisible() };
  });
}

async function openUrl(page: Page, url: string, expectedTitle: string): Promise<void> {
  const input = page.getByTestId('url-input');
  await input.click();
  await input.fill(url);
  await input.press('Enter');
  await expect.poll(async () => (await browserState(page))?.title, { timeout: 20_000 }).toBe(expectedTitle);
  await expect.poll(async () => (await browserState(page))?.loading).toBe(false);
}

async function launchWithFixture(userData = tempUserData()): Promise<{ app: ElectronApplication; page: Page }> {
  const launched = await launch(userData, [VITE_REACT]);
  await expect(launched.page.getByTestId('browser-panel')).toBeVisible();
  await expect.poll(() => browserState(launched.page)).not.toBeNull();
  return launched;
}

const FIXTURE_TITLE = 'Arbora fixture: Vite + React';

test.describe('Stage 1 browser panel', () => {
  test('loads the Vite fixture from a bare URL, tracks the panel rect and isolates the page', async () => {
    const { app, page } = await launchWithFixture();
    try {
      await expect(page.getByTestId('browser-empty')).toBeVisible();
      const bare = vite.url.replace(/^http:\/\//, '');
      await openUrl(page, bare, FIXTURE_TITLE);

      const state = await browserState(page);
      expect(state?.url).toBe(vite.url);
      await expect(page.getByTestId('url-input')).toHaveValue(vite.url);
      await expect(page.getByTestId('url-security')).toHaveAttribute('data-security', 'local');
      await expect.poll(async () => (await browserState(page))?.pageReady).toBe(true);
      expect(await page.evaluate(() => window.arbora.invoke('browser.pingPage'))).toEqual({ ok: true });

      // The native view sits exactly on the panel's viewport box.
      const box = await page.getByTestId('browser-viewport').boundingBox();
      if (!box) throw new Error('viewport not visible');
      await expect
        .poll(async () => {
          const bounds = await viewBounds(app);
          return [bounds.visible, bounds.x, bounds.y, bounds.width, bounds.height];
        })
        .toEqual([
          true,
          Math.round(box.x),
          Math.round(box.y),
          Math.round(box.x + box.width) - Math.round(box.x),
          Math.round(box.y + box.height) - Math.round(box.y),
        ]);

      // The page gets neither Node nor Arbora's bridge, and the preload exposes nothing.
      expect(await inPage(app, '[typeof window.arbora, typeof window.require, typeof window.process]')).toEqual([
        'undefined',
        'undefined',
        'undefined',
      ]);

      // Resizing the bottom panel moves the view with it.
      await page.getByTestId('panel-browser').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('ControlOrMeta+J');
      await expect.poll(async () => (await viewBounds(app)).height).toBeGreaterThan(Math.round(box.height) + 50);

      // The palette is DOM, so the view hides while it is open.
      await page.keyboard.press('ControlOrMeta+Shift+P');
      await expect(page.getByTestId('command-palette')).toBeVisible();
      await expect.poll(async () => (await viewBounds(app)).visible).toBe(false);
      await page.keyboard.press('Escape');
      await expect.poll(async () => (await viewBounds(app)).visible).toBe(true);
    } finally {
      await app.close();
    }
  });

  test('navigates, goes back and forward, hard reloads, and intercepts chords while the page has focus', async () => {
    const { app, page } = await launchWithFixture();
    try {
      await openUrl(page, vite.url, FIXTURE_TITLE);
      await openUrl(page, `${vite.url}about`, FIXTURE_TITLE);
      await expect.poll(async () => (await browserState(page))?.canGoBack).toBe(true);

      await page.getByTestId('browser-back').click();
      await expect.poll(async () => (await browserState(page))?.url).toBe(vite.url);
      await expect.poll(async () => (await browserState(page))?.canGoForward).toBe(true);
      await page.getByTestId('browser-forward').click();
      await expect.poll(async () => (await browserState(page))?.url).toBe(`${vite.url}about`);

      // State that only survives a soft reload is lost on a hard reload, which also refetches.
      await inPage(app, 'window.__arboraMarker = 1');
      await keyInPage(app, 'R', [MOD, 'shift']);
      await expect.poll(() => inPage(app, 'typeof window.__arboraMarker')).toBe('undefined');
      await expect.poll(async () => (await browserState(page))?.title).toBe(FIXTURE_TITLE);

      // Mod+K / Esc reach Arbora even though the page has focus, and the page never sees Mod+K.
      await inPage(
        app,
        `window.__keys = []; window.addEventListener('keydown', (e) => window.__keys.push(e.key.toLowerCase()), true)`,
      );
      await keyInPage(app, 'K', [MOD]);
      await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'agent');
      await keyInPage(app, 'Escape');
      await expect(page.getByTestId('mode-banner')).toBeHidden();
      expect(await inPage<string[]>(app, 'window.__keys')).not.toContain('k');

      // Zoom chords apply to the page and are shown in the URL bar.
      await keyInPage(app, '=', [MOD]);
      await expect(page.getByTestId('zoom-indicator')).toHaveText('110%');
      await keyInPage(app, '0', [MOD]);
      await expect(page.getByTestId('zoom-indicator')).toBeHidden();

      // History feeds the URL bar suggestions.
      const history = await page.evaluate(() => window.arbora.invoke('browser.history'));
      expect(history.map((h) => h.url)).toEqual(expect.arrayContaining([vite.url, `${vite.url}about`]));
    } finally {
      await app.close();
    }
  });

  test('shows console errors and failed requests in Problems with timestamps and sources', async () => {
    const { app, page } = await launchWithFixture();
    try {
      await openUrl(page, vite.url, FIXTURE_TITLE);
      await page.getByTestId('bottom-tab-problems').click();
      await expect(page.getByTestId('problems-empty')).toBeVisible();

      await inPage(app, `document.querySelector('[data-testid="card-console"] button').click()`);
      await inPage(app, `document.querySelector('[data-testid="card-network"] button').click()`);
      const closedPort = await freePort();
      await inPage(app, `fetch('http://127.0.0.1:${closedPort}/nothing').catch(() => {})`);

      const rows = page.getByTestId('problem-row');
      const consoleRow = rows.filter({ hasText: 'fixture: intentional error' });
      await expect(consoleRow).toHaveAttribute('data-source', 'console');
      await expect(consoleRow.getByTestId('problem-time')).toHaveText(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
      await expect(consoleRow.getByTestId('problem-source')).toHaveText(/^src\/App\.tsx(\?[^:]*)?:\d+:\d+$/);

      const notFound = rows.filter({ hasText: '404' });
      await expect(notFound.getByTestId('problem-message')).toHaveText('GET 404 Not Found');
      await expect(notFound.getByTestId('problem-source')).toHaveText('api/missing.json');

      await expect(rows.filter({ hasText: 'ERR_CONNECTION_REFUSED' })).toHaveCount(1);
      await expect(page.getByTestId('problems-badge')).toHaveText('3');

      // Info-level console output is buffered too, shown under "All".
      await inPage(app, `console.log('fixture: %s %d', 'hello', 42)`);
      await page.getByTestId('problems-filter-all').click();
      await expect(rows.filter({ hasText: 'fixture: hello 42' })).toHaveAttribute('data-level', 'info');
      const buffered = await page.evaluate(() => window.arbora.invoke('browser.getConsole'));
      expect(buffered.map((e) => e.message)).toEqual(
        expect.arrayContaining(['fixture: intentional error', 'fixture: hello 42']),
      );

      await page.getByTestId('problems-clear').click();
      await expect(page.getByTestId('problems-empty')).toBeVisible();
      await expect(page.getByTestId('problems-badge')).toBeHidden();
    } finally {
      await app.close();
    }
  });

  test('viewport presets emulate devices and the fixture switches to its mobile layout', async () => {
    const userData = tempUserData();
    let { app, page } = await launchWithFixture(userData);
    try {
      await openUrl(page, vite.url, FIXTURE_TITLE);
      const columns = (): Promise<number> =>
        inPage<number>(app, `getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length`);
      await expect.poll(columns).toBe(2);

      await page.getByTestId('viewport-preset').selectOption('mobile');
      await expect.poll(() => inPage<number>(app, 'window.innerWidth')).toBe(390);
      expect(
        await inPage(
          app,
          '[Math.round(window.devicePixelRatio * 100) / 100, navigator.maxTouchPoints > 0, matchMedia("(pointer: coarse)").matches]',
        ),
      ).toEqual([3, true, true]);
      await expect.poll(columns).toBe(1);
      await expect(page.getByTestId('browser-viewport')).toHaveAttribute('data-preset', 'mobile');

      // A preset larger than the panel is scaled down to fit and centred, keeping its CSS viewport.
      await page.getByTestId('viewport-preset').selectOption('desktop');
      await expect.poll(() => inPage<number>(app, 'window.innerWidth')).toBe(1920);
      const box = await page.getByTestId('browser-viewport').boundingBox();
      if (!box) throw new Error('viewport not visible');
      const bounds = await viewBounds(app);
      expect(bounds.width).toBeLessThanOrEqual(Math.round(box.width));
      expect(bounds.width / bounds.height).toBeCloseTo(1920 / 1080, 1);

      // The preset is remembered per project.
      await expect
        .poll(() => {
          const settings = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as {
            projects: Record<string, { browser?: { preset: string; lastUrl?: string } }>;
          };
          return Object.values(settings.projects)[0]?.browser;
        })
        .toEqual({ preset: 'desktop', zoomFactor: 1, lastUrl: vite.url });
      await app.close();

      ({ app, page } = await launch(userData, [VITE_REACT]));
      await expect.poll(async () => (await browserState(page))?.title, { timeout: 20_000 }).toBe(FIXTURE_TITLE);
      await expect(page.getByTestId('viewport-preset')).toHaveValue('desktop');
      await expect.poll(() => inPage<number>(app, 'window.innerWidth')).toBe(1920);

      await page.getByTestId('viewport-preset').selectOption('responsive');
      const responsive = await viewBounds(app);
      await expect.poll(() => inPage<number>(app, 'window.innerWidth')).toBe(responsive.width);
      expect(await inPage(app, 'navigator.maxTouchPoints')).toBe(0);
    } finally {
      await app.close();
    }
  });

  test('takes viewport, element, full-page and highlighted screenshots, and saves PNGs', async () => {
    rmSync(SCREENSHOTS, { recursive: true, force: true });
    const { app, page } = await launchWithFixture();
    try {
      await openUrl(page, vite.url, FIXTURE_TITLE);
      const shoot = (
        request: Parameters<typeof window.arbora.invoke<'browser.screenshot'>>[1],
      ): Promise<ScreenshotResult> => page.evaluate((r) => window.arbora.invoke('browser.screenshot', r), request);
      const innerWidth = await inPage<number>(app, 'window.innerWidth');
      const innerHeight = await inPage<number>(app, 'window.innerHeight');

      const viewport = await shoot({ mode: 'viewport' });
      expect(viewport.width).toBe(Math.round(innerWidth * viewport.dpr));
      expect(Math.abs(viewport.height - innerHeight * viewport.dpr)).toBeLessThanOrEqual(1);
      expect(pngSize(viewport.pngBase64)).toEqual({ width: viewport.width, height: viewport.height });

      const rect = { x: 20, y: 30, width: 120, height: 60 };
      const element = await shoot({ mode: 'element', rect, highlight: rect });
      expect(element.width).toBe(Math.round(rect.width * element.dpr));
      expect(element.height).toBe(Math.round(rect.height * element.dpr));
      const corner = await app.evaluate(({ nativeImage }, png) => {
        const bitmap = nativeImage.createFromBuffer(Buffer.from(png, 'base64')).toBitmap();
        return [bitmap[2], bitmap[1], bitmap[0]];
      }, element.pngBase64);
      expect(corner).toEqual([0xff, 0x3b, 0x6b]);

      await inPage(app, `document.body.style.minHeight = '3000px'`);
      const full = await shoot({ mode: 'fullPage' });
      const scrollHeight = await inPage<number>(app, 'document.documentElement.scrollHeight');
      expect(scrollHeight).toBeGreaterThan(2900);
      expect(Math.abs(full.height - scrollHeight * full.dpr)).toBeLessThanOrEqual(3);
      expect(full.width).toBe(Math.round(innerWidth * full.dpr));

      await page.getByTestId('browser-screenshot').click();
      await expect(page.getByTestId('toast').filter({ hasText: 'Screenshot saved' })).toBeVisible();
      const files = readdirSync(SCREENSHOTS).filter((f) => f.endsWith('.png'));
      expect(files).toHaveLength(1);
      const saved = readFileSync(join(SCREENSHOTS, files[0]!));
      expect(pngSize(saved.toString('base64'))).toEqual({ width: viewport.width, height: viewport.height });
      expect(readFileSync(join(SCREENSHOTS, '.gitignore'), 'utf8')).toContain('*');
    } finally {
      await app.close();
      rmSync(SCREENSHOTS, { recursive: true, force: true });
    }
  });

  test('trusts self-signed localhost certificates only while the setting is on', async () => {
    const first = await startSelfSignedServer();
    const second = await startSelfSignedServer();
    const { app, page } = await launchWithFixture();
    try {
      await openUrl(page, first.url, 'Self-signed fixture');
      await expect(page.getByTestId('url-security')).toHaveAttribute('data-security', 'local');

      await page.evaluate(() =>
        window.arbora.invoke('settings.update', { browser: { trustLocalhostCertificates: false } }),
      );
      const input = page.getByTestId('url-input');
      await input.click();
      await input.fill(second.url);
      await input.press('Enter');
      await expect(page.getByTestId('browser-error')).toBeVisible();
      const state = await browserState(page);
      expect(state?.error?.code).toBeLessThanOrEqual(-200);
      expect(state?.error?.code).toBeGreaterThan(-300);
      await expect.poll(async () => (await viewBounds(app)).visible).toBe(false);

      await page.evaluate(() =>
        window.arbora.invoke('settings.update', { browser: { trustLocalhostCertificates: true } }),
      );
      await page.getByTestId('browser-retry').click();
      await expect.poll(async () => (await browserState(page))?.title).toBe('Self-signed fixture');
      await expect(page.getByTestId('browser-error')).toBeHidden();
    } finally {
      await app.close();
      await first.close();
      await second.close();
    }
  });

  test('shows an error with a retry for an unreachable dev server, and suggestUrl loads into an empty panel', async () => {
    const { app, page } = await launchWithFixture();
    try {
      const port = await freePort();
      const input = page.getByTestId('url-input');
      await input.click();
      await input.fill(`localhost:${port}`);
      await input.press('Enter');
      await expect(page.getByTestId('browser-error')).toContainText('ERR_CONNECTION_REFUSED');
      await expect(page.getByTestId('browser-error')).toContainText('Is the dev server running?');

      const result = await page.evaluate((url) => window.arbora.invoke('browser.suggestUrl', { url }), vite.url);
      expect(result).toEqual({ navigated: true });
      await expect.poll(async () => (await browserState(page))?.title).toBe(FIXTURE_TITLE);

      const other = vite.url.replace('127.0.0.1', 'localhost');
      expect(await page.evaluate((url) => window.arbora.invoke('browser.suggestUrl', { url }), other)).toEqual({
        navigated: false,
      });
      await expect(page.getByTestId('url-suggestion')).toContainText(other);
    } finally {
      await app.close();
    }
  });

  test('loads the bundled React DevTools into the browser session', async () => {
    test.skip(
      !existsSync(join(DESKTOP_ROOT, 'resources/extensions/react-devtools/manifest.json')),
      'DevTools extensions not fetched (pnpm --filter @arbora/desktop extensions)',
    );
    const { app, page } = await launchWithFixture();
    try {
      await openUrl(page, vite.url, FIXTURE_TITLE);
      const names = await app.evaluate(({ webContents }) => {
        const pageContents = webContents
          .getAllWebContents()
          .find((wc) => wc.session.storagePath?.includes('arbora-browser-') && !wc.getURL().startsWith('devtools:'));
        return pageContents?.session.extensions.getAllExtensions().map((e) => e.name) ?? [];
      });
      expect(names.join(' ')).toMatch(/React Developer Tools/);
      // The extension's hook is in the page before React boots, so React registered a renderer.
      await expect
        .poll(() => inPage<number>(app, 'window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size ?? 0'))
        .toBeGreaterThan(0);

      // The extension adds its Components panel to the page's DevTools. Reads the DevTools
      // frontend's own module, so an Electron upgrade may need this lookup adjusted.
      await page.getByTestId('browser-devtools').click();
      await expect.poll(async () => (await browserState(page))?.devToolsOpen).toBe(true);
      await expect
        .poll(
          () =>
            app.evaluate(async ({ webContents }) => {
              const pageContents = webContents
                .getAllWebContents()
                .find(
                  (wc) => wc.session.storagePath?.includes('arbora-browser-') && !wc.getURL().startsWith('devtools:'),
                );
              const tabs: unknown = await pageContents?.devToolsWebContents
                ?.executeJavaScript(
                  `import('./ui/legacy/legacy.js').then((UI) => UI.InspectorView.InspectorView.instance().tabbedPane.tabIds())`,
                )
                .catch(() => []);
              return Array.isArray(tabs) ? tabs.map(String) : [];
            }),
          { timeout: 20_000 },
        )
        .toContainEqual(expect.stringMatching(/Components/));
      await page.getByTestId('browser-devtools').click();
      await expect.poll(async () => (await browserState(page))?.devToolsOpen).toBe(false);
    } finally {
      await app.close();
    }
  });
});

function pngSize(base64: string): { width: number; height: number } {
  const bytes = Buffer.from(base64, 'base64');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
