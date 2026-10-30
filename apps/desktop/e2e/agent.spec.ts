import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { TerminalInfo, ThreadSummary } from '@arbora/shared';
import { checkedAgents, DESKTOP_ROOT, launch, tempUserData } from './app';

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
        ...checkedAgents([FAKE_ID]),
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
      await page.getByTestId('new-thread-choose').click();
      await expect(page.getByTestId('agent-picker')).toBeVisible();
      // Only checked, signed-in agents are offered; the built-ins were never checked here.
      await expect(page.getByTestId(`pick-agent-${FAKE_ID}`)).toBeVisible();
      await expect(page.getByTestId('pick-agent-claude-code')).toHaveCount(0);
      await expect(page.getByTestId('agent-picker-hidden')).toBeVisible();
      await page.getByTestId(`pick-agent-${FAKE_ID}`).click();
      await expect(page.getByTestId('thread-view')).toBeVisible();
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', { timeout: 20_000 });
      // Session controls come from the agent: a mode and a model config option.
      await expect(page.getByTestId('mode-select')).toHaveAttribute('data-value', 'ask');
      await expect(page.getByTestId('model-select')).toHaveAttribute('data-value', 'fast');

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
      await page.getByTestId('mode-select').click();
      await page.locator('[data-testid="mode-select-option"][data-value="code"]').click();
      await expect(page.getByTestId('mode-select')).toHaveAttribute('data-value', 'code');
      // Keyboard: open, move down, Enter.
      await page.getByTestId('model-select').focus();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByTestId('model-select-menu')).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('model-select')).toHaveAttribute('data-value', 'smart');
      await expect(page.getByTestId('model-select-menu')).toHaveCount(0);

      // Cancel stops a slow turn.
      await send(page, 'slow');
      await expect(page.getByTestId('composer-cancel')).toBeVisible();
      await page.getByTestId('composer-cancel').click();
      await expect(page.getByTestId('turn-end').last()).toContainText('cancelled', { timeout: 20_000 });

      // An agent that ignores session/cancel is still stopped (the process is stopped after a grace period),
      // from the thread header this time.
      await send(page, 'stubborn');
      await expect(page.getByTestId('thread-stop')).toBeVisible();
      await page.getByTestId('thread-stop').click();
      await expect(page.getByTestId('turn-end').last()).toContainText('cancelled', { timeout: 15_000 });
      await expect(page.getByTestId('thread-stop')).toHaveCount(0);
      await expect(page.getByTestId('composer-send')).toBeVisible();

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

  test('the new-thread shortcut opens the picker on the default agent; arrows and Enter pick one', async () => {
    const project = tempProject();
    const userData = tempUserData();
    const agent = (id: string, name: string) => ({
      id,
      name,
      command: process.execPath,
      args: [FAKE_AGENT],
      env: {},
    });
    writeFileSync(
      join(userData, 'settings.json'),
      JSON.stringify({
        version: 3,
        agents: {
          custom: [agent('first', 'First agent'), agent('second', 'Second agent'), agent('locked', 'Locked agent')],
          permissions: {},
          defaultAgent: 'second',
          defaultModels: { second: 'smart' },
          ...checkedAgents(['first', 'second']),
        },
      }),
    );
    const { app, page } = await launch(userData, [project]);
    try {
      await expect(page.getByTestId('agent-panel')).toBeVisible();
      await page.keyboard.press('ControlOrMeta+Shift+N');
      await expect(page.getByTestId('agent-picker')).toBeVisible();
      // The default is listed first and highlighted; agents that were never checked are left out.
      const ids = await page
        .locator('[data-testid^="pick-agent-"]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid')));
      expect(ids).toEqual(['pick-agent-second', 'pick-agent-first']);
      await expect(page.getByTestId('pick-agent-second')).toHaveAttribute('data-active', 'true');
      await expect(page.getByTestId('agent-picker-hidden')).toContainText('hidden or not signed in');

      // The gear opens Settings on Agents, and keeps it open when Settings is already showing.
      await page.getByRole('button', { name: 'Open settings' }).click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await page.getByTestId('settings-nav-general').click();
      await page.getByRole('button', { name: 'Open settings' }).click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-nav-agents')).toHaveAttribute('aria-current', 'page');
      await page.getByTestId('settings-close').click();
      await expect(page.getByTestId('settings-page')).toHaveCount(0);
      await page.keyboard.press('ControlOrMeta+Shift+N');

      // Arrow keys wrap around; Enter starts the highlighted agent.
      await page.keyboard.press('ArrowDown');
      await expect(page.getByTestId('pick-agent-first')).toHaveAttribute('data-active', 'true');
      await page.keyboard.press('ArrowDown');
      await expect(page.getByTestId('pick-agent-second')).toHaveAttribute('data-active', 'true');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', { timeout: 20_000 });
      expect((await threads(page)).map((t) => t.agentId)).toEqual(['first']);

      // Shortcut, then Enter, starts the default agent on its default model.
      await page.keyboard.press('ControlOrMeta+Shift+N');
      await expect(page.getByTestId('pick-agent-second')).toHaveAttribute('data-active', 'true');
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await threads(page)).map((t) => t.agentId).sort()).toEqual(['first', 'second']);
      await expect(page.getByTestId('model-select')).toHaveAttribute('data-value', 'smart', { timeout: 20_000 });

      // → opens the model list: the default first, then favourites, then the rest.
      await page.keyboard.press('ControlOrMeta+Shift+N');
      await page.keyboard.press('ArrowRight');
      await expect(page.getByTestId('model-step')).toHaveAttribute('data-agent', 'second');
      const order = await page
        .locator('[data-testid^="pick-model-"]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid')));
      expect(order).toEqual(['pick-model-smart', 'pick-model-fast']);
      await expect(page.getByTestId('default-model-badge')).toHaveCount(1);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await threads(page)).length).toBe(3);
      await expect(page.getByTestId('model-select')).toHaveAttribute('data-value', 'fast', { timeout: 20_000 });

      // The split button's main half starts the global default without asking.
      await page.getByTestId('show-threads').click();
      await expect(page.getByTestId('new-thread')).toHaveAttribute('data-agent', 'second');
      await expect(page.getByTestId('new-thread')).toHaveAttribute('data-model', 'smart');
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('CLI keys in a thread: Shift+Tab rotates modes, Alt+T thinking, Alt+P and Alt+M open the menus', async () => {
    const project = tempProject();
    const { app, page } = await launch(userDataWithFakeAgent(), [project]);
    try {
      await page.getByTestId('new-thread-choose').click();
      await page.getByTestId(`pick-agent-${FAKE_ID}`).click();
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', { timeout: 20_000 });
      await expect(page.getByTestId('thread-key-hints')).toHaveText('Shift+Tab mode · Alt+P model · Alt+T thinking');
      const input = page.getByTestId('composer-input');
      await input.click();
      await input.fill('half a sentence');

      await page.keyboard.press('Shift+Tab');
      await expect(page.getByTestId('mode-select')).toHaveAttribute('data-value', 'code');
      await page.keyboard.press('Shift+Tab');
      await expect(page.getByTestId('mode-select')).toHaveAttribute('data-value', 'ask');
      // Focus and the draft stay in the composer, as in a terminal CLI.
      await expect(input).toBeFocused();
      await expect(input).toHaveValue('half a sentence');

      await page.keyboard.press('Alt+T');
      await expect(page.getByTestId('config-thinking')).toHaveAttribute('data-value', 'high');
      await page.keyboard.press('Alt+T');
      await expect(page.getByTestId('config-thinking')).toHaveAttribute('data-value', 'low');
      await expect(input).toHaveValue('half a sentence');

      await page.keyboard.press('Alt+P');
      await expect(page.getByTestId('model-select')).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('model-select')).toHaveAttribute('data-value', 'smart');

      await page.keyboard.press('Alt+M');
      await expect(page.getByTestId('mode-select')).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('mode-select')).toHaveAttribute('aria-expanded', 'false');

      // Outside the agent panel, Shift+Tab is left alone.
      await page.getByTestId('url-input').click();
      await page.keyboard.press('Shift+Tab');
      await expect(page.getByTestId('mode-select')).toHaveAttribute('data-value', 'ask');
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('favourite and default models, and a default agent for new threads', async () => {
    const project = tempProject();
    const { app, page } = await launch(userDataWithFakeAgent(), [project]);
    try {
      // The dropdown opens the picker. Pin the fake agent as the default there.
      await page.getByTestId('new-thread-choose').click();
      await expect(page.getByTestId('agent-picker')).toBeVisible();
      await page.getByTestId(`pick-agent-${FAKE_ID}`).hover();
      await page.getByTestId(`default-agent-${FAKE_ID}`).click();
      await expect(page.getByTestId('default-agent-badge')).toBeVisible();
      await page.getByTestId(`pick-agent-${FAKE_ID}`).click();
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', { timeout: 20_000 });

      // Star "Smart" and make it the default model for this agent.
      await page.getByTestId('model-select').click();
      const smart = page.locator('[data-testid="model-select-option"][data-value="smart"]');
      await smart.hover();
      await smart.getByTestId('model-select-favorite').click();
      await expect(page.getByTestId('model-select-menu').getByRole('group', { name: 'Favourites' })).toContainText(
        'Smart',
      );
      await smart.first().getByTestId('model-select-default').click();
      await page.keyboard.press('Escape');
      await expect
        .poll(() => page.evaluate(() => window.arbora.invoke('settings.get').then((s) => s.agents)))
        .toMatchObject({
          defaultAgent: FAKE_ID,
          defaultModels: { [FAKE_ID]: 'smart' },
          favoriteModels: { [FAKE_ID]: ['smart'] },
        });
      // The current thread keeps its model; a new thread from the split button uses both defaults.
      await expect(page.getByTestId('model-select')).toHaveAttribute('data-value', 'fast');
      await page.getByTestId('show-threads').click();
      await expect(page.getByTestId('new-thread-default')).toHaveText('Fake agent · Smart');
      await page.getByTestId('new-thread').click();
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', { timeout: 20_000 });
      await expect(page.getByTestId('model-select')).toHaveAttribute('data-value', 'smart', { timeout: 10_000 });
      expect(await threads(page)).toHaveLength(2);
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('auto-approve edits answers permission cards for files inside the project', async () => {
    const project = tempProject();
    const { app, page } = await launch(userDataWithFakeAgent(), [project]);
    try {
      await page.getByTestId('new-thread-choose').click();
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
