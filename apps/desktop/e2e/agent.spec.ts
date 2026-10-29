import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { TerminalInfo, ThreadSummary } from '@arbora/shared';
import { DESKTOP_ROOT, launch, tempUserData } from './app';

const FAKE_AGENT = resolve(DESKTOP_ROOT, '../../packages/acp-client/src/testing/fake-agent.ts');
const FAKE_ID = 'fake';

/** A throwaway project with one file for the fake agent to edit. */
function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbora-agent-project-'));
  writeFileSync(join(dir, 'App.tsx'), 'export const App = () => null;\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'agent-fixture', private: true }));
  return dir;
}

/** Registers the fake agent as a custom agent before the app reads settings.json. */
function userDataWithFakeAgent(): string {
  const userData = tempUserData();
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      version: 3,
      agents: {
        custom: [{ id: FAKE_ID, name: 'Fake agent', command: process.execPath, args: [FAKE_AGENT], env: {} }],
        permissions: {},
      },
    }),
  );
  return userData;
}

function terminals(page: Page): Promise<TerminalInfo[]> {
  return page.evaluate(() => window.arbora.invoke('terminal.list'));
}

function threads(page: Page): Promise<ThreadSummary[]> {
  return page.evaluate(() => window.arbora.invoke('agent.listThreads'));
}

async function send(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('composer-input');
  await input.fill(text);
  await input.press('Enter');
}

test.describe('Stage 3 agent panel', () => {
  test('prompts the fake agent, answers a permission card, shows the diff and the agent terminal', async () => {
    const project = tempProject();
    const { app, page } = await launch(userDataWithFakeAgent(), [project]);
    try {
      await expect(page.getByTestId('agent-panel')).toBeVisible();
      await expect(page.getByTestId('thread-list')).toBeVisible();
      await page.getByTestId('new-thread').click();
      await expect(page.getByTestId('agent-picker')).toBeVisible();
      // Built-ins are listed even when not installed; the custom fake agent is available.
      await expect(page.getByTestId('pick-agent-claude-code')).toBeVisible();
      await page.getByTestId(`pick-agent-${FAKE_ID}`).click();
      await expect(page.getByTestId('thread-view')).toBeVisible();
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', { timeout: 20_000 });
      // Session controls come from the agent: a mode and a model config option.
      await expect(page.getByTestId('mode-select')).toHaveValue('ask');
      await expect(page.getByTestId('model-select')).toHaveValue('fast');

      // Slash-command autocomplete lists the agent's commands.
      const input = page.getByTestId('composer-input');
      await input.fill('/co');
      await expect(page.getByTestId('slash-suggestions')).toContainText('comment');
      await input.press('Escape');

      await send(page, 'add a comment to `App.tsx`');
      await expect(page.getByTestId('user-message')).toContainText('add a comment to');
      await expect(page.getByTestId('agent-thought')).toBeVisible();
      const card = page.getByTestId('permission-card');
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card.getByTestId('permission-allow_always')).toBeVisible();
      await card.getByTestId('permission-allow_once').click();

      await expect(page.getByTestId('diff')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('diff')).toContainText('Arbora fake agent was here');
      await expect(page.getByTestId('permission-outcome')).toContainText('Allow');
      // A normal end of turn draws no marker; the status returns to ready.
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready');
      await expect(page.getByTestId('turn-end')).toHaveCount(0);
      expect(readFileSync(join(project, 'App.tsx'), 'utf8')).toBe(
        '// Arbora fake agent was here\nexport const App = () => null;\n',
      );

      // Agent-run commands show up as read-only "agent" terminal tabs.
      await send(page, 'run echo');
      await expect(page.getByTestId('agent-message').last()).toContainText('hello from fake agent', {
        timeout: 20_000,
      });
      const agentTerminals = (await terminals(page)).filter((t) => t.kind === 'agent');
      expect(agentTerminals).toHaveLength(1);
      expect(agentTerminals[0]?.readOnly).toBe(true);
      await expect(page.getByTestId('terminal-tab').filter({ hasText: 'agent' })).toBeVisible();

      // Mode and model changes round-trip through the agent.
      await page.getByTestId('mode-select').selectOption('code');
      await expect(page.getByTestId('mode-select')).toHaveValue('code');
      await page.getByTestId('model-select').selectOption('smart');
      await expect(page.getByTestId('model-select')).toHaveValue('smart');

      // Cancel stops a slow turn.
      await send(page, 'slow');
      await expect(page.getByTestId('composer-cancel')).toBeVisible();
      await page.getByTestId('composer-cancel').click();
      await expect(page.getByTestId('turn-end').last()).toContainText('cancelled', { timeout: 20_000 });

      // The ACP log shows the JSON-RPC traffic.
      await page.getByTestId('toggle-log').click();
      await expect(page.getByTestId('acp-log')).toBeVisible();
      await expect(page.getByTestId('log-row').filter({ hasText: 'session/prompt' }).first()).toBeVisible();
      await page.getByTestId('toggle-log').click();

      // The thread is persisted in the project folder and listed with its title.
      const list = await threads(page);
      expect(list).toHaveLength(1);
      expect(list[0]?.title).toBe('add a comment to `App.tsx`');
      await expect.poll(() => existsSync(join(project, '.arbora/threads', `${list[0]?.id ?? ''}.json`))).toBe(true);
      await page.getByTestId('show-threads').click();
      await expect(page.getByTestId('thread-row')).toHaveCount(1);
      await expect(page.getByTestId('thread-row')).toContainText('add a comment to');
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('auto-approve edits answers permission cards for files inside the project', async () => {
    const project = tempProject();
    const { app, page } = await launch(userDataWithFakeAgent(), [project]);
    try {
      await page.getByTestId('new-thread').click();
      await page.getByTestId(`pick-agent-${FAKE_ID}`).click();
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', { timeout: 20_000 });
      await page.getByTestId('auto-approve-edits').click();
      await send(page, 'add a comment to `App.tsx`');
      await expect(page.getByTestId('permission-outcome')).toContainText('automatic', { timeout: 20_000 });
      await expect(page.getByTestId('diff')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready');
      expect(readFileSync(join(project, 'App.tsx'), 'utf8')).toContain('Arbora fake agent was here');
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true });
    }
  });
});
