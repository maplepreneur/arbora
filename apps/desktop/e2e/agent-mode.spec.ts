import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { NavigationState } from '@arbora/shared';
import { DESKTOP_ROOT, FIXTURES, launch, tempUserData } from './app';
import { startNextFixture, startNuxtFixture, startViteFixture, type RunningServer } from './servers';

const FAKE_AGENT = resolve(DESKTOP_ROOT, '../../packages/acp-client/src/testing/fake-agent.ts');
const FAKE_ID = 'fake';
const FAKE_NO_IMAGE_ID = 'fake-no-image';
const MOD = process.platform === 'darwin' ? 'meta' : 'control';
const OVERLAY = '!!document.querySelector("[data-arbora-overlay]")';

/** Two fake agents: one that takes images and one that does not (`FAKE_AGENT_NO_IMAGE=1`). */
function userDataWithFakeAgents(): string {
  const userData = tempUserData();
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      version: 3,
      agents: {
        custom: [
          { id: FAKE_ID, name: 'Fake agent', command: process.execPath, args: [FAKE_AGENT], env: {} },
          {
            id: FAKE_NO_IMAGE_ID,
            name: 'Fake agent (no images)',
            command: process.execPath,
            args: [FAKE_AGENT],
            env: { FAKE_AGENT_NO_IMAGE: '1' },
          },
        ],
        permissions: {},
      },
    }),
  );
  return userData;
}

function browserState(page: Page): Promise<NavigationState | null> {
  return page.evaluate(() => window.arbora.invoke('browser.getState'));
}

function inPage<T>(app: ElectronApplication, code: string): Promise<T> {
  return app.evaluate(async ({ webContents }, source) => {
    const page = webContents
      .getAllWebContents()
      .find((wc) => wc.session.storagePath?.includes('arbora-browser-') && !wc.getURL().startsWith('devtools:'));
    if (!page) throw new Error('No browser panel webContents');
    return (await page.executeJavaScript(source)) as T;
  }, code);
}

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

/** Real mouse input at the centre of `selector` (goes through the inspector's capture listeners). */
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

function viewVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.contentView.children[0]?.getVisible() ?? false,
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

