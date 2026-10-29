import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  createUserDataDir,
  fixtures,
  launchArbora,
  mod,
  pressNative,
  type LaunchedApp,
} from './app';

let userData: ReturnType<typeof createUserDataDir>;
let running: LaunchedApp | undefined;

test.beforeEach(() => {
  userData = createUserDataDir();
});

test.afterEach(async () => {
  await running?.app.close();
  running = undefined;
  userData.dispose();
});

async function launch(args: string[] = []): Promise<LaunchedApp> {
  running = await launchArbora(userData.path, args);
  return running;
}

async function relaunch(args: string[] = []): Promise<LaunchedApp> {
  await running?.app.close();
  return launch(args);
}

function panel(page: Page, id: string) {
  return page.locator(`[data-panel][id="${id}"]`);
}

async function width(page: Page, id: string): Promise<number> {
  return (await panel(page, id).boundingBox())?.width ?? 0;
}

async function height(page: Page, id: string): Promise<number> {
  return (await panel(page, id).boundingBox())?.height ?? 0;
}

test('opens the project passed on the command line and renders the layout', async () => {
  const { app, page } = await launch([fixtures.viteReact]);

  await expect(page.getByTestId('workspace')).toBeVisible();
  for (const testId of ['panel-browser', 'panel-agent', 'panel-bottom', 'panel-sidebar']) {
    await expect(page.getByTestId(testId)).toBeVisible();
  }
  await expect(page.getByTestId('activity-rail')).toBeVisible();
  await expect(page.getByTestId('title-bar')).toContainText('vite-react');

  const title = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.getTitle(),
  );
  expect(title).toBe('vite-react — Arbora');
  expect(
    await page.evaluate(() => ({
      require: typeof (window as { require?: unknown }).require,
      process: typeof (window as { process?: unknown }).process,
      bridge: Object.keys(window.arbora).sort(),
    })),
  ).toEqual({
    require: 'undefined',
    process: 'undefined',
    bridge: ['getPathForFile', 'invoke', 'on'],
  });

  await page.screenshot({ path: test.info().outputPath('layout.png') });
});

test('command palette, theme toggle and mode chords', async () => {
  const { app, page } = await launch([fixtures.viteReact]);
  await expect(page.getByTestId('workspace')).toBeVisible();

  await pressNative(app, 'P', ['mod', 'shift']);
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await page.keyboard.type('toggle light');
  const wasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(!wasDark);
  expect(
    (JSON.parse(readFileSync(join(userData.path, 'settings.json'), 'utf8')) as { theme: string })
      .theme,
  ).toBe(wasDark ? 'light' : 'dark');

  const badge = page.getByTestId('mode-badge');
  await pressNative(app, 'K', ['mod']);
  await expect(badge).toHaveAttribute('data-mode', 'agent');
  await pressNative(app, 'D', ['mod']);
  await expect(badge).toHaveAttribute('data-mode', 'design');
  await page.screenshot({ path: test.info().outputPath('design-mode.png') });
  await pressNative(app, 'Escape');
  await expect(badge).toBeHidden();

  // Escape is only intercepted while a mode is active, so it still reaches the page otherwise.
  await pressNative(app, 'P', ['mod', 'shift']);
  await expect(palette).toBeVisible();
  await pressNative(app, 'Escape');
  await expect(palette).toBeHidden();
});

test('persists panel sizes and collapsed state per project', async () => {
  let { page } = await launch([fixtures.viteReact]);
  await expect(page.getByTestId('workspace')).toBeVisible();
  const initialBottom = await height(page, 'bottom');

  const separator = page.locator('[data-separator]').nth(1);
  const box = await separator.boundingBox();
  if (!box) throw new Error('vertical separator not found');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => height(page, 'bottom')).toBeGreaterThan(initialBottom + 80);
  const resizedBottom = await height(page, 'bottom');

  // Mod+B is dispatched from the renderer's keydown path, not intercepted in main.
  await page.keyboard.press(`${mod}+B`);
  await expect.poll(() => width(page, 'sidebar')).toBeLessThan(2);

  await expect
    .poll(() => {
      const state = JSON.parse(readFileSync(join(userData.path, 'state.json'), 'utf8')) as {
        projects: Record<string, { layout?: { collapsed: Record<string, boolean> } }>;
      };
      return Object.values(state.projects)[0]?.layout?.collapsed.sidebar;
    })
    .toBe(true);

  ({ page } = await relaunch([fixtures.viteReact]));
  await expect(page.getByTestId('workspace')).toBeVisible();
  await expect.poll(() => width(page, 'sidebar')).toBeLessThan(2);
  expect(Math.abs((await height(page, 'bottom')) - resizedBottom)).toBeLessThan(4);

  await page.keyboard.press(`${mod}+B`);
  await expect.poll(() => width(page, 'sidebar')).toBeGreaterThan(100);
});

test('welcome screen opens a project from the dialog and lists it in recents', async () => {
  const first = await launch();
  const { app } = first;
  let { page } = first;
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('welcome.png') });

  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, fixtures.plainHtml);
  await page.getByTestId('open-project').click();
  await expect(page.getByTestId('workspace')).toBeVisible();
  await expect(page.getByTestId('title-bar')).toContainText('plain-html');

  ({ page } = await relaunch());
  await expect(page.getByTestId('recent-projects')).toContainText('plain-html');
  await page.getByTestId('recent-projects').getByText('plain-html').first().click();
  await expect(page.getByTestId('workspace')).toBeVisible();
});

test('welcome screen opens a folder dropped from the file manager', async () => {
  const { page } = await launch();
  const dropZone = page.getByTestId('drop-zone');
  await expect(dropZone).toBeVisible();
  const box = await dropZone.boundingBox();
  if (!box) throw new Error('drop zone not found');

  // CDP drag events carry real file paths, like a drop from a file manager; synthetic DOM
  // drops cannot, because `webUtils.getPathForFile` only resolves files backed by disk.
  const cdp = await page.context().newCDPSession(page);
  const position = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const data = { items: [], files: [fixtures.viteReact], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
    await cdp.send('Input.dispatchDragEvent', { type, ...position, data });
  }

  await expect(page.getByTestId('workspace')).toBeVisible();
  await expect(page.getByTestId('title-bar')).toContainText('vite-react');
});

test('keybindings are editable in settings.json, including while running', async () => {
  const settingsPath = join(userData.path, 'settings.json');
  writeFileSync(
    settingsPath,
    JSON.stringify({ version: 1, keybindings: { 'arbora.agentMode': 'mod+shift+k' } }),
  );
  const { app, page } = await launch([fixtures.viteReact]);
  await expect(page.getByTestId('workspace')).toBeVisible();
  const badge = page.getByTestId('mode-badge');

  await pressNative(app, 'K', ['mod']);
  await expect(badge).toBeHidden();
  await pressNative(app, 'K', ['mod', 'shift']);
  await expect(badge).toHaveAttribute('data-mode', 'agent');
  await pressNative(app, 'Escape');
  await expect(badge).toBeHidden();

  writeFileSync(
    settingsPath,
    JSON.stringify({ version: 1, keybindings: { 'arbora.designMode': 'mod+alt+d' } }),
  );
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await window.arbora.invoke.getKeybindings()).bindings.some(
          (binding) => binding.chord === 'mod+alt+d',
        ),
      ),
    )
    .toBe(true);
  await pressNative(app, 'D', ['mod', 'alt']);
  await expect(badge).toHaveAttribute('data-mode', 'design');
});
