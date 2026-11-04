import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { AppSettings, NavigationState, TerminalInfo, ThreadSummary } from '@arbora/shared';
import { checkedAgents, DESKTOP_ROOT, launch, switchWorkspace, tempUserData } from './app';
import { freePort } from './servers';

const FAKE_AGENT = resolve(DESKTOP_ROOT, '../../packages/acp-client/src/testing/fake-agent.ts');
const FAKE_ID = 'fake';
const isMac = process.platform === 'darwin';
const MOD = isMac ? 'meta' : 'control';

function userDataWithFakeAgent(): string {
  const userData = tempUserData();
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      version: 3,
      agents: {
        custom: [{ id: FAKE_ID, name: 'Fake agent', command: process.execPath, args: [FAKE_AGENT], env: {} }],
        permissions: {},
        ...checkedAgents([FAKE_ID]),
      },
    }),
  );
  return userData;
}

/** A throwaway project with one file for the fake agent to edit, and optional `.arbora/project.json` fields. */
function tempProject(settings?: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbora-grove-project-'));
  writeFileSync(join(dir, 'App.tsx'), 'export const App = () => null;\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'grove-fixture', private: true }));
  if (settings) {
    mkdirSync(join(dir, '.arbora'));
    writeFileSync(join(dir, '.arbora/project.json'), JSON.stringify({ version: 1, ...settings }));
  }
  return dir;
}

/** A dev server whose page has the counter "browser check" clicks; it prints every request path. */
function devServerSource(port: number): string {
  const page = `<!doctype html><title>Grove fixture</title>
<button type="button" id="increment">Increment</button>
<p id="count">Clicked 0 times</p>
<script>
  let clicks = 0;
  document.getElementById('increment').addEventListener('click', () => {
    clicks += 1;
    document.getElementById('count').textContent = 'Clicked ' + clicks + ' times';
  });
</script>`;
  return `import { createServer } from 'node:http';
const page = ${JSON.stringify(page)};
createServer((req, res) => {
  console.log('request ' + req.url);
  if (req.url !== '/') {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(page);
}).listen(${port}, '127.0.0.1', () => console.log('  Local:   http://127.0.0.1:${port}/'));
`;
}

function projectFile(project: string): object {
  return JSON.parse(readFileSync(join(project, '.arbora/project.json'), 'utf8')) as object;
}

function savedSettings(userData: string): AppSettings {
  return JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as AppSettings;
}

function threads(page: Page): Promise<ThreadSummary[]> {
  return page.evaluate(() => window.arbora.invoke('agent.listThreads'));
}

function terminals(page: Page): Promise<TerminalInfo[]> {
  return page.evaluate(() => window.arbora.invoke('terminal.list'));
}

function lines(page: Page, id: string): Promise<string> {
  return page
    .evaluate((terminalId) => window.arbora.invoke('terminal.lines', { id: terminalId }), id)
    .then((l) => l.join('\n'));
}

function browserState(page: Page): Promise<NavigationState | null> {
  return page.evaluate(() => window.arbora.invoke('browser.getState'));
}

function viewVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.contentView.children[0]?.getVisible() ?? false,
  );
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

/** Native key input to the embedded page, which main's `before-input-event` sees first. */
function keyInPage(app: ElectronApplication, keyCode: string, modifiers: string[]): Promise<void> {
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

/** Native key input to the app window, through main's interceptor (Playwright's keys skip it). */
function keyInWindow(app: ElectronApplication, keyCode: string, modifiers: string[]): Promise<void> {
  return app.evaluate(
    ({ BrowserWindow }, input) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      if (!contents) throw new Error('No app window');
      contents.focus();
      contents.sendInputEvent({ type: 'keyDown', keyCode: input.keyCode, modifiers: input.modifiers as ['control'] });
      contents.sendInputEvent({ type: 'keyUp', keyCode: input.keyCode, modifiers: input.modifiers as ['control'] });
    },
    { keyCode, modifiers },
  );
}

/** Xvfb has no window manager, so the window is not focused unless asked. */
async function focusWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
}

async function deleteThreads(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (const thread of await window.arbora.invoke('agent.listThreads')) {
      await window.arbora.invoke('agent.deleteThread', { threadId: thread.id });
    }
  });
}

