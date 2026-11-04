import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { NavigationState, TerminalInfo } from '@arbora/shared';
import { DESKTOP_ROOT, FIXTURES, launch, showRight, tempUserData } from './app';
import { freePort } from './servers';

const VITE_REACT = join(FIXTURES, 'vite-react');
const PLAIN_HTML = join(FIXTURES, 'plain-html');
const VITE_BIN = resolve(DESKTOP_ROOT, '../../node_modules/vite/bin/vite.js');
const FIXTURE_TITLE = 'Arbora fixture: Vite + React';
const isMac = process.platform === 'darwin';

function browserState(page: Page): Promise<NavigationState | null> {
  return page.evaluate(() => window.arbora.invoke('browser.getState'));
}

function terminals(page: Page): Promise<TerminalInfo[]> {
  return page.evaluate(() => window.arbora.invoke('terminal.list'));
}

function lines(page: Page, id: string): Promise<string> {
  return page
    .evaluate((terminalId) => window.arbora.invoke('terminal.lines', { id: terminalId }), id)
    .then((l) => l.join('\n'));
}

function pageHasFocus(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .some(
        (wc) =>
          wc.session.storagePath?.includes('arbora-browser-') && !wc.getURL().startsWith('devtools:') && wc.isFocused(),
      ),
  );
}

/** Focuses the active xterm (its hidden textarea receives keyboard input). */
async function focusTerminal(page: Page): Promise<void> {
  await page.locator('[data-testid="terminal-pane"][data-active="true"] .xterm').first().click();
  await expect(page.locator('[data-testid="terminal-pane"][data-active="true"] textarea').first()).toBeFocused();
}

