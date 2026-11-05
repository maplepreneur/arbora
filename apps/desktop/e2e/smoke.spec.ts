import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, focusChrome, launch, tempUserData } from './app';

const VITE_REACT = join(FIXTURES, 'vite-react');

async function width(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} is not visible`);
  return box.width;
}

test.describe('Stage 0 smoke', () => {
  const userData = tempUserData();

  test('opens a project from the CLI and renders the layout', async () => {
    const { app, page } = await launch(userData, [VITE_REACT]);
    try {
      await expect(page.getByTestId('title-project-name')).toHaveText('vite-react');
      for (const id of ['panel-tree', 'panel-chat', 'panel-content', 'content-tab-browser', 'mode-pills']) {
        await expect(page.getByTestId(id)).toBeVisible();
      }
      await expect(page.getByTestId('panel-side')).toBeAttached();
      await expect(page.getByTestId('workspace-switch')).toHaveCount(0);
      expect(await app.evaluate(({ app: electronApp }) => electronApp.getName())).toBe('arbora');
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())).toBe(
        'vite-react — Arbora',
      );
      const globals = await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        return { require: typeof w['require'], process: typeof w['process'], arbora: typeof w['arbora'] };
      });
      expect(globals).toEqual({ require: 'undefined', process: 'undefined', arbora: 'object' });
    } finally {
      await app.close();
    }
  });

  test('palette, mode chords and terminal passthrough', async () => {
    const { app, page } = await launch(userData, [VITE_REACT]);
    try {
      await focusChrome(page);

      await page.keyboard.press('ControlOrMeta+Shift+P');
      const palette = page.getByTestId('command-palette');
      await expect(palette).toBeVisible();
      await page.keyboard.type('toggle theme');
      const before = await page.evaluate(() => document.documentElement.dataset['theme']);
      await page.keyboard.press('Enter');
      await expect(palette).toBeHidden();
      await expect(page.getByTestId('toast').first()).toContainText('Theme: light');
      expect(before).toBeDefined();

      await page.keyboard.press('ControlOrMeta+K');
      await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'agent');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('mode-banner')).toBeHidden();

      await page.keyboard.press('ControlOrMeta+D');
      await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'design');
      await page.keyboard.press('ControlOrMeta+D');
      await expect(page.getByTestId('mode-banner')).toBeHidden();

      // Plain Ctrl chords reach the terminal instead of toggling modes.
      await page.keyboard.press('Control+`');
      await page.locator('[data-testid="terminal-pane"] .xterm').first().click();
      await expect(page.locator('[data-testid="terminal-pane"] textarea').first()).toBeFocused();
      await page.keyboard.press('Control+K');
      await page.waitForTimeout(300);
      await expect(page.getByTestId('mode-banner')).toBeHidden();
      await page.keyboard.press('ControlOrMeta+Shift+P');
      await expect(palette).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(palette).toBeHidden();
    } finally {
      await app.close();
    }
  });

  test('mode pills switch modes, and Mod+Alt+arrows move focus between the columns', async () => {
    const { app, page } = await launch(userData, [VITE_REACT]);
    const focused = () =>
      page.evaluate(() => document.activeElement?.closest('[data-landmark]')?.getAttribute('data-landmark') ?? null);
    try {
      const pills = page.getByTestId('mode-pills');
      await expect(pills).toHaveAttribute('data-mode', 'idle');
      await page.getByTestId('mode-pill-agent').click();
      await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'agent');
      await expect(pills).toHaveAttribute('data-mode', 'agent');
      await page.getByTestId('mode-pill-design').click();
      await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'design');
      await page.getByTestId('mode-pill-idle').click();
      await expect(page.getByTestId('mode-banner')).toBeHidden();
      await expect(pills).toHaveAttribute('data-mode', 'idle');

      // The terminal is a right-column tab; Show Terminal starts a shell when there is none.
      await focusChrome(page);
      await page.keyboard.press('Control+`');
      await expect(page.locator('[data-testid="terminal-pane"] textarea').first()).toBeFocused();
      // Left from the right column reaches the chat, then the tree; right walks back.
      await page.keyboard.press('ControlOrMeta+Alt+ArrowLeft');
      await expect.poll(focused).toBe('agent');
      await page.keyboard.press('ControlOrMeta+Alt+ArrowLeft');
      await expect.poll(focused).toBe('tree');
      await page.keyboard.press('ControlOrMeta+Alt+ArrowRight');
      await expect.poll(focused).toBe('agent');
      await page.keyboard.press('ControlOrMeta+Alt+ArrowRight');
      await expect(page.locator('[data-testid="terminal-pane"] textarea').first()).toBeFocused();
      await focusChrome(page);
      await page.keyboard.press('ControlOrMeta+Shift+E');
      await expect(page.getByTestId('explorer-tree')).toBeVisible();
      // The side column hides from its own header and comes back from the right column's strip.
      const sideWidth = async (): Promise<number> => (await page.getByTestId('panel-side').boundingBox())?.width ?? 0;
      await page.getByTestId('side-hide').click();
      await expect.poll(sideWidth).toBe(0);
      await page.getByTestId('side-show').click();
      await expect.poll(sideWidth).toBeGreaterThan(100);
      await expect(page.getByTestId('side-show')).toHaveCount(0);
      // Mod+Shift+B toggles it too.
      await focusChrome(page);
      await page.keyboard.press('ControlOrMeta+Shift+B');
      await expect.poll(sideWidth).toBe(0);
      await page.keyboard.press('ControlOrMeta+Shift+B');
      await expect.poll(sideWidth).toBeGreaterThan(100);

      // Mod+B shows and hides the project tree, making room by closing Files when the window is full.
      const treeWidth = async (): Promise<number> => (await page.getByTestId('panel-tree').boundingBox())?.width ?? 0;
      if ((await treeWidth()) === 0) await page.keyboard.press('ControlOrMeta+B');
      await expect.poll(treeWidth).toBeGreaterThan(100);
      await page.keyboard.press('ControlOrMeta+B');
      await expect.poll(treeWidth).toBe(0);
    } finally {
      await app.close();
    }
  });

  test('main intercepts mode chords before the renderer sees them', async () => {
    const { app, page } = await launch(userData, [VITE_REACT]);
    try {
      await focusChrome(page);
      await page.evaluate(() => {
        const w = window as unknown as { seenKeys: string[] };
        w.seenKeys = [];
        window.addEventListener('keydown', (e) => w.seenKeys.push(e.key.toLowerCase()), { capture: true });
      });
      const send = (keyCode: string, modifiers: ('control' | 'meta' | 'shift')[]) =>
        app.evaluate(
          ({ BrowserWindow }, input) => {
            BrowserWindow.getAllWindows()[0]?.webContents.sendInputEvent({ type: 'keyDown', ...input });
          },
          { keyCode, modifiers },
        );
      const mod = process.platform === 'darwin' ? 'meta' : 'control';

      await send('K', [mod]);
      await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'agent');
      await send('Escape', []);
      await expect(page.getByTestId('mode-banner')).toBeHidden();
      // Esc outside a mode is not intercepted and reaches the page.
      await send('Escape', []);
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { seenKeys: string[] }).seenKeys))
        .toContain('escape');
      const seen = await page.evaluate(() => (window as unknown as { seenKeys: string[] }).seenKeys);
      expect(seen).not.toContain('k');
      expect(seen.filter((k) => k === 'escape')).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  test('persists the column layout and the right tab across restarts', async () => {
    {
      const { app, page } = await launch(userData, [VITE_REACT]);
      try {
        await focusChrome(page);
        await page.keyboard.press('ControlOrMeta+Shift+M');
        await expect(page.getByTestId('content-tab-problems')).toHaveAttribute('aria-selected', 'true');
        await page.getByTestId('content-maximize').click();
        await expect.poll(() => width(page, 'panel-chat').catch(() => 0)).toBeLessThan(2);
        await expect(page.getByTestId('content-maximize')).toHaveAttribute('aria-pressed', 'true');
        await page.waitForTimeout(600);
      } finally {
        await app.close();
      }
    }
    {
      const { app, page } = await launch(userData, [VITE_REACT]);
      try {
        await expect(page.getByTestId('content-tab-problems')).toHaveAttribute('aria-selected', 'true');
        expect(await width(page, 'panel-chat').catch(() => 0)).toBeLessThan(2);
        await page.keyboard.press('ControlOrMeta+Alt+M');
        await expect.poll(() => width(page, 'panel-chat').catch(() => 0)).toBeGreaterThan(200);
        await expect(page.getByTestId('content-maximize')).toHaveAttribute('aria-pressed', 'false');
        await page.waitForTimeout(600);
      } finally {
        await app.close();
      }
    }
  });

  test('keybindings are editable in settings.json', async () => {
    const settingsFile = join(userData, 'settings.json');
    const { app, page } = await launch(userData, [VITE_REACT]);
    try {
      const settings = JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, unknown>;
      settings['keybindings'] = { 'arbora.agentMode': 'mod+i' };
      writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
      await expect
        .poll(() => page.evaluate(() => window.arbora.invoke('settings.get').then((s) => s.keybindings)))
        .toEqual({
          'arbora.agentMode': 'mod+i',
        });
      await focusChrome(page);
      await page.keyboard.press('ControlOrMeta+K');
      await page.waitForTimeout(300);
      await expect(page.getByTestId('mode-banner')).toBeHidden();
      await page.keyboard.press('ControlOrMeta+I');
      await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'agent');
    } finally {
      await app.close();
    }
  });

  test('shows the welcome screen with recent projects', async () => {
    // A launch with projects in the tree opens the shell; only a machine without any shows the welcome.
    const fresh = tempUserData();
    writeFileSync(
      join(fresh, 'settings.json'),
      JSON.stringify({ version: 3, recentProjects: [{ path: VITE_REACT, name: 'vite-react', openedAt: 1 }] }),
    );
    const { app, page } = await launch(fresh);
    try {
      await expect(page.getByTestId('welcome')).toBeVisible();
      const recents = page.getByTestId('recent-projects');
      await expect(recents).toContainText('vite-react');
      await recents.getByText('vite-react', { exact: true }).click();
      await expect(page.getByTestId('title-project-name')).toHaveText('vite-react');
      await expect(page.getByTestId('grove')).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
