import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { NavigationState } from '@arbora/shared';
import { DESKTOP_ROOT, FIXTURES, launch, tempUserData } from './app';
import { freePort, startViteFixture, type RunningServer } from './servers';

const FAKE_AGENT = resolve(DESKTOP_ROOT, '../../packages/acp-client/src/testing/fake-agent.ts');
const HTTP_ID = 'fake';
const STDIO_ID = 'fake-stdio';
const VITE_REACT = join(FIXTURES, 'vite-react');
const COUNTER = '[data-testid="card-counter"]';

/** Two fake agents: one with HTTP MCP, one that only takes stdio servers (so Arbora uses its shim). */
function userDataWithFakeAgents(): string {
  const userData = tempUserData();
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      version: 3,
      agents: {
        custom: [
          { id: HTTP_ID, name: 'Fake agent', command: process.execPath, args: [FAKE_AGENT], env: {} },
          {
            id: STDIO_ID,
            name: 'Fake agent (stdio MCP)',
            command: process.execPath,
            args: [FAKE_AGENT],
            env: { FAKE_AGENT_NO_HTTP_MCP: '1' },
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

async function newThread(page: Page, agentId: string): Promise<void> {
  await page.getByTestId('new-thread').click();
  await page.getByTestId(`pick-agent-${agentId}`).click();
  await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', { timeout: 30_000 });
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

test.describe('Stage 5 browser tools (MCP)', () => {
  let vite: RunningServer;

  test.beforeAll(async () => {
    vite = await startViteFixture();
  });

  test.afterAll(async () => {
    await vite.close();
  });

  test('a fake agent snapshots, clicks the counter and screenshots over HTTP MCP', async () => {
    const { app, page } = await launch(userDataWithFakeAgents(), [VITE_REACT]);
    try {
      await openFixture(app, page, vite.url);
      await newThread(page, HTTP_ID);
      await send(page, 'browser check');
      const reply = page.getByTestId('agent-message').last();
      await expect(reply).toContainText('Screenshot images: 1', { timeout: 30_000 });
      await expect(reply).toContainText('Before: Clicked 0 times');
      await expect(reply).toContainText(/After clicking e\d+: Clicked 1 times/);
      // The click was real input in the panel's page, and the screenshot is mirrored as a thumbnail.
      expect(await inPage<string>(app, `document.querySelector(${JSON.stringify(COUNTER)}).textContent`)).toContain(
        'Clicked 1 times',
      );
      await expect(page.getByTestId('browser-preview')).toBeVisible();
      await expect(page.getByTestId('tool-call').filter({ hasText: 'browser_click' })).toBeVisible();
      // No "tools not loaded" warning, and the guide the preface points at exists.
      await expect(page.getByTestId('notice')).toHaveCount(0);
      const skill = join(VITE_REACT, '.arbora/SKILL.md');
      expect(existsSync(skill)).toBe(true);
      expect(readFileSync(skill, 'utf8')).toContain('browser_snapshot');

      // browser_evaluate asks first; the answer is shown on the card.
      await send(page, 'evaluate');
      const card = page.getByTestId('permission-card').last();
      await expect(card).toContainText('Run JavaScript in the page', { timeout: 20_000 });
      await expect(card.getByTestId('permission-allow_always')).toBeVisible();
      await card.getByTestId('permission-allow_once').click();
      await expect(page.getByTestId('agent-message').last()).toContainText('Page title: "', { timeout: 20_000 });
      await deleteThreads(page);
    } finally {
      await app.close();
    }
  });

  test('every tool works against the real page, dev server and terminal', async () => {
    const { app, page } = await launch(userDataWithFakeAgents(), [VITE_REACT]);
    try {
      await openFixture(app, page, vite.url);
      await newThread(page, HTTP_ID);
      await send(page, 'tool sweep');
      // terminal_run asks first.
      const card = page.getByTestId('permission-card').last();
      await expect(card).toContainText('Run terminal commands', { timeout: 60_000 });
      await card.getByTestId('permission-allow_once').click();
      await expect(page.getByTestId('agent-message').last()).toContainText('Sweep results', { timeout: 60_000 });
      // The raw text: the transcript renders Markdown, which joins single newlines.
      const text = await page.evaluate(async () => {
        const [thread] = await window.arbora.invoke('agent.listThreads');
        const events = (await window.arbora.invoke('agent.getThread', { threadId: thread?.id ?? '' }))?.events ?? [];
        return events
          .flatMap((e) => (e.kind === 'agent_message' ? e.blocks : []))
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join('');
      });
      const lines = new Map(
        text
          .slice(text.indexOf('Sweep results'))
          .split('\n')
          .map((line) => /^([a-z ]+): (.*)$/.exec(line.trim()))
          .filter((m): m is RegExpExecArray => m !== null)
          .map((m) => [m[1] ?? '', m[2] ?? '']),
      );
      const expected: Record<string, RegExp> = {
        url: /^ok Page URL: http:\/\/127\.0\.0\.1/,
        snapshot: /^ok button "Log error"/,
        'click log error': /^ok/,
        console: /^ok fixture: intentional error/,
        'click missing api': /^ok/,
        'network idle': /^ok/,
        network: /^ok \[404\].*missing\.json/,
        source: /^ok Card\.tsx/,
        type: /^ok/,
        select: /^ok/,
        echo: /^ok/,
        key: /^ok/,
        hover: /^ok/,
        'element shot': /^ok element screenshot images=1/,
        'full shot': /^ok full screenshot images=1/,
        scroll: /^ok y=\d+/,
        'viewport size': /^ok 500×700/,
        'viewport preset': /^ok Responsive/,
        navigate: /^ok .*sweep=1/,
        back: /^ok Page URL/,
        forward: /^ok .*sweep=1/,
        reload: /^ok .*sweep=1/,
        'snapshot again': /^ok Hello, nobody/,
        'stale ref': /^ERROR Unknown ref e9999/,
        devserver: /^ok "running"/,
        terminal: /^ok sweep-ok/,
      };
      for (const [label, pattern] of Object.entries(expected)) {
        expect(lines.get(label), `${label} in:\n${[...lines].join('\n')}`).toMatch(pattern);
      }
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
      await page.getByTestId('devserver-run').click();
      await expect
        .poll(async () => (await browserState(page))?.url, { timeout: 30_000 })
        .toBe(`http://127.0.0.1:${first}/`);
      await newThread(page, HTTP_ID);
      await send(page, 'restart dev');
      // terminal_run asks; "Always allow in this project" is written to .arbora/project.json.
      const card = page.getByTestId('permission-card').last();
      await expect(card).toContainText('Run terminal commands', { timeout: 60_000 });
      await card.getByTestId('permission-allow_always').click();
      const reply = page.getByTestId('agent-message').last();
      await expect(reply).toContainText('restart-ok', { timeout: 60_000 });
      await expect(reply).toContainText(`Page URL: http://127.0.0.1:${second}/`);
      await expect(reply).toContainText('"running": true');
      await expect(reply).toContainText(`Local:   http://127.0.0.1:${second}/`);
      expect((await browserState(page))?.title).toBe(`dev ${second}`);
      const settings = JSON.parse(readFileSync(join(project, '.arbora/project.json'), 'utf8')) as unknown;
      expect(settings).toMatchObject({ devCommand: 'node server.mjs', browserTools: { terminalRun: 'allow' } });
      // A new thread (a new agent session) runs commands without asking again.
      await page.getByTestId('show-threads').click();
      await newThread(page, HTTP_ID);
      await send(page, 'restart dev');
      await expect(page.getByTestId('agent-message').last()).toContainText('restart-ok', { timeout: 60_000 });
      await expect(page.getByTestId('permission-card')).toHaveCount(0);
      await deleteThreads(page);
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  test('an agent without HTTP MCP reaches the same tools through the stdio shim', async () => {
    const { app, page } = await launch(userDataWithFakeAgents(), [VITE_REACT]);
    try {
      await openFixture(app, page, vite.url);
      await newThread(page, STDIO_ID);
      await send(page, 'browser check');
      const reply = page.getByTestId('agent-message').last();
      await expect(reply).toContainText(/After clicking e\d+: Clicked 1 times/, { timeout: 30_000 });
      const threads = await page.evaluate(() => window.arbora.invoke('agent.listThreads'));
      const threadId = threads[0]?.id ?? '';
      const log = await page.evaluate((id) => window.arbora.invoke('agent.getLog', { threadId: id }), threadId);
      expect(log.some((e) => e.direction === 'info' && e.message === 'browser tools attached over stdio shim')).toBe(
        true,
      );
      // The token travels in the shim's env, which the log viewer redacts.
      expect(JSON.stringify(log)).toContain('"name":"ARBORA_MCP_TOKEN","value":"[redacted]"');
      await deleteThreads(page);
    } finally {
      await app.close();
    }
  });
});
