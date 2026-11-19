import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { NavigationState } from '@arbora/shared';
import { checkedAgents, DESKTOP_ROOT, FIXTURES, launch, showRight, startAgent, tempUserData } from './app';
import { freePort, startViteFixture, type RunningServer } from './servers';

const FAKE_AGENT = resolve(DESKTOP_ROOT, 'e2e/fake-terminal-agent.mjs');
const HTTP_ID = 'fake';
const VITE_REACT = join(FIXTURES, 'vite-react');
const COUNTER = '[data-testid="card-counter"]';

/** One fake terminal agent; its MCP client reaches the server through the env the preface names. */
function userDataWithFakeAgents(): string {
  const userData = tempUserData();
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      version: 3,
      agents: {
        custom: [{ id: HTTP_ID, name: 'Fake agent', command: process.execPath, args: [FAKE_AGENT], env: {} }],
        ...checkedAgents([HTTP_ID]),
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

async function openFixture(app: ElectronApplication, page: Page, url: string): Promise<void> {
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
  await expect
    .poll(
      () =>
        inPage<boolean>(
          app,
          `(() => { const el = document.querySelector(${JSON.stringify(`${COUNTER} button`)}); return !!el && Object.keys(el).some((k) => k.startsWith('__reactFiber')); })()`,
        ),
      { timeout: 60_000 },
    )
    .toBe(true);
}

/** The agent terminal's raw scrollback, which is what the pane shows. */
function scrollback(page: Page, threadId: string): Promise<string> {
  return page.evaluate(async (id): Promise<string> => {
    const thread = (await window.arbora.invoke('agent.listThreads')).find((t) => t.id === id);
    const terminalId = thread?.state.terminalId;
    if (!terminalId) return '';
    const response = await window.arbora.invoke('terminal.scrollback', { id: terminalId });
    return typeof response === 'string' ? response : response.data;
  }, threadId);
}

async function send(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('composer-input');
  await input.fill(text);
  await input.press('Enter');
}

async function deleteThreads(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (const thread of await window.arbora.invoke('agent.listThreads')) {
      await window.arbora.invoke('agent.deleteThread', { threadId: thread.id });
    }
  });
}

