import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, launch, tempUserData } from './app';

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
      for (const id of ['activity-rail', 'panel-sidebar', 'panel-browser', 'panel-bottom', 'panel-agent']) {
        await expect(page.getByTestId(id)).toBeVisible();
      }
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
      await page.getByTestId('panel-browser').click();

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

  test('main intercepts mode chords before the renderer sees them', async () => {
    const { app, page } = await launch(userData, [VITE_REACT]);
    try {
      await page.getByTestId('panel-browser').click();
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

  test('persists panel sizes and collapsed state across restarts', async () => {
    let agentWidth: number;
    {
      const { app, page } = await launch(userData, [VITE_REACT]);
      try {
        // Collapsing the sidebar first leaves the center room to shrink in a narrow tile.
        await page.getByTestId('panel-browser').click();
        await page.keyboard.press('ControlOrMeta+B');
        await expect.poll(() => width(page, 'panel-sidebar').catch(() => 0)).toBeLessThan(2);

        const separator = page.locator('#sep-agent');
        const box = await separator.boundingBox();
        if (!box) throw new Error('separator not visible');
        const startWidth = await width(page, 'panel-agent');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 8 });
        await page.mouse.up();
        agentWidth = await width(page, 'panel-agent');
        expect(agentWidth).toBeGreaterThan(startWidth + 80);

        await page.getByTestId('bottom-tab-problems').click();
        await page.waitForTimeout(600);
      } finally {
        await app.close();
      }
    }
    {
      const { app, page } = await launch(userData, [VITE_REACT]);
      try {
        await expect.poll(() => width(page, 'panel-agent')).toBeGreaterThan(agentWidth - 3);
        expect(await width(page, 'panel-agent')).toBeLessThan(agentWidth + 3);
        expect(await width(page, 'panel-sidebar').catch(() => 0)).toBeLessThan(2);
        await expect(page.getByTestId('bottom-tab-problems')).toHaveAttribute('aria-selected', 'true');
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
      await page.getByTestId('panel-browser').click();
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
    const { app, page } = await launch(userData);
    try {
      await expect(page.getByTestId('welcome')).toBeVisible();
      const recents = page.getByTestId('recent-projects');
      await expect(recents).toContainText('vite-react');
      await recents.getByText('vite-react', { exact: true }).click();
      await expect(page.getByTestId('title-project-name')).toHaveText('vite-react');
      await expect(page.getByTestId('workspace')).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
