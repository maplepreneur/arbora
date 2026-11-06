import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launch, tempUserData } from './app';

const MAP = JSON.stringify({
  version: 3,
  file: 'app.js',
  sources: ['../src/App.tsx'],
  names: [],
  mappings: 'AAAA',
});

const SCRIPT = 'function Button(){return null;}\n//# sourceMappingURL=app.js.map\n';

function pageHtml(): string {
  return `<!doctype html>
<button id="go" style="width:120px;height:40px">Go</button>
<script src="/assets/app.js"></script>
<script>
  const button = document.getElementById('go');
  const url = location.origin + '/assets/app.js';
  function Button() {}
  button.__reactFiber$e2e = {
    tag: 0,
    type: Button,
    return: null,
    child: null,
    sibling: null,
    stateNode: button,
    _debugStack: { stack: 'Error: react-stack-top-frame\\n    at Button (' + url + ':1:1)' },
  };
</script>`;
}

function serve(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const path = request.url?.split('?')[0];
    if (path === '/assets/app.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(SCRIPT);
      return;
    }
    if (path === '/assets/app.js.map') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(MAP);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(pageHtml());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('No port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'arbora-source-map-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{ "name": "source-map-fixture" }\n');
  writeFileSync(join(root, 'src/App.tsx'), 'export function App() { return null; }\n');
  return root;
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

test('agent mode maps a production bundle back to the project file', async () => {
  const root = project();
  const site = await serve();
  const { app, page } = await launch(tempUserData(), [root]);
  try {
    await openAndWait(page, site.url);
    await page.getByTestId('browser-toolbar').click({ position: { x: 2, y: 2 } });
    await page.keyboard.press('ControlOrMeta+K');
    await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-phase', 'inspecting');
    await expect.poll(() => inPage<boolean>(app, '!!document.querySelector("[data-arbora-overlay]")')).toBe(true);
    await clickInPage(app, '#go');
    await expect(page.getByTestId('agent-mode-popover')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('agent-mode-source')).toHaveText('src/App.tsx:1');
  } finally {
    await app.close();
    await site.close();
  }
});

async function openAndWait(page: Page, url: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.arbora.invoke('browser.getState'))).not.toBeNull();
  const input = page.getByTestId('url-input');
  await input.click();
  await input.fill(url);
  await input.press('Enter');
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => window.arbora.invoke('browser.getState'));
        return Boolean(state?.url.startsWith(url) && !state.loading && state.pageReady);
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

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
      page.focus();
      page.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
      page.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      page.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    },
    { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) },
  );
}
