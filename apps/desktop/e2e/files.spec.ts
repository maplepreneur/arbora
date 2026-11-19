import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { TerminalInfo } from '@arbora/shared';
import { checkedAgents, DESKTOP_ROOT, FIXTURES, launch, showRight, showSide, startAgent, tempUserData } from './app';

const FAKE_AGENT = resolve(DESKTOP_ROOT, 'e2e/fake-terminal-agent.mjs');
/** The repo's node_modules has Prettier, ESLint and TypeScript; the project links to it. */
const REPO_MODULES = resolve(DESKTOP_ROOT, '../../node_modules');

/** A copy of the vite-react fixture with Prettier and ESLint configs, a gitignored folder and a repo. */
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
  // The Git panel's "Agent changes" group needs a repository.
  const git = (args: string[]): void => {
    execFileSync('git', args, {
      cwd: dir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
      stdio: 'ignore',
    });
  };
  git(['init', '-b', 'main']);
  git(['add', 'src/App.tsx', 'src/components/Card.tsx', 'package.json']);
  git(['commit', '-m', 'init']);
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
      await showSide(page, 'files');
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
      await showRight(page, 'problems');
      await page.getByTestId('problems-scope-code').click();
      const diagnostic = page.getByTestId('diagnostic-row').first();
      await expect(diagnostic).toHaveAttribute('data-source', 'eslint');
      await expect(diagnostic).toContainText('no-debugger');
      await expect(diagnostic.getByTestId('diagnostic-location')).toHaveText('src/util.js:1:1');
      await page.locator('[data-testid="editor-tab"][data-path="src/util.js"]').click();

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
      await page.getByTestId('content-tab-browser').click();
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

      await showSide(page, 'search');
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
      await showSide(page, 'files');
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

  test('files an agent edits during its turn group under Agent changes; terminal links open the editor', async () => {
    const dir = project();
    const { app, page } = await launch(userData(), [dir]);
    try {
      await startAgent(page, 'fake');
      const threadId = await page
        .locator('[data-testid="grove-row"][aria-current="true"]')
        .getAttribute('data-thread-id');
      if (!threadId) throw new Error('no selected agent thread');
      const input = page.getByTestId('composer-input');
      await input.fill('edit src/App.tsx');
      await input.press('Enter');
      // The edit happened in the agent's terminal; the watcher files it under the turn.
      await expect
        .poll(async () => {
          const thread = (await page.evaluate(() => window.arbora.invoke('agent.listThreads'))).find(
            (t) => t.id === threadId,
          );
          return thread?.state.lastLine ?? '';
        })
        .toContain('edited src/App.tsx');
      expect(readFileSync(join(dir, 'src/App.tsx'), 'utf8')).toContain('Arbora fake agent was here');
      await showSide(page, 'git');
      // The row shows the file's basename with its directory beside it.
      await expect(page.getByTestId('git-section-agent')).toContainText('App.tsx');
      await expect(page.getByTestId('editor')).toHaveCount(0);
      await page.getByTestId('grove-tab-changes').click();
      await page.getByTestId('grove-change').click();
      await expect(page.getByTestId('editor')).toHaveAttribute('data-path', 'src/App.tsx');
      await expect(editor(page)).toContainText('Arbora fake agent was here');

      // Terminal `path:line:col` links.
      await showRight(page, 'terminal');
      await expect
        .poll(async () => (await page.evaluate(() => window.arbora.invoke('terminal.list'))).length, {
          timeout: 20_000,
        })
        .toBeGreaterThan(0);
      // The agent CLI owns its own terminal; the link test wants a shell of its own.
      const shell = await page.evaluate<TerminalInfo>(async () => {
        const list: TerminalInfo[] = await window.arbora.invoke('terminal.list');
        const shell = list.find((t) => t.kind === 'shell');
        return shell ? shell : window.arbora.invoke('terminal.create', { kind: 'shell', cols: 80, rows: 24 });
      });
      // Bring the shell's tab to the front so its xterm is on screen. A tab holds panes by id.
      const shellTab = page.locator('[data-testid="terminal-tab"][data-kind="shell"]').filter({ hasText: shell.title });
      await shellTab.first().click({ timeout: 10_000 });
      await page.evaluate(
        (id) => window.arbora.invoke('terminal.write', { id, data: 'clear; echo src/components/Card.tsx:4:3\r' }),
        shell.id,
      );
      await expect
        .poll(() => page.evaluate((id) => window.arbora.invoke('terminal.lines', { id, count: 20 }), shell.id))
        .toContainEqual('src/components/Card.tsx:4:3');
      // Which screen row the output lands on depends on the shell and prompt. The xterm screen can
      // be taller than its fitted rows, so walk the top of that terminal in line-sized steps.
      const screen = page.locator(`[data-terminal-id="${shell.id}"] .xterm-screen`);
      const box = await screen.boundingBox();
      if (!box) throw new Error('No terminal screen');
      // The screen element can be taller than the fitted rows, so walk the top of the pane in
      // line-sized steps instead of dividing the whole box by the first terminal's row count.
      const x = box.x + 24;
      let opened = false;
      for (let row = 0; row < 10 && !opened; row++) {
        const y = box.y + 8 + row * 18;
        if (y > box.y + box.height) break;
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