test.describe('Stage 10 Grove', () => {
  test('swaps the whole window without reloading the page or stopping the dev server, and auto-starts once', async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    const project = tempProject({ devCommand: 'node server.mjs', defaultAgent: FAKE_ID });
    writeFileSync(join(project, 'server.mjs'), devServerSource(port));
    const { app, page } = await launch(userDataWithFakeAgent(), [project]);
    try {
      await page.getByTestId('devserver-run').click();
      await expect.poll(async () => (await browserState(page))?.url, { timeout: 30_000 }).toBe(url);
      await expect.poll(async () => (await browserState(page))?.pageReady, { timeout: 30_000 }).toBe(true);
      await inPage(app, 'window.groveMarker = 42');
      const dev = (await terminals(page)).find((t) => t.kind === 'dev');
      if (!dev?.pid) throw new Error('dev server not running');

      await expect(page.getByTestId('workspace-switch')).toHaveAttribute('data-workspace', 'browser');
      await switchWorkspace(page, 'grove');
      await expect(page.getByTestId('grove')).toBeVisible();
      await expect(page.getByTestId('workspace')).toHaveCount(0);
      await expect(page.getByTestId('workspace-switch')).toHaveAttribute('data-workspace', 'grove');
      await expect.poll(() => viewVisible(app)).toBe(false);

      // An empty Grove starts the project's default agent once, selects it and focuses its composer.
      const row = page.getByTestId('grove-row');
      await expect(row).toHaveCount(1, { timeout: 20_000 });
      await expect(row).toHaveAttribute('data-status', 'idle', { timeout: 20_000 });
      const pane = page.getByTestId('grove-pane');
      const composer = pane.getByTestId('composer-input');
      await expect(composer).toBeFocused();
      await expect(composer).toHaveAttribute('placeholder', /^Ask Fake agent…/);

      // The dev server keeps printing while Grove is up.
      expect((await fetch(`${url}while-grove`)).status).toBe(404);
      await expect.poll(() => lines(page, dev.id)).toContain('request /while-grove');

      // The parked page still answers the agent's browser tools, screenshots included.
      await composer.fill('browser check');
      await composer.press('Enter');
      const reply = pane.getByTestId('agent-message').last();
      await expect(reply).toContainText('Screenshot images: 1', { timeout: 30_000 });
      await expect(reply).toContainText(/After clicking e\d+: Clicked 1 times/);
      expect(await viewVisible(app)).toBe(false);

      // Inside Grove, Mod+Shift+K searches. Mod+K leaves for agent mode on this project.
      await page.keyboard.press('ControlOrMeta+Shift+K');
      await expect(page.getByTestId('grove-search')).toBeVisible();
      await expect(page.getByTestId('grove')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('grove-search')).toHaveCount(0);

      await page.keyboard.press('ControlOrMeta+K');
      await expect(page.getByTestId('workspace')).toBeVisible();
      await expect(page.getByTestId('grove')).toHaveCount(0);
      await expect(page.getByTestId('mode-pills')).toHaveAttribute('data-mode', 'agent');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('mode-pills')).toHaveAttribute('data-mode', 'idle');
      await expect.poll(() => viewVisible(app)).toBe(true);
      // Same URL, same document (not reloaded), and the agent's click really happened on it.
      expect((await browserState(page))?.url).toBe(url);
      expect(await inPage<number>(app, 'window.groveMarker')).toBe(42);
      expect(await inPage<string>(app, "document.getElementById('count').textContent")).toBe('Clicked 1 times');

      // Main's interceptor knows the browser workspace is back: Mod+1 is panel focus again.
      await keyInWindow(app, '1', [MOD]);
      await expect(page.getByTestId('explorer-tree')).toBeFocused();

      // The toggle chord works from inside the page; coming back does not start a second agent.
      await keyInPage(app, 'G', [MOD, 'alt']);
      await expect(page.getByTestId('grove')).toBeVisible();
      await expect(page.getByTestId('grove-row')).toHaveCount(1);
      await switchWorkspace(page, 'browser');
      await expect(page.getByTestId('workspace')).toBeVisible();
      expect(await threads(page)).toHaveLength(1);

      // While the browser workspace shows, the Grove segment says an agent is working.
      const [session] = await threads(page);
      if (!session) throw new Error('no session');
      await page.evaluate((threadId) => {
        void window.arbora.invoke('agent.prompt', {
          threadId,
          blocks: [{ type: 'text', text: 'slow' }],
          attachments: [],
        });
      }, session.id);
      await expect(page.getByTestId('grove-activity')).toBeVisible();
      await page.evaluate((threadId) => window.arbora.invoke('agent.cancel', { threadId }), session.id);
      await expect(page.getByTestId('grove-activity')).toHaveCount(0, { timeout: 15_000 });

      // The same dev server process is running, and its xterm got the lines printed during the visit.
      const after = (await terminals(page)).find((t) => t.kind === 'dev');
      expect(after?.pid).toBe(dev.pid);
      expect(after?.exitCode).toBeNull();
      await page.locator('[data-testid="terminal-tab"][data-kind="dev"]').click();
      await page.getByRole('button', { name: 'Find in Terminal' }).click();
      const search = page.getByTestId('terminal-search-input');
      await search.fill('while-grove');
      await search.press('Enter');
      await search.press('Escape');
      await page.keyboard.press(isMac ? 'Meta+C' : 'Control+C');
      await expect.poll(() => page.evaluate(() => window.arbora.invoke('clipboard.readText'))).toBe('while-grove');
      await deleteThreads(page);
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  test('starts from the launcher, jumps with the row chords, shows who needs you, archives and restores', async () => {
    const project = tempProject();
    const { app, page } = await launch(userDataWithFakeAgent(), [project]);
    try {
      await focusWindow(app);
      await page.keyboard.press('ControlOrMeta+Alt+G');
      await expect(page.getByTestId('grove')).toBeVisible();
      // No default agent: nothing starts, and the empty state offers a choice.
      await expect(page.getByTestId('grove-empty')).toContainText('No agents running.');
      await expect(page.getByTestId('grove-empty-start')).toHaveCount(0);
      await expect(page.getByTestId('grove-default-agent')).toHaveText('none');
      await page.getByTestId('grove-empty-choose').click();

      const launcher = page.getByTestId('grove-launcher');
      await expect(launcher).toBeVisible();
      await expect(page.getByTestId(`launcher-agent-${FAKE_ID}`)).toHaveAttribute('data-active', 'true');
      const task = page.getByTestId('launcher-task');
      await expect(task).toBeFocused();
      await page.getByTestId('launcher-default').check();
      await task.fill('add a comment to `App.tsx`');
      await task.press('Enter');
      await expect(launcher).toHaveCount(0);

      const rows = page.getByTestId('grove-row');
      const first = rows.nth(0);
      await expect(rows).toHaveCount(1);
      await expect(first.getByTestId('grove-row-name')).toHaveText('add a comment to `App.tsx`');
      await expect.poll(() => projectFile(project)).toMatchObject({ defaultAgent: FAKE_ID });
      await expect(page.getByTestId('grove-default-agent')).toHaveText('Fake agent');

      // The task's edit asks first: the row says Needs you, the bell counts it, and the card is pinned once.
      await expect(first).toHaveAttribute('data-status', 'needsYou', { timeout: 20_000 });
      const pane = page.getByTestId('grove-pane');
      const pinned = pane.getByTestId('pinned-permissions');
      await expect(pinned.getByTestId('permission-card')).toBeVisible();
      await expect(pane.getByTestId('permission-card')).toHaveCount(1);
      await expect(page.getByTestId('attention-badge')).toHaveText('1');

      // With a default agent, Mod+Alt+N starts it at once.
      await page.keyboard.press('ControlOrMeta+Alt+N');
      await expect(rows).toHaveCount(2);
      const second = rows.nth(1);
      await expect(second.getByTestId('grove-row-name')).toHaveText('Fake agent');
      await expect(second).toHaveAttribute('aria-current', 'true');
      await expect(second).toHaveAttribute('data-status', 'idle', { timeout: 20_000 });
      const firstId = await first.getAttribute('data-thread-id');
      const secondId = await second.getAttribute('data-thread-id');
      if (!firstId || !secondId) throw new Error('rows without thread ids');

      await page.keyboard.press('ControlOrMeta+Alt+A');
      await expect(pane).toHaveAttribute('data-thread-id', firstId);
      await page.keyboard.press('ControlOrMeta+2');
      await expect(pane).toHaveAttribute('data-thread-id', secondId);
      await page.keyboard.press('ControlOrMeta+1');
      await expect(pane).toHaveAttribute('data-thread-id', firstId);
      await page.keyboard.press('ControlOrMeta+Alt+ArrowDown');
      await expect(pane).toHaveAttribute('data-thread-id', secondId);
      await page.keyboard.press('ControlOrMeta+Alt+ArrowDown');
      await expect(pane).toHaveAttribute('data-thread-id', firstId);
      // Main's interceptor uses the same Grove meaning for the row chords.
      await keyInWindow(app, '2', [MOD]);
      await expect(pane).toHaveAttribute('data-thread-id', secondId);
      await keyInWindow(app, '1', [MOD]);
      await expect(pane).toHaveAttribute('data-thread-id', firstId);

      // In the browser workspace the bell still counts it, and the jump opens the docked panel.
      await page.keyboard.press('ControlOrMeta+Alt+G');
      await expect(page.getByTestId('workspace')).toBeVisible();
      await expect(page.getByTestId('attention-badge')).toHaveText('1');
      await page.keyboard.press('ControlOrMeta+Alt+A');
      await expect(page.getByTestId('thread-view').getByTestId('user-message')).toContainText('add a comment to');
      await page.keyboard.press('ControlOrMeta+Alt+G');
      await expect(pane).toHaveAttribute('data-thread-id', firstId);

      await pinned.getByTestId('permission-allow_once').click();
      await expect(pane.getByTestId('pinned-permissions')).toHaveCount(0);
      await expect(pane.getByTestId('permission-outcome')).toContainText('Allow', { timeout: 20_000 });
      await expect(first.getByTestId('grove-row-stats')).toHaveText('+1 −0', { timeout: 20_000 });
      await focusWindow(app);
      await expect(page.getByTestId('attention-badge')).toHaveCount(0);
      await expect(first).toHaveAttribute('data-status', 'idle');

      await page.getByTestId('grove-tab-changes').click();
      const change = pane.getByTestId('grove-change');
      await expect(change).toHaveCount(1);
      await expect(change).toHaveAttribute('data-path', 'App.tsx');
      await change.getByRole('button', { expanded: false }).click();
      await expect(change.getByTestId('diff')).toContainText('Arbora fake agent was here');
      await page.getByTestId('grove-tab-transcript').click();

      // Archiving a live session asks first, then moves it to Recent and selects the next row.
      await page.keyboard.press('ControlOrMeta+W');
      const ask = page.getByTestId('toast').filter({ hasText: 'and archive it?' });
      await expect(ask).toBeVisible();
      await ask.getByTestId('toast-action').click();
      await expect(rows).toHaveCount(1);
      await expect(page.getByTestId('grove-recent-toggle')).toHaveText('Recent (1)');
      await expect(pane).toHaveAttribute('data-thread-id', secondId);
      await expect
        .poll(async () => (await threads(page)).find((t) => t.id === firstId)?.archivedAt ?? null)
        .not.toBeNull();

      // The docked thread list hides it too.
      await switchWorkspace(page, 'browser');
      await expect(page.getByTestId('thread-row')).toHaveCount(1);
      await expect(page.getByTestId('thread-row')).toHaveAttribute('data-thread-id', secondId);

      // Recent shows it read-only; Restore brings it back to the list.
      await switchWorkspace(page, 'grove');
      await page.getByTestId('grove-recent-toggle').click();
      await page.getByTestId('grove-recent-row').click();
      await expect(pane).toHaveAttribute('data-thread-id', firstId);
      await expect(page.getByTestId('grove-archived')).toBeVisible();
      await expect(pane.getByTestId('composer-input')).toHaveCount(0);
      await page.getByTestId('grove-restore').click();
      await expect(rows).toHaveCount(2);
      await expect(page.getByTestId('grove-recent')).toHaveCount(0);
      await expect(page.getByTestId('grove-archived')).toHaveCount(0);

      // A tile narrower than the window's minimum turns the list into a rail; widening restores it.
      const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getSize() ?? [0, 0]);
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.setMinimumSize(320, 320);
        win?.setSize(480, 720);
      });
      await expect(page.getByTestId('grove')).toHaveAttribute('data-narrow', 'true');
      await expect(page.getByTestId('grove-sessions')).toHaveCount(0);
      const rail = page.getByTestId('grove-rail-row');
      await expect(rail).toHaveCount(2);
      await rail.nth(1).click();
      await expect(pane).toHaveAttribute('data-thread-id', secondId);
      await app.evaluate(({ BrowserWindow }, [width, height]) => {
        BrowserWindow.getAllWindows()[0]?.setSize(width ?? 1280, height ?? 800);
      }, size);
      await expect(page.getByTestId('grove-sessions')).toBeVisible();
      await expect
        .poll(async () => (await page.getByTestId('grove-list').boundingBox())?.width ?? 0)
        .toBeGreaterThan(150);
      await deleteThreads(page);
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  test('a lead agent starts a helper after one permission and reports its answer', async () => {
    const userData = userDataWithFakeAgent();
    const project = tempProject({ defaultAgent: FAKE_ID, startDefaultOnOpen: false });
    const { app, page } = await launch(userData, [project]);
    try {
      await page.keyboard.press('ControlOrMeta+Alt+G');
      // Start when empty is off: Grove offers the default agent and does not spawn it.
      await expect(page.getByTestId('grove-empty-start')).toHaveText('Start Fake agent');
      await expect(page.getByTestId('grove-empty-start-on-open')).not.toBeChecked();
      await page.waitForTimeout(500);
      expect(await threads(page)).toHaveLength(0);
      await page.getByTestId('grove-empty-start').click();
      const rows = page.getByTestId('grove-row');
      await expect(rows).toHaveCount(1);
      await expect(rows).toHaveAttribute('data-status', 'idle', { timeout: 20_000 });
      const leadId = await rows.getAttribute('data-thread-id');
      if (!leadId) throw new Error('no lead');

      // Settings opens in the pane while Grove shows, with a Grove section.
      await page.keyboard.press('ControlOrMeta+,');
      await expect(page.getByTestId('grove').getByTestId('settings-page')).toBeVisible();
      await page.getByTestId('settings-nav-grove').click();
      await expect(page.getByTestId('setting-grove-default-agent')).toHaveValue(FAKE_ID);
      await expect(page.getByTestId('setting-grove-start-on-open')).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByTestId('grove-chords')).toContainText(isMac ? '⌥⌘G' : 'Ctrl+Alt+G');
      await page.getByTestId('setting-grove-max-children').selectOption('2');
      await expect
        .poll(() => savedSettings(userData).grove)
        .toEqual({
          orchestration: true,
          maxChildren: 2,
          projects: [{ path: project, collapsed: false }],
          trustedCommands: [],
          launch: 'browser',
        });
      await page.getByTestId('settings-nav-general').click();
      await expect(page.getByTestId('setting-grove-launch')).toHaveValue('browser');
      await page.getByTestId('settings-nav-grove').click();
      await page.getByTestId('setting-grove-orchestration').click();
      await expect.poll(() => savedSettings(userData).grove.orchestration).toBe(false);
      await expect(page.getByTestId('setting-grove-max-children')).toBeDisabled();
      await page.getByTestId('setting-grove-orchestration').click();
      await expect.poll(() => savedSettings(userData).grove.orchestration).toBe(true);
      await page.getByTestId('settings-close').click();

      const pane = page.getByTestId('grove-pane');
      await expect(pane).toHaveAttribute('data-thread-id', leadId);
      await pane.getByTestId('composer-input').fill('grove delegate');
      await pane.getByTestId('composer-input').press('Enter');
      const card = pane.getByTestId('pinned-permissions').getByTestId('permission-card');
      await expect(card).toContainText('wants to start helper agents', { timeout: 20_000 });
      await card.getByTestId('permission-allow_once').click();

      const helper = page.locator('[data-testid="grove-row"][data-helper="true"]');
      await expect(helper).toHaveCount(1, { timeout: 20_000 });
      await expect(helper.getByTestId('grove-row-name')).toHaveText('say hello from the helper');
      await expect(pane.getByTestId('agent-message').last()).toContainText(
        'The helper said: "Working on: say hello from the helper',
        { timeout: 30_000 },
      );
      await expect(pane.getByTestId('permission-card')).toHaveCount(1);
      // The helper's finish was the lead's to read, so once the lead's own is seen the bell is clear.
      await focusWindow(app);
      await expect(page.getByTestId('attention-badge')).toHaveCount(0);
      await expect(helper).toHaveAttribute('data-status', 'idle');
      const helperId = await helper.getAttribute('data-thread-id');
      if (!helperId) throw new Error('no helper');
      expect(await rows.evaluateAll((all) => all.map((row) => row.getAttribute('data-thread-id')))).toEqual([
        leadId,
        helperId,
      ]);
      expect((await threads(page)).find((t) => t.id === helperId)?.parentThreadId).toBe(leadId);

      // The lead lists its helper; the helper links back to its lead.
      await pane.getByTestId('grove-helper-chip').click();
      await expect(pane).toHaveAttribute('data-thread-id', helperId);
      await expect(pane.getByTestId('grove-lead-link')).toContainText('Helper of grove delegate');
      await pane.getByTestId('grove-lead-link').click();
      await expect(pane).toHaveAttribute('data-thread-id', leadId);
      await deleteThreads(page);
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  test('lists detected commands and forgets a project only when it is closed', async () => {
    const project = tempProject({ startDefaultOnOpen: false, defaultAgent: FAKE_ID });
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify({
        name: 'grove-fixture',
        private: true,
        scripts: {
          dev: 'vite',
          build: 'vite build',
          preview: 'vite preview',
          format: 'prettier',
          pretest: 'echo no',
          generate: 'nuxt generate',
        },
      }),
    );
    writeFileSync(join(project, 'Procfile.dev'), 'web: npm run dev\nworker: php artisan queue:work\n');
    mkdirSync(join(project, 'bin'));
    mkdirSync(join(project, 'config'));
    writeFileSync(join(project, 'bin', 'rails'), '#!/bin/sh\n');
    writeFileSync(join(project, 'bin', 'dev'), '#!/bin/sh\n');
    writeFileSync(join(project, 'bin', 'jobs'), '#!/bin/sh\n');
    writeFileSync(join(project, 'config', 'application.rb'), 'module App\nend\n');
    const userData = userDataWithFakeAgent();
    const { app, page } = await launch(userData, [project]);
    try {
      await switchWorkspace(page, 'grove');
      await expect(page.getByTestId('grove')).toBeVisible();
      const before = (await terminals(page)).length;
      const added = await page.evaluate((path) => window.arbora.invoke('grove.addProject', { path }), project);
      expect(added.added).toBe(true);
      if (!added.path) throw new Error('project was not added');
      await expect(page.getByTestId('grove-project')).toHaveAttribute('data-path', added.path);
      for (const title of ['npm:dev', 'npm:build', 'npm:preview', 'npm:generate', 'Dev server', 'Jobs', 'web']) {
        await expect(page.getByTestId('grove-command').filter({ hasText: title }).first()).toBeVisible();
      }
      await expect(page.getByTestId('grove-command').filter({ hasText: 'format' })).toHaveCount(0);
      await expect(page.getByTestId('grove-command').filter({ hasText: 'pretest' })).toHaveCount(0);
      await expect(page.getByTestId('grove-commands')).toHaveAttribute('data-count', '0/11');
      expect(await terminals(page)).toHaveLength(before);
      await page.getByTestId('grove-close-project').click();
      const ask = page.getByTestId('toast').filter({ hasText: 'Close' });
      const projectRow = page.getByTestId('grove-project');
      if (await ask.isVisible().catch(() => false)) await ask.getByTestId('toast-action').click();
      await expect(projectRow).toHaveCount(0);
      await expect.poll(() => savedSettings(userData).grove.projects).toEqual([]);
      expect(savedSettings(userData).grove.launch).toBe('browser');
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });
});
