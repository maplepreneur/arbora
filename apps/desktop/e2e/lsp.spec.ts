import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, showSide, tempUserData } from './app';

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'arbora-lsp-'));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'node_modules/typescript/lib'), { recursive: true });
  mkdirSync(join(root, 'node_modules/typescript-language-server/lib'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{ "name": "lsp-fixture" }\n');
  writeFileSync(join(root, 'src/value.ts'), 'export const value = 1;\n');
  writeFileSync(join(root, 'node_modules/typescript/lib/tsserver.js'), '');
  cpSync(join(import.meta.dirname, 'lsp-fake.mjs'), join(root, 'node_modules/typescript-language-server/lib/cli.mjs'));
  return root;
}

function userData(): string {
  const dir = tempUserData();
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ version: 6, editor: { lsp: true } }));
  return dir;
}

test('the editor shows a hover from the project language server', async () => {
  const root = project();
  const { app, page } = await launch(userData(), [root]);
  try {
    await showSide(page, 'files');
    await page.locator('[data-testid="explorer-row"][data-path="src"]').click();
    await page.locator('[data-testid="explorer-row"][data-path="src/value.ts"]').click();
    const editor = page.getByTestId('editor');
    await expect(editor).toHaveAttribute('data-path', 'src/value.ts');
    await expect(editor).toHaveAttribute('data-lsp', 'on', { timeout: 15_000 });
    await expect(page.getByTestId('lsp-status')).toHaveCount(0);
    const line = editor.locator('.cm-line').first();
    const box = await line.boundingBox();
    if (!box) throw new Error('The editor line has no box');
    // The line element is full width. Hover sits on the glyphs, or CodeMirror ignores it.
    await page.mouse.move(box.x + 16, box.y + box.height / 2);
    await expect(page.getByText('lsp-hover-ok')).toBeVisible({ timeout: 10_000 });
    await line.click({ position: { x: 16, y: box.height / 2 } });
    await page.keyboard.press('End');
    await page.keyboard.type(' lsp');
    await page.keyboard.press('Control+Space');
    await expect(page.getByText('lspComplete', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    const cursor = editor.locator('.cm-cursor').first();
    const before = await cursor.boundingBox();
    if (!before) throw new Error('The editor cursor has no box');
    await page.keyboard.press('F12');
    // Definition returns the start of the line, so the cursor jumps back from the typed word.
    await expect.poll(async () => (await cursor.boundingBox())?.x ?? before.x).toBeLessThan(before.x - 20);
  } finally {
    await app.close();
  }
});
