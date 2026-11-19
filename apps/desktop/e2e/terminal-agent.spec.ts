import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { TerminalInfo, ThreadSummary } from '@arbora/shared';
import { checkedAgents, DESKTOP_ROOT, launch, startAgent, tempUserData } from './app';

const FAKE_AGENT = resolve(DESKTOP_ROOT, 'e2e/fake-terminal-agent.mjs');
const FAKE_ID = 'fake';

/** A throwaway project the fake agent can edit. */
function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbora-agent-project-'));
  writeFileSync(join(dir, 'App.tsx'), 'export const App = () => null;\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'agent-fixture', private: true }));
  return dir;
}

/** Registers the fake terminal agent as a custom agent before the app reads settings.json. */
function userDataWithFakeAgent(): string {
  const userData = tempUserData();
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      version: 3,
      agents: {
        custom: [{ id: FAKE_ID, name: 'Fake agent', command: process.execPath, args: [FAKE_AGENT], env: {} }],
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

/** The agent terminal's raw scrollback, which is what the user sees in the pane. */
async function scrollback(page: Page, terminalId: string): Promise<string> {
  return page.evaluate(async (id): Promise<string> => {
    const response = await window.arbora.invoke('terminal.scrollback', { id });
    return typeof response === 'string' ? response : response.data;
  }, terminalId);
}

async function send(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('composer-input');
  await input.fill(text);
  await input.press('Enter');
}

/** Writes into the agent's terminal, as the user typing there would. */
function typeIntoTerminal(page: Page, terminalId: string, text: string): Promise<void> {
  return page.evaluate(({ id, data }) => window.arbora.invoke('terminal.write', { id, data }), {
    id: terminalId,
    data: text,
  });
}

test.describe('terminal agents', () => {
  test('runs the CLI in its own terminal, prompts it, waits for answers and recovers', async () => {
    const project = tempProject();
    const { app, page } = await launch(userDataWithFakeAgent(), [project]);
    try {
      await page.getByTestId('grove-new-choose').first().click();
      // Only checked, installed agents are offered; the built-ins were never checked here.
      await expect(page.getByTestId(`launcher-agent-${FAKE_ID}`)).toBeVisible();
      await expect(page.getByTestId('launcher-agent-claude-code')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await startAgent(page, FAKE_ID);

      // The agent is its terminal: interactive, with the banner and the MCP env the preface names.
      const listed = await terminals(page);
      const agentTerminal = listed.find((terminal) => terminal.kind === 'agent');
      expect(agentTerminal).toMatchObject({ readOnly: false, thread: expect.any(String) });
      const terminalId = agentTerminal?.id ?? '';
      await expect.poll(async () => (await scrollback(page, terminalId)).includes('FakeAgent v1.0.0')).toBe(true);
      await expect
        .poll(async () => (await scrollback(page, terminalId)).includes('mcp url: http://127.0.0.1'))
        .toBe(true);

      // A prompt rides bracketed paste into the terminal; the first one carries the preface.
      await send(page, 'hello world');
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'working');
      await expect
        .poll(async () => {
          const text = await scrollback(page, terminalId);
          return text.includes('You are working inside Arbora') && text.includes('Done: hello world');
        })
        .toBe(true);
      // The turn ends quietly and the thread is ready again; the bell counts the unread finish.
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', {
        timeout: 15_000,
      });

      // A question in the terminal waits for the user and rings the bell.
      await send(page, 'ask');
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'needs_input', {
        timeout: 15_000,
      });
      await expect(page.getByTestId('attention-badge')).toHaveText('1');
      await expect
        .poll(async () => (await scrollback(page, terminalId)).includes('Allow edit to src/App.tsx? (y/n)'))
        .toBe(true);
      // The user answers by typing into the terminal.
      await typeIntoTerminal(page, terminalId, 'y\r');
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', {
        timeout: 15_000,
      });
      await expect.poll(async () => (await scrollback(page, terminalId)).includes('Done: y')).toBe(true);
      await expect(page.getByTestId('attention-badge')).toHaveCount(0);

      // Stop interrupts the turn with Ctrl+C, and the CLI keeps running.
      await send(page, 'stream 50');
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'working');
      await page.getByTestId('composer-cancel').click();
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', {
        timeout: 15_000,
      });
      await expect.poll(async () => (await scrollback(page, terminalId)).includes('^C interrupted')).toBe(true);

      // A crash marks the thread Failed, with the exit code, and restart brings it back.
      await send(page, 'crash');
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'error', {
        timeout: 15_000,
      });
      await expect(page.getByTestId('thread-state-error')).toContainText('exited with code 3');
      await page.getByTestId('grove-restart').click();
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', {
        timeout: 20_000,
      });
      // The old terminal closed and a fresh one is running.
      const afterRestart = await terminals(page);
      expect(afterRestart.filter((terminal) => terminal.kind === 'agent')).toHaveLength(1);
      expect(afterRestart.find((terminal) => terminal.kind === 'agent')?.id).not.toBe(terminalId);

      // The thread is persisted in the project folder and listed with its title.
      const list = await threads(page);
      expect(list).toHaveLength(1);
      expect(list[0]?.title).toBe('hello world');
      await expect.poll(() => existsSync(join(project, '.arbora/threads', `${list[0]?.id ?? ''}.json`))).toBe(true);
      await expect(page.getByTestId('grove-row')).toHaveCount(1);
      await expect(page.getByTestId('grove-row')).toContainText('hello world');
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('the agent terminal is a normal interactive tab in the terminal drawer', async () => {
    const project = tempProject();
    const { app, page } = await launch(userDataWithFakeAgent(), [project]);
    try {
      await startAgent(page, FAKE_ID);
      const agentTerminal = (await terminals(page)).find((terminal) => terminal.kind === 'agent');
      expect(agentTerminal?.readOnly).toBe(false);
      // The drawer shows it as its own tab; typing there is the user's, not Arbora's.
      const tab = page.locator('[data-testid="terminal-tab"]').filter({ hasText: 'Fake agent' });
      await expect(tab).toHaveCount(1);
      await tab.first().click();
      await expect(page.getByTestId('terminal-panel')).toBeVisible();
      const xterm = page.locator(`[data-testid="terminal-xterm"][data-terminal-id="${agentTerminal?.id}"]`);
      await expect(xterm).toBeVisible();
      await typeIntoTerminal(page, agentTerminal?.id ?? '', 'uptime\r');
      await expect.poll(async () => (await scrollback(page, agentTerminal?.id ?? '')).includes('up ')).toBe(true);
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('power off ends the process; the next prompt starts it again', async () => {
    const project = tempProject();
    const { app, page } = await launch(userDataWithFakeAgent(), [project]);
    try {
      await startAgent(page, FAKE_ID);
      await page.getByTestId('grove-power').click();
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'idle', {
        timeout: 15_000,
      });
      await expect(page.getByTestId('thread-stopped')).toBeVisible();
      await expect
        .poll(async () => (await terminals(page)).filter((terminal) => terminal.kind === 'agent'))
        .toEqual([]);
      // The next prompt spawns the CLI again in a fresh terminal.
      await send(page, 'hello again');
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'working');
      const second = (await terminals(page)).find((terminal) => terminal.kind === 'agent');
      expect(second?.id).toBeTruthy();
      await expect
        .poll(async () => (await scrollback(page, second?.id ?? '')).includes('Done: hello again'))
        .toBe(true);
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', {
        timeout: 15_000,
      });
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('the new-thread shortcut opens the launcher on the default agent', async () => {
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
          defaultAgent: 'second',
          hidden: ['locked'],
          ...checkedAgents(['first', 'second', 'locked']),
        },
      }),
    );
    const { app, page } = await launch(userData, [project]);
    try {
      // An empty project starts the default agent once, as Grove always has.
      await expect.poll(async () => (await threads(page)).map((t) => t.agentId)).toEqual(['second']);
      await page.keyboard.press('ControlOrMeta+Shift+N');
      await expect(page.getByTestId('grove-launcher')).toBeVisible();
      // The default is listed first and highlighted; hidden agents are left out.
      const ids = await page
        .locator('[data-testid^="launcher-agent-"]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid')));
      expect(ids).toEqual(['launcher-agent-second', 'launcher-agent-first']);
      await expect(page.getByTestId('launcher-agent-second')).toHaveAttribute('data-active', 'true');
      await expect(page.getByTestId('launcher-agent-locked')).toHaveCount(0);
      await page.keyboard.press('Escape');
    } finally {
      await app.close();
      rmSync(project, { recursive: true, force: true });
    }
  });
});
