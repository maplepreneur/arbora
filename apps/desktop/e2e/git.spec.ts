import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, tempUserData } from './app';

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbora-git-e2e-'));
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'note.txt'), 'hello\n');
  return dir;
}

test('git panel lists the branch and an untracked file', async () => {
  const dir = repo();
  const { app, page } = await launch(tempUserData(), [dir]);
  try {
    await page.getByTestId('rail-git').click();
    await expect(page.getByTestId('git-panel')).toBeVisible();
    await expect(page.getByLabel('Branch')).toHaveValue('main');
    await expect(page.locator('[data-testid="git-file"][data-path="note.txt"]')).toBeVisible();
  } finally {
    await app.close();
  }
});