async function runInTerminal(page: Page, command: string): Promise<void> {
  await focusTerminal(page);
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

test.describe('Stage 2 terminal panel', () => {
  test('a dev server started in the terminal opens in the empty browser panel', async () => {
    const port = await freePort();
    const { app, page } = await launch(tempUserData(), [VITE_REACT]);
    try {
      await showRight(page, 'terminal');
      await expect(page.getByTestId('terminal-xterm')).toBeVisible();
      await expect.poll(async () => (await terminals(page)).length).toBe(1);
      const [shell] = await terminals(page);
      if (!shell) throw new Error('no terminal');
      expect(shell.kind).toBe('shell');

      await runInTerminal(page, `node "${VITE_BIN}" --port ${port} --strictPort --host 127.0.0.1`);
      const url = `http://127.0.0.1:${port}/`;
      await expect(page.getByTestId('toast').filter({ hasText: `Opened ${url}` })).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => (await browserState(page))?.title, { timeout: 20_000 }).toBe(FIXTURE_TITLE);
      expect(await lines(page, shell.id)).toContain(`Local:   ${url}`);
      // Loading the page in the background must not take keyboard focus from the shell, even after
      // the main process stops guarding it.
      await page.waitForTimeout(1500);
      expect(await pageHasFocus(app)).toBe(false);

      // Ctrl+K reaches the shell (kill line) instead of toggling agent mode.
      await focusTerminal(page);
      await page.keyboard.press('Control+K');
      await page.waitForTimeout(300);
      await expect(page.getByTestId('mode-pills')).toHaveAttribute('data-mode', 'idle');
      // Ctrl+C stops Vite; the shell stays.
      await page.keyboard.press('Control+C');
      await expect.poll(async () => (await terminals(page))[0]?.exitCode).toBeNull();
    } finally {
      await app.close();
    }
  });

  test('Run Dev Server infers the command, writes project.json, and restarts in place', async () => {
    rmSync(join(PLAIN_HTML, '.arbora'), { recursive: true, force: true });
    const port = await freePort();
    const url = `http://localhost:${port}/`;
    const { app, page } = await launch(tempUserData(), [PLAIN_HTML], { PORT: String(port) });
    try {
      await showRight(page, 'terminal');
      await page.getByTestId('devserver-run').click();
      await expect.poll(async () => (await terminals(page)).find((t) => t.kind === 'dev')?.command).toBe('pnpm dev');
      const settingsFile = join(PLAIN_HTML, '.arbora/project.json');
      await expect.poll(() => existsSync(settingsFile)).toBe(true);
      expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toMatchObject({ devCommand: 'pnpm dev' });
      await expect.poll(async () => (await browserState(page))?.url, { timeout: 30_000 }).toBe(url);
      const status = await page.evaluate(() => window.arbora.invoke('devServer.status'));
      expect(status).toMatchObject({ running: true, url });

      const dev = (await terminals(page)).find((t) => t.kind === 'dev');
      if (!dev?.pid) throw new Error('dev server not running');
      await page.getByTestId('devserver-restart').click();
      // The browser already shows the URL, so the re-detected URL is offered instead of loaded.
      await expect(page.getByTestId('toast-action')).toBeVisible({ timeout: 30_000 });
      const restarted = (await terminals(page)).find((t) => t.kind === 'dev');
      expect(restarted?.id).toBe(dev.id);
      expect(restarted?.pid).not.toBe(dev.pid);
      expect(await lines(page, dev.id)).toContain('restarting');
      await expect
        .poll(() =>
          fetch(url)
            .then((r) => r.ok)
            .catch(() => false),
        )
        .toBe(true);

      await page.getByTestId('devserver-stop').click();
      await expect.poll(async () => (await terminals(page)).find((t) => t.kind === 'dev')?.exitCode).not.toBeNull();
      await expect
        .poll(
          () =>
            fetch(url)
              .then(() => 'up')
              .catch(() => 'down'),
          { timeout: 10_000 },
        )
        .toBe('down');
    } finally {
      await app.close();
      rmSync(join(PLAIN_HTML, '.arbora'), { recursive: true, force: true });
    }
  });

  test('tabs, splits, search and clipboard', async () => {
    const { app, page } = await launch(tempUserData(), [VITE_REACT]);
    try {
      await showRight(page, 'terminal');
      await expect.poll(async () => (await terminals(page)).length).toBe(1);
      const textarea = page.locator('[data-testid="terminal-pane"][data-active="true"] textarea').first();
      await expect(textarea).toBeFocused();

      await page.getByTestId('terminal-new').click();
      await expect(page.getByTestId('terminal-tab')).toHaveCount(2);
      await page.getByTestId('terminal-split').click();
      await expect(page.getByTestId('terminal-tab')).toHaveCount(2);
      await expect(page.getByTestId('terminal-pane')).toHaveCount(2);
      expect(await terminals(page)).toHaveLength(3);

      await runInTerminal(page, 'echo arbora-find-me');
      const active = await page
        .locator('[data-testid="terminal-pane"][data-active="true"]')
        .getAttribute('data-terminal-id');
      if (!active) throw new Error('no active pane');
      await expect.poll(() => lines(page, active)).toContain('arbora-find-me');

      // Find selects the match; copy puts it on the clipboard.
      await page.getByRole('button', { name: 'Find in Terminal' }).click();
      const search = page.getByTestId('terminal-search-input');
      await expect(search).toBeFocused();
      await search.fill('arbora-find-me');
      await search.press('Enter');
      await search.press('Escape');
      await expect(page.getByTestId('terminal-search')).toBeHidden();
      // Plain Ctrl+C/V are what Omarchy's Super+C/V send; Ctrl+C copies only while text is selected.
      await page.keyboard.press(isMac ? 'Meta+C' : 'Control+C');
      await expect.poll(() => page.evaluate(() => window.arbora.invoke('clipboard.readText'))).toBe('arbora-find-me');

      await page.evaluate(() => window.arbora.invoke('clipboard.writeText', { text: 'echo pasted-$((40+2))' }));
      await focusTerminal(page);
      await page.keyboard.press(isMac ? 'Meta+V' : 'Control+V');
      await page.keyboard.press('Enter');
      if (process.platform !== 'win32') await expect.poll(() => lines(page, active)).toContain('pasted-42');

      // Closing the split leaves the other pane; closing a tab removes its terminal.
      await page.evaluate((id) => window.arbora.invoke('terminal.close', { id }), active);
      await expect(page.getByTestId('terminal-pane')).toHaveCount(1);
      await page.getByTestId('terminal-tab').first().hover();
      await page.getByTestId('terminal-tab-close').first().click();
      await expect(page.getByTestId('terminal-tab')).toHaveCount(1);
      expect(await terminals(page)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
