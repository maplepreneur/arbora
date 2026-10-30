import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { TerminalInfo } from '@arbora/shared';
import { checkedAgents, DESKTOP_ROOT, FIXTURES, launch, tempUserData } from './app';

const FAKE_AGENT = resolve(DESKTOP_ROOT, '../../packages/acp-client/src/testing/fake-agent.ts');
/** The repo's node_modules has Prettier, ESLint and TypeScript; the project links to it. */
const REPO_MODULES = resolve(DESKTOP_ROOT, '../../node_modules');

/** A copy of the vite-react fixture with Prettier and ESLint configs and a gitignored folder. */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbora-files-'));
  cpSync(join(FIXTURES, 'vite-react/src'), join(dir, 'src'), { recursive: true });
  cpSync(join(FIXTURES, 'vite-react/package.json'), join(dir, 'package.json'));
  symlinkSync(REPO_MODULES, join(dir, 'node_modules'), 'junction');
  writeFileSync(join(dir, '.prettierrc'), '{ "singleQuote": true, "printWidth": 100 }\n');
  writeFileSync(
    join(dir, 'eslint.config.mjs'),
    "export default [{ files: ['**/*.js'], rules: { 'no-debugger': 'error' } }];\n",
  );
  writeFileSync(join(dir, 'src/util.js'), 'export function util() {\n  return 1;\n}\n');
  writeFileSync(join(dir, '.gitignore'), 'generated/\n');
  mkdirSync(join(dir, 'generated'));
  writeFileSync(join(dir, 'generated/out.ts'), 'export const generated = true;\n');
  return dir;
}

function userData(): string {
  const dir = tempUserData();
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      version: 3,
      agents: {
        custom: [{ id: 'fake', name: 'Fake agent', command: process.execPath, args: [FAKE_AGENT], env: {} }],
        permissions: {},
        ...checkedAgents(['fake']),
      },
    }),
  );
  return dir;
}

const editor = (page: Page) => page.getByTestId('editor').locator('.cm-content');

async function openFromExplorer(page: Page, ...segments: string[]): Promise<void> {
  for (const path of segments) await page.locator(`[data-testid="explorer-row"][data-path="${path}"]`).click();
}

async function quickOpen(page: Page, query: string, path: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+p');
  await expect(page.getByTestId('quick-open')).toBeVisible();
  await page.getByTestId('quick-open-input').fill(query);
  await expect(page.getByTestId('quick-open-item').first()).toHaveAttribute('data-path', path);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-path', path);
}

async function runCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Shift+p');
  await page.getByTestId('command-palette').locator('input').fill(title);
  await page.keyboard.press('Enter');
}