/** Waits until React or Vue has hydrated the button (Vue's expandos are non-enumerable, hence `in`). */
async function waitForHydration(app: ElectronApplication, selector: string): Promise<void> {
  await expect
    .poll(
      () =>
        inPage<boolean>(
          app,
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && ('__vueParentComponent' in el || Object.keys(el).some((k) => k.startsWith('__reactFiber'))); })()`,
        ),
      { timeout: 60_000 },
    )
    .toBe(true);
}

async function enterAgentMode(app: ElectronApplication, page: Page): Promise<void> {
  await page.getByTestId('browser-toolbar').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('ControlOrMeta+K');
  await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-phase', 'inspecting');
  await expect.poll(() => inPage<boolean>(app, OVERLAY)).toBe(true);
}

async function deleteThreads(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (const thread of await window.arbora.invoke('agent.listThreads')) {
      await window.arbora.invoke('agent.deleteThread', { threadId: thread.id });
    }
  });
}

function removeAgentModeScreenshots(project: string, before: ReadonlySet<string>): void {
  const dir = join(project, '.arbora/screenshots');
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (file.endsWith('-agent-mode.png') && !before.has(file)) rmSync(join(dir, file));
  }
}

function screenshotsIn(project: string): Set<string> {
  const dir = join(project, '.arbora/screenshots');
  return new Set(existsSync(dir) ? readdirSync(dir) : []);
}

test.describe('Stage 4 agent mode on Vite + React 18', () => {
  const VITE_REACT = join(FIXTURES, 'vite-react');
  const BUTTON = '[data-testid="card-counter"] button';
  let vite: RunningServer;

  test.beforeAll(async () => {
    vite = await startViteFixture();
  });

  test.afterAll(async () => {
    await vite.close();
  });

  test('shows the component chain and file:line, then sends the prompt with the outlined screenshot', async () => {
    const before = screenshotsIn(VITE_REACT);
    const { app, page } = await launch(userDataWithFakeAgents(), [VITE_REACT]);
    try {
      await openAndWait(page, vite.url);
      await waitForHydration(app, BUTTON);
      await enterAgentMode(app, page);
      await clickInPage(app, BUTTON);

      const popover = page.getByTestId('agent-mode-popover');
      await expect(popover).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('agent-mode-chain')).toHaveAttribute('data-chain', 'Button ← Card ← App');
      await expect(page.getByTestId('agent-mode-source')).toHaveText('src/components/Card.tsx:19');
      await expect(page.getByTestId('agent-mode-tier')).toHaveAttribute('data-tier', '1');
      await expect(page.getByTestId('agent-mode-input')).toBeFocused();
      // The native view is hidden behind the captured frame while the popover is open.
      await expect.poll(() => viewVisible(app)).toBe(false);
      await expect(page.getByTestId('agent-mode-frame')).toBeVisible();
      const outline = await page.getByTestId('agent-mode-outline').boundingBox();
      const anchor = await popover.boundingBox();
      expect(outline && outline.width > 20 && outline.height > 10).toBe(true);
      expect(anchor && outline && anchor.y >= outline.y + outline.height - 1).toBe(true);
      // The click was the inspector's; the page's own handler did not run.
      expect(await inPage<string>(app, `document.querySelector('[data-testid="card-counter"] p').textContent`)).toBe(
        'Clicked 0 times',
      );

      // The breadcrumb retargets the prompt to an ancestor component.
      await page.getByTestId('agent-mode-crumb').nth(1).click();
      await expect(page.getByTestId('agent-mode-source')).toHaveText('src/App.tsx:13');
      await page.getByTestId('agent-mode-crumb').nth(0).click();
      await expect(page.getByTestId('agent-mode-source')).toHaveText('src/components/Card.tsx:19');

      await page.getByTestId('agent-mode-target').selectOption(`new:${FAKE_ID}`);
      const input = page.getByTestId('agent-mode-input');
      await input.fill('make this button red');
      await input.press('Enter');

      await expect(page.getByTestId('mode-banner')).toHaveCount(0);
      await expect(page.getByTestId('thread-view')).toBeVisible();
      const thread = page.getByTestId('thread-view');
      await expect(page.getByTestId('user-message').first()).toContainText('make this button red', { timeout: 30_000 });
      await expect(page.getByTestId('user-message').first()).toContainText('Button ← Card ← App');
      await expect(page.getByTestId('user-message').first()).toContainText('Rendered at: src/components/Card.tsx:19');
      await expect(thread).toContainText('Received an image (image/png', { timeout: 30_000 });
      await expect(thread).toContainText(
        'Attached files: src/components/Button.tsx, src/components/Card.tsx, src/App.tsx',
      );
      // The thread is named after the request, not the prompt template's first line.
      const titles = await page.evaluate(async () =>
        (await window.arbora.invoke('agent.listThreads')).map((t) => t.title),
      );
      expect(titles).toEqual(['make this button red']);

      // Leaving the mode removes the overlay and brings the page back.
      await expect.poll(() => inPage<boolean>(app, OVERLAY)).toBe(false);
      await expect.poll(() => viewVisible(app)).toBe(true);
      // The outline is burned into the image the agent got, on the button's left edge (DPR-scaled).
      const sent = [...screenshotsIn(VITE_REACT)].find((f) => f.endsWith('-agent-mode.png') && !before.has(f));
      expect(sent).toBeDefined();
      const rect = await inPage<{ x: number; y: number; height: number; innerWidth: number }>(
        app,
        `(() => { const r = document.querySelector(${JSON.stringify(BUTTON)}).getBoundingClientRect(); return { x: r.x, y: r.y, height: r.height, innerWidth }; })()`,
      );
      const pixel = await app.evaluate(
        ({ nativeImage }, args) => {
          const image = nativeImage.createFromPath(args.file);
          const { width } = image.getSize();
          const bitmap = image.toBitmap();
          const scale = width / args.rect.innerWidth;
          const x = Math.round(args.rect.x * scale + scale);
          const y = Math.round((args.rect.y + args.rect.height / 2) * scale);
          const i = (y * width + x) * 4;
          return { b: bitmap[i] ?? 0, g: bitmap[i + 1] ?? 0, r: bitmap[i + 2] ?? 0 };
        },
        { file: join(VITE_REACT, '.arbora/screenshots', sent ?? ''), rect },
      );
      expect(pixel).toEqual({ r: 0xff, g: 0x3b, b: 0x6b });
    } finally {
      await deleteThreads(page).catch(() => undefined);
      await app.close();
      removeAgentModeScreenshots(VITE_REACT, before);
    }
  });

  test('page chords toggle and exit the mode; agents without image support get the screenshot path', async () => {
    const before = screenshotsIn(VITE_REACT);
    const { app, page } = await launch(userDataWithFakeAgents(), [VITE_REACT]);
    try {
      await openAndWait(page, vite.url);
      await waitForHydration(app, BUTTON);

      // Mod+K and Esc work while the page has keyboard focus (intercepted in main).
      await keyInPage(app, 'K', [MOD]);
      await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-phase', 'inspecting');
      await expect.poll(() => inPage<boolean>(app, OVERLAY)).toBe(true);
      await keyInPage(app, 'Escape');
      await expect(page.getByTestId('mode-banner')).toHaveCount(0);
      await expect.poll(() => inPage<boolean>(app, OVERLAY)).toBe(false);

      await keyInPage(app, 'K', [MOD]);
      await expect.poll(() => inPage<boolean>(app, OVERLAY)).toBe(true);
      await clickInPage(app, BUTTON);
      await expect(page.getByTestId('agent-mode-popover')).toBeVisible({ timeout: 20_000 });

      // "Pick again" goes back to hovering, and a second click selects again.
      await page.getByTestId('agent-mode-repick').click();
      await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-phase', 'inspecting');
      await expect.poll(() => viewVisible(app)).toBe(true);
      await clickInPage(app, BUTTON);
      await expect(page.getByTestId('agent-mode-popover')).toBeVisible({ timeout: 20_000 });

      await page.getByTestId('agent-mode-target').selectOption(`new:${FAKE_NO_IMAGE_ID}`);
      await page.getByTestId('agent-mode-input').fill('make this button red');
      await page.getByTestId('agent-mode-send').click();

      const thread = page.getByTestId('thread-view');
      await expect(page.getByTestId('user-message').first()).toContainText('Open it if you can read images', {
        timeout: 30_000,
      });
      await expect(thread).toContainText('-agent-mode.png', { timeout: 30_000 });
      await expect(thread).not.toContainText('Received an image');
    } finally {
      await deleteThreads(page).catch(() => undefined);
      await app.close();
      removeAgentModeScreenshots(VITE_REACT, before);
    }
  });
});

test.describe('Stage 4 agent mode on Nuxt', () => {
  const NUXT = join(FIXTURES, 'nuxt');
  let nuxt: RunningServer;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    nuxt = await startNuxtFixture();
  });

  test.afterAll(async () => {
    await nuxt.close();
  });

  test('shows Vue component names and .vue paths', async () => {
    test.setTimeout(120_000);
    const { app, page } = await launch(userDataWithFakeAgents(), [NUXT]);
    try {
      await openAndWait(page, nuxt.url);
      await waitForHydration(app, '.counter-card button');
      await enterAgentMode(app, page);
      await clickInPage(app, '.counter-card button');
      await expect(page.getByTestId('agent-mode-popover')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('agent-mode-chain')).toHaveAttribute('data-chain', 'AppButton ← CounterCard ← app');
      await expect(page.getByTestId('agent-mode-source')).toHaveText('app/components/CounterCard.vue');
      await expect(page.getByTestId('agent-mode-tier')).toHaveAttribute('data-tier', '2');
      await page.getByTestId('agent-mode-crumb').nth(1).click();
      await expect(page.getByTestId('agent-mode-source')).toHaveText('app/app.vue');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('mode-banner')).toHaveCount(0);
      await expect.poll(() => inPage<boolean>(app, OVERLAY)).toBe(false);
    } finally {
      await app.close();
    }
  });
});

test.describe('Stage 4 agent mode on Next.js (React 19)', () => {
  const NEXT = join(FIXTURES, 'next');
  let next: RunningServer;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    next = await startNextFixture();
  });

  test.afterAll(async () => {
    await next.close();
  });

  test('shows names (with server components) and sends a tier 3 prompt with grep candidates', async () => {
    test.setTimeout(120_000);
    const before = screenshotsIn(NEXT);
    const { app, page } = await launch(userDataWithFakeAgents(), [NEXT]);
    try {
      await openAndWait(page, next.url);
      await waitForHydration(app, '.counter-card button');
      await enterAgentMode(app, page);
      await clickInPage(app, '.counter-card button');
      await expect(page.getByTestId('agent-mode-popover')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('agent-mode-chain')).toHaveAttribute(
        'data-chain',
        'Button ← Card ← Counter ← Page (server) ← RootLayout (server)',
      );
      await expect(page.getByTestId('agent-mode-tier')).toHaveAttribute('data-tier', '3');
      const sources = page.getByTestId('agent-mode-include-sources');
      await expect(sources).toHaveText(/\d+ candidate files?/);
      await expect(sources).toHaveAttribute('title', /app\/components\/Button\.tsx/);

      await page.getByTestId('agent-mode-target').selectOption(`new:${FAKE_ID}`);
      await page.getByTestId('agent-mode-input').fill('make this button red');
      await page.getByTestId('agent-mode-input').press('Enter');
      const message = page.getByTestId('user-message').first();
      await expect(message).toContainText('tier 3', { timeout: 30_000 });
      await expect(message).toContainText('Candidate files');
      await expect(message).toContainText('app/components/Button.tsx');
      await expect(page.getByTestId('thread-view')).toContainText('app/components/Button.tsx', { timeout: 30_000 });
    } finally {
      await deleteThreads(page).catch(() => undefined);
      await app.close();
      removeAgentModeScreenshots(NEXT, before);
    }
  });
});