test.describe('browser tools (MCP from a terminal agent)', () => {
  let vite: RunningServer;

  test.beforeAll(async () => {
    vite = await startViteFixture();
  });

  test.afterAll(async () => {
    await vite.close();
  });

  test('a terminal agent snapshots, clicks the counter and screenshots through the env MCP', async () => {
    const { app, page } = await launch(userDataWithFakeAgents(), [VITE_REACT]);
    try {
      await openFixture(app, page, vite.url);
      await startAgent(page, HTTP_ID);
      const [thread] = await page.evaluate(() => window.arbora.invoke('agent.listThreads'));
      const id = thread?.id ?? '';
      await send(page, 'browser check');
      await expect.poll(async () => scrollback(page, id), { timeout: 30_000 }).toContain('browser check done');
      // The click was real input in the panel's page.
      expect(await inPage<string>(app, `document.querySelector(${JSON.stringify(COUNTER)}).textContent`)).toContain(
        'Clicked 1 times',
      );
      // The guide the preface points at exists and names the env vars.
      const skill = join(VITE_REACT, '.arbora/SKILL.md');
      await expect.poll(() => existsSync(skill)).toBe(true);
      expect(readFileSync(skill, 'utf8')).toContain('ARBORA_MCP_URL');
      await deleteThreads(page);
    } finally {
      await app.close();
    }
  });

  test('every guarded tool asks first, and the standing answers persist in the project', async () => {
    // A previous run's standing answer would skip the card; start from the default (ask).
    const projectJson = join(VITE_REACT, '.arbora/project.json');
    if (existsSync(projectJson)) {
      const saved = JSON.parse(readFileSync(projectJson, 'utf8')) as Record<string, unknown>;
      delete saved['browserTools'];
      writeFileSync(projectJson, JSON.stringify(saved, null, 2));
    }
    const { app, page } = await launch(userDataWithFakeAgents(), [VITE_REACT]);
    try {
      await openFixture(app, page, vite.url);
      await startAgent(page, HTTP_ID);
      const [thread] = await page.evaluate(() => window.arbora.invoke('agent.listThreads'));
      const id = thread?.id ?? '';
      const pane = page.getByTestId('grove-pane');

      // browser_evaluate asks once.
      await send(page, 'mcp browser_evaluate {"expression":"document.title"}');
      const card = pane.getByTestId('confirmation-card');
      await expect(card).toContainText('Run JavaScript in the page', { timeout: 20_000 });
      await expect(page.getByTestId('attention-badge')).toHaveText('1');
      await card.getByTestId('confirmation-allow').click();
      await expect.poll(async () => scrollback(page, id), { timeout: 20_000 }).toContain('mcp browser_evaluate ok:');
      await expect(page.getByTestId('attention-badge')).toHaveCount(0);
      // The turn ends after its quiet window; the composer only takes a prompt once it has.
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', {
        timeout: 20_000,
      });

      // terminal_run asks, and "Always allow" is written to .arbora/project.json.
      await send(page, 'mcp terminal_run {"command":"echo sweep-ok"}');
      await expect(card).toContainText('Run terminal commands', { timeout: 20_000 });
      await card.getByTestId('confirmation-allow-always').click();
      await expect.poll(async () => scrollback(page, id), { timeout: 20_000 }).toContain('mcp terminal_run ok:');
      await expect
        .poll(() => JSON.parse(readFileSync(join(VITE_REACT, '.arbora/project.json'), 'utf8')) as unknown)
        .toMatchObject({ browserTools: { terminalRun: 'allow' } });
      await deleteThreads(page);
    } finally {
      await app.close();
    }
  });

  test('the read-only tools report on the real page, dev server and tabs in one sweep', async () => {
    const { app, page } = await launch(userDataWithFakeAgents(), [VITE_REACT]);
    try {
      await openFixture(app, page, vite.url);
      await startAgent(page, HTTP_ID);
      const [thread] = await page.evaluate(() => window.arbora.invoke('agent.listThreads'));
      const id = thread?.id ?? '';
      // One paste, one turn: the fake agent runs every line in order.
      await send(
        page,
        [
          'mcp browser_get_url {}',
          'mcp browser_snapshot {}',
          'mcp browser_console_logs {"level":"error"}',
          'mcp browser_network_errors {}',
          'mcp browser_get_element_source {"selector":"[data-testid=card-counter]"}',
          'mcp browser_set_viewport {"width":500,"height":700}',
          'mcp browser_screenshot {"mode":"viewport"}',
          'mcp devserver_status {}',
          'run all',
        ].join('\n'),
      );
      await expect.poll(async () => scrollback(page, id), { timeout: 60_000 }).toContain('mcp devserver_status ok:');
      const scroll = await scrollback(page, id);
      expect(scroll).toContain('mcp browser_get_url ok: Page URL:');
      expect(scroll).toContain('mcp browser_snapshot ok:');
      expect(scroll).toContain('mcp browser_console_logs ok:');
      expect(scroll).toContain('mcp browser_network_errors ok:');
      expect(scroll).toContain('mcp devserver_status ok:');
      expect(scroll).not.toMatch(/mcp \S+ failed/);
      await deleteThreads(page);
    } finally {
      await app.close();
    }
  });

  test('devserver_restart brings the server back on its new port and the browser follows', async () => {
    // A dev server that, like Vite with a busy port, comes back on another port after a restart.
    const project = mkdtempSync(join(tmpdir(), 'arbora-mcp-dev-'));
    const [first, second] = [await freePort(), await freePort()];
    writeFileSync(
      join(project, 'server.mjs'),
      `import { existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
const again = existsSync('.ran');
writeFileSync('.ran', '1');
const port = again ? ${second} : ${first};
createServer((req, res) => res.end('<title>dev ' + port + '</title><h1>port ' + port + '</h1>')).listen(port, '127.0.0.1', () =>
  console.log('  Local:   http://127.0.0.1:' + port + '/'),
);
`,
    );
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'dev-restart', private: true }));
    mkdirSync(join(project, '.arbora'));
    writeFileSync(join(project, '.arbora/project.json'), JSON.stringify({ version: 1, devCommand: 'node server.mjs' }));
    const { app, page } = await launch(userDataWithFakeAgents(), [project]);
    try {
      await showRight(page, 'terminal');
      await page.getByTestId('devserver-run').click();
      await expect
        .poll(async () => (await browserState(page))?.url, { timeout: 30_000 })
        .toBe(`http://127.0.0.1:${first}/`);
      await startAgent(page, HTTP_ID);
      const [thread] = await page.evaluate(() => window.arbora.invoke('agent.listThreads'));
      const id = thread?.id ?? '';
      await send(page, 'mcp devserver_restart {}');
      await expect.poll(async () => scrollback(page, id), { timeout: 60_000 }).toContain('mcp devserver_restart ok:');
      await expect
        .poll(async () => (await browserState(page))?.url, { timeout: 30_000 })
        .toBe(`http://127.0.0.1:${second}/`);
      await expect.poll(async () => (await browserState(page))?.title, { timeout: 30_000 }).toBe(`dev ${second}`);
      await deleteThreads(page);
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });
});