test.describe('Stage 7 files and editor', () => {
  test('explorer, editing with Prettier on save, and ESLint diagnostics in the gutter and Problems', async () => {
    const dir = project();
    const { app, page } = await launch(userData(), [dir]);
    try {
      await expect(page.getByTestId('files-panel')).toBeVisible();
      const row = (path: string) => page.locator(`[data-testid="explorer-row"][data-path="${path}"]`);
      await expect(row('src')).toBeVisible();
      // Gitignored and always-ignored folders are listed but dimmed; .git never shows.
      await expect(row('generated')).toHaveClass(/text-fg-subtle/);
      await expect(row('node_modules')).toHaveClass(/text-fg-subtle/);
      await expect(row('src')).not.toHaveClass(/text-fg-subtle/);

      // Single click opens a preview tab; editing pins it.
      await openFromExplorer(page, 'src', 'src/App.tsx');
      await expect(page.getByTestId('editor')).toHaveAttribute('data-path', 'src/App.tsx');
      const tab = page.locator('[data-testid="editor-tab"][data-path="src/App.tsx"]');
      await expect(tab).toHaveAttribute('data-preview', 'true');
      await editor(page).click();
      await page.keyboard.press('ControlOrMeta+Home');
      await page.keyboard.type('const   greeting="hi"\n');
      await expect(tab).toHaveAttribute('data-dirty', 'true');
      await expect(tab).toHaveAttribute('data-preview', 'false');

      // Save runs the project's Prettier (single quotes from its .prettierrc) and writes to disk.
      await page.keyboard.press('ControlOrMeta+s');
      await expect(tab).toHaveAttribute('data-dirty', 'false');
      await expect.poll(() => readFileSync(join(dir, 'src/App.tsx'), 'utf8')).toMatch(/^const greeting = 'hi';\n/);
      await expect(editor(page)).toContainText("const greeting = 'hi';");

      // ESLint on save: a debugger statement in a .js file.
      await quickOpen(page, 'util', 'src/util.js');
      await editor(page).click();
      await page.keyboard.press('ControlOrMeta+Home');
      await page.keyboard.type('debugger;\n');
      await page.keyboard.press('ControlOrMeta+s');
      await expect(page.getByTestId('editor').locator('.cm-lint-marker-error')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('bottom-tab-problems').click();
      await page.getByTestId('problems-scope-code').click();
      const diagnostic = page.getByTestId('diagnostic-row').first();
      await expect(diagnostic).toHaveAttribute('data-source', 'eslint');
      await expect(diagnostic).toContainText('no-debugger');
      await expect(diagnostic.getByTestId('diagnostic-location')).toHaveText('src/util.js:1:1');

      // Format Document (Shift+Alt+F) formats without saving.
      await editor(page).click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type('\nconst   spaced=1');
      await page.keyboard.press('Shift+Alt+f');
      await expect(editor(page)).toContainText('const spaced = 1;');
      const utilTab = page.locator('[data-testid="editor-tab"][data-path="src/util.js"]');
      await expect(utilTab).toHaveAttribute('data-dirty', 'true');

      // With format on save off, Save writes the text as typed.
      await page.evaluate(() => window.arbora.invoke('settings.update', { editor: { formatOnSave: false } }));
      await page.keyboard.type('\nconst   raw=2');
      await page.keyboard.press('ControlOrMeta+s');
      await expect(utilTab).toHaveAttribute('data-dirty', 'false');
      expect(readFileSync(join(dir, 'src/util.js'), 'utf8')).toContain('const   raw=2');

      // Mod+W closes the active tab; App.tsx becomes active.
      await page.keyboard.press('ControlOrMeta+w');
      await expect(utilTab).toHaveCount(0);
      await expect(page.getByTestId('editor')).toHaveAttribute('data-path', 'src/App.tsx');

      // Show Browser (palette) and the browser tab bring the page back.
      await runCommand(page, 'Show Browser');
      await expect(page.getByTestId('editor')).toHaveCount(0);
      await expect(page.getByTestId('browser-panel')).toBeVisible();
      await page.locator('[data-testid="editor-tab"][data-path="src/App.tsx"]').click();
      await expect(page.getByTestId('editor')).toBeVisible();
      await page.getByTestId('editor-tab-browser').click();
      await expect(page.getByTestId('editor')).toHaveCount(0);
      await expect(page.getByTestId('browser-panel')).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test('quick open, project search and opening a match at its line', async () => {
    const dir = project();
    const { app, page } = await launch(userData(), [dir]);
    try {
      await page.keyboard.press('ControlOrMeta+p');
      await page.getByTestId('quick-open-input').fill('card');
      // Matching runs in the worker, not on the UI thread.
      await expect(page.getByTestId('quick-open')).toHaveAttribute('data-matcher', 'worker');
      await page.keyboard.press('Escape');
      await quickOpen(page, 'card', 'src/components/Card.tsx');
      // `path:line` jumps to the line.
      await page.keyboard.press('ControlOrMeta+p');
      await page.getByTestId('quick-open-input').fill('App.tsx:3');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('editor')).toHaveAttribute('data-path', 'src/App.tsx');
      await expect(page.getByTestId('editor').locator('.cm-lineNumbers .cm-activeLineGutter')).toHaveText('3');

      await page.getByTestId('rail-search').click();
      await page.getByTestId('search-input').fill('Counter');
      await expect(page.getByTestId('search-file').first()).toBeVisible();
      await expect(page.getByTestId('search-summary')).toContainText(/results? in \d+ files?/);
      // Gitignored files are not searched.
      await page.getByTestId('search-input').fill('generated = true');
      await expect(page.getByTestId('search-summary')).toContainText('0 results in 0 files');

      await page.getByTestId('search-input').fill('Counter');
      const match = page.getByTestId('search-match').first();
      await expect(match).toBeVisible();
      const path = await match.getAttribute('data-path');
      const line = await match.getAttribute('data-line');
      await match.click();
      await expect(page.getByTestId('editor')).toHaveAttribute('data-path', path ?? '');
      await expect(page.getByTestId('editor').locator('.cm-lineNumbers .cm-activeLineGutter')).toHaveText(line ?? '');
      await expect(page.getByTestId('editor').locator('.cm-activeLine')).toContainText('Counter');

      // Include globs narrow the search.
      await page.getByTestId('search-toggle-globs').click();
      await page.getByTestId('search-include').fill('src/components/**');
      await expect(page.getByTestId('search-summary')).toContainText(/results? in \d+ files?/);
      for (const file of await page.getByTestId('search-file').all()) {
        expect(await file.getAttribute('data-path')).toMatch(/^src\/components\//);
      }
    } finally {
      await app.close();
    }
  });

  test('external changes reload clean files, warn about dirty ones, and Compare with Saved shows a diff', async () => {
    const dir = project();
    const { app, page } = await launch(userData(), [dir]);
    try {
      await quickOpen(page, 'main.tsx', 'src/main.tsx');
      writeFileSync(join(dir, 'src/main.tsx'), '// changed on disk\n');
      await expect(editor(page)).toHaveText('// changed on disk', { timeout: 15_000 });

      await editor(page).click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type('const local = 1;');
      writeFileSync(join(dir, 'src/main.tsx'), '// changed again\n');
      await expect(page.getByTestId('editor-disk-changed')).toBeVisible({ timeout: 15_000 });

      // Compare the editor text with what the editor last saved or loaded.
      await runCommand(page, 'Compare with Saved');
      const viewer = page.getByTestId('diff-viewer');
      await expect(viewer).toBeVisible();
      await expect(viewer.locator('.cm-mergeView')).toHaveCount(1);
      await expect(viewer.locator('.cm-changedText').first()).toBeVisible();
      await page.getByTestId('diff-layout-unified').click();
      await expect(viewer).toHaveAttribute('data-layout', 'unified');
      await expect(viewer.locator('.cm-mergeView')).toHaveCount(0);
      await expect(viewer.locator('.cm-changedLine').first()).toBeVisible();

      await page.locator('[data-testid="editor-tab"][data-path="src/main.tsx"][data-kind="file"]').click();
      await page.getByTestId('editor-reload').click();
      await expect(editor(page)).toHaveText('// changed again');
      await expect(page.getByTestId('editor-disk-changed')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test('explorer creates and renames files, and images open as a preview', async () => {
    const dir = project();
    writeFileSync(
      join(dir, 'logo.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    const { app, page } = await launch(userData(), [dir]);
    try {
      await page.getByTestId('explorer-new-file').click();
      await page.getByTestId('explorer-name-input').fill('notes/todo.md');
      await page.keyboard.press('Enter');
      await expect.poll(() => existsSync(join(dir, 'notes/todo.md'))).toBe(true);
      await expect(page.getByTestId('editor')).toHaveAttribute('data-path', 'notes/todo.md');

      const row = page.locator('[data-testid="explorer-row"][data-path="notes/todo.md"]');
      await expect(row).toBeVisible();
      await row.click();
      await page.keyboard.press('F2');
      await page.getByTestId('explorer-name-input').fill('done.md');
      await page.keyboard.press('Enter');
      await expect.poll(() => existsSync(join(dir, 'notes/done.md'))).toBe(true);
      expect(existsSync(join(dir, 'notes/todo.md'))).toBe(false);
      await expect(page.locator('[data-testid="editor-tab"][data-path="notes/done.md"]')).toBeVisible();

      // A file created outside Arbora appears through the watcher.
      writeFileSync(join(dir, 'notes/external.md'), '# hi\n');
      await expect(page.locator('[data-testid="explorer-row"][data-path="notes/external.md"]')).toBeVisible({
        timeout: 15_000,
      });

      await page.locator('[data-testid="explorer-row"][data-path="logo.png"]').click();
      await expect(page.getByTestId('image-preview').locator('img')).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test('agent tool locations and terminal links open the editor at the line; agent edits open in the diff viewer', async () => {
    const dir = project();
    const { app, page } = await launch(userData(), [dir]);
    try {
      await page.getByTestId('new-thread-choose').click();
      await page.getByTestId('pick-agent-fake').click();
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', { timeout: 20_000 });
      const input = page.getByTestId('composer-input');
      await input.fill('add a comment to `src/App.tsx`');
      await input.press('Enter');
      const card = page.getByTestId('permission-card');
      await expect(card).toBeVisible({ timeout: 20_000 });
      await card.getByTestId('permission-allow_once').click();
      await expect(page.getByTestId('diff')).toBeVisible({ timeout: 20_000 });

      await page.getByTestId('tool-location').first().click();
      await expect(page.getByTestId('editor')).toHaveAttribute('data-path', 'src/App.tsx');
      await expect(page.getByTestId('editor').locator('.cm-lineNumbers .cm-activeLineGutter')).toHaveText('1');
      await expect(editor(page)).toContainText('Arbora fake agent was here');

      await page.getByTestId('diff-open').first().click();
      await expect(page.getByTestId('diff-viewer')).toBeVisible();
      await expect(page.getByTestId('diff-viewer').locator('.cm-changedLine, .cm-deletedChunk').first()).toBeVisible();

      // Terminal `path:line:col` links.
      await page.getByTestId('bottom-tab-terminal').click();
      await expect
        .poll(async () => (await page.evaluate(() => window.arbora.invoke('terminal.list'))).length, {
          timeout: 20_000,
        })
        .toBeGreaterThan(0);
      const [terminal] = await page.evaluate<TerminalInfo[]>(() => window.arbora.invoke('terminal.list'));
      await page.evaluate(
        (id) =>
          window.arbora.invoke('terminal.write', { id, data: "clear; printf 'src/components/Card.tsx:4:3\\n'\r" }),
        terminal?.id ?? '',
      );
      await expect
        .poll(() =>
          page.evaluate((id) => window.arbora.invoke('terminal.lines', { id, count: 20 }), terminal?.id ?? ''),
        )
        .toContainEqual('src/components/Card.tsx:4:3');
      // Which screen row the output lands on depends on the shell and prompt, so try the first rows
      // after `clear` at the start of the line until the link opens the file.
      const screen = page.locator('.xterm-screen').first();
      const box = await screen.boundingBox();
      const rows = await page.evaluate(() => document.querySelector('.xterm-rows')?.children.length ?? 24);
      if (!box) throw new Error('No terminal screen');
      const rowHeight = box.height / rows;
      const x = box.x + 20;
      let opened = false;
      for (let row = 0; row < Math.min(rows, 8) && !opened; row++) {
        const y = box.y + rowHeight * (row + 0.5);
        await page.mouse.move(x, y);
        await page.mouse.move(x + 2, y);
        await page.mouse.click(x + 2, y);
        opened = await expect(page.getByTestId('editor'))
          .toHaveAttribute('data-path', 'src/components/Card.tsx', { timeout: 1000 })
          .then(
            () => true,
            () => false,
          );
      }
      expect(opened).toBe(true);
      await expect(page.getByTestId('editor').locator('.cm-lineNumbers .cm-activeLineGutter')).toHaveText('4');
    } finally {
      await app.close();
    }
  });
});
