import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { ThreadSummary } from '@arbora/shared';
import { checkedAgents, DESKTOP_ROOT, FIXTURES, launch, tempUserData } from './app';

const FAKE_AGENT = resolve(DESKTOP_ROOT, '../../packages/acp-client/src/testing/fake-agent.ts');
const FAKE_ID = 'fake';

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbora-polish-project-'));
  writeFileSync(join(dir, 'App.tsx'), 'export const App = () => null;\n');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'polish-fixture', private: true, scripts: { dev: 'vite' } }),
  );
  return dir;
}

function writeSettings(userData: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      version: 3,
      agents: {
        custom: [{ id: FAKE_ID, name: 'Fake agent', command: process.execPath, args: [FAKE_AGENT], env: {} }],
        permissions: {},
        defaultAgent: FAKE_ID,
        ...checkedAgents([FAKE_ID]),
      },
      ...extra,
    }),
  );
}

function threads(page: Page): Promise<ThreadSummary[]> {
  return page.evaluate(() => window.arbora.invoke('agent.listThreads'));
}

/** Xvfb has no window manager, so the window is not focused unless asked. */
async function focusWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
}

async function newThread(page: Page): Promise<string> {
  const before = new Set((await threads(page)).map((t) => t.id));
  await page.getByTestId('new-thread').click();
  await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', { timeout: 20_000 });
  const created = (await threads(page)).find((t) => !before.has(t.id));
  if (!created) throw new Error('no thread was created');
  return created.id;
}

test.describe('Stage 9 onboarding', () => {
  test('runs on first launch, checks the mode chords, and stays done', async () => {
    const userData = tempUserData();
    const project = tempProject();
    writeSettings(userData);
    const first = await launch(userData, [project], { ARBORA_SKIP_ONBOARDING: '0' });
    try {
      const { page } = first;
      await expect(page.getByTestId('onboarding')).toBeVisible();
      await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible();
      await page.getByTestId('onboarding-next').click();
      await expect(page.getByTestId('onboarding-step-project')).toContainText('arbora-polish-project-');
      await page.getByTestId('onboarding-next').click();
      // The dev command comes from package.json scripts.
      await expect(page.getByTestId('onboarding-dev-command')).toHaveValue('npm run dev');
      await page.getByTestId('onboarding-next').click();
      await expect(page.getByTestId(`onboarding-agent-${FAKE_ID}`)).toContainText('Connected');
      await page.getByTestId('onboarding-next').click();
      await expect(page.getByTestId('onboarding-step-tasks')).toBeVisible();
      await page.getByTestId('task-agent-fix-agent').selectOption(FAKE_ID);
      await page.getByTestId('onboarding-next').click();
      await expect(page.getByTestId('onboarding-step-keys')).toBeVisible();
      // Mode chords are intercepted in main; onboarding sees them instead of the modes starting.
      await page.keyboard.press('ControlOrMeta+K');
      await expect(page.getByTestId('onboarding-chord-arbora.agentMode')).toHaveAttribute('data-pressed', 'true');
      await page.keyboard.press('ControlOrMeta+D');
      await expect(page.getByTestId('onboarding-chord-arbora.designMode')).toHaveAttribute('data-pressed', 'true');
      await expect(page.getByTestId('mode-pills')).toHaveAttribute('data-mode', 'idle');
      await page.getByTestId('onboarding-next').click();
      await page.getByTestId('onboarding-sounds').click();
      await page.getByTestId('onboarding-next').click();
      await page.getByTestId('onboarding-finish').click();
      await expect(page.getByTestId('onboarding')).toHaveCount(0);
      // Finishing tries agent mode right away.
      await expect(page.getByTestId('mode-pills')).toHaveAttribute('data-mode', 'agent');
      const settings = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as {
        onboarding: { completed: boolean; checkedChords: string[] };
        sounds: { enabled: boolean };
        tasks: { fix: { agentId: string | null } };
      };
      expect(settings.tasks.fix.agentId).toBe(FAKE_ID);
      expect(settings.onboarding.completed).toBe(true);
      expect(settings.onboarding.checkedChords.sort()).toEqual(['arbora.agentMode', 'arbora.designMode']);
      expect(settings.sounds.enabled).toBe(false);
    } finally {
      await first.app.close();
    }
    const second = await launch(userData, [project], { ARBORA_SKIP_ONBOARDING: '0' });
    try {
      await expect(second.page.getByTestId('workspace')).toBeVisible();
      await expect(second.page.getByTestId('onboarding')).toHaveCount(0);
    } finally {
      await second.app.close();
    }
  });
});

test.describe('Stage 9 projects and project groups', () => {
  test('lists pinned, grouped and recent projects and switches between them', async () => {
    const userData = tempUserData();
    const vite = join(FIXTURES, 'vite-react');
    const html = join(FIXTURES, 'plain-html');
    writeSettings(userData, {
      recentProjects: [
        { path: vite, name: 'vite-react', openedAt: 2 },
        { path: html, name: 'plain-html', openedAt: 1 },
      ],
    });
    const { app, page } = await launch(userData);
    try {
      await expect(page.getByTestId('recent-projects')).toContainText('vite-react');
      await page.getByTestId('new-project-group').click();
      await page.getByTestId('new-project-group-input').fill('Client work');
      await page.getByTestId('new-project-group-input').press('Enter');
      await expect(page.getByTestId('project-group-client-work')).toContainText('Client work');
      // Row menus are native; drive the same IPC the menu items call.
      await page.evaluate(
        (path) =>
          window.arbora.invoke('projects.updateMeta', { path, patch: { groupId: 'client-work', alias: 'Shop' } }),
        vite,
      );
      await page.evaluate(
        (path) => window.arbora.invoke('projects.updateMeta', { path, patch: { pinned: true } }),
        html,
      );
      await expect(page.getByTestId('pinned-projects')).toContainText('plain-html');
      await expect(page.getByTestId('project-group-client-work')).toContainText('Shop');
      await page.getByTestId('projects-filter').fill('shop');
      await expect(page.getByTestId('pinned-projects')).toHaveCount(0);
      await page.getByTestId('projects-filter').fill('');

      await page.getByTestId('project-group-client-work').getByText('Shop').click();
      await expect(page.getByTestId('title-project-name')).toHaveText('vite-react');
      // The switcher lists the same sections and is intercepted like the mode chords.
      await page.keyboard.press('ControlOrMeta+Alt+O');
      await expect(page.getByTestId('project-switcher')).toBeVisible();
      await expect(page.locator(`[data-testid="switcher-project"][data-path="${vite}"]`)).toContainText('this window');
      await page.keyboard.type('plain');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('project-switcher')).toHaveCount(0);
      await expect.poll(() => app.windows().length).toBe(2);

      const library = await page.evaluate(() => window.arbora.invoke('projects.library'));
      expect(
        library.entries
          .filter((e) => e.open)
          .map((e) => e.folder)
          .sort(),
      ).toEqual(['plain-html', 'vite-react']);
      // A group survives the projects in it dropping out of the recents.
      const settings = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as {
        projectGroups: { id: string }[];
        projects: Record<string, { groupId?: string; alias?: string }>;
      };
      expect(settings.projectGroups.map((g) => g.id)).toEqual(['client-work']);
      expect(settings.projects[vite]).toMatchObject({ groupId: 'client-work', alias: 'Shop' });
    } finally {
      await app.close();
    }
  });
});

test.describe('Stage 9 agent groups and attention', () => {
  test('groups threads, badges a waiting permission and jumps to a finished thread', async () => {
    const userData = tempUserData();
    const project = tempProject();
    writeSettings(userData);
    const { app, page } = await launch(userData, [project]);
    try {
      await focusWindow(app);
      await expect(page.getByTestId('thread-list')).toBeVisible();
      await page.getByTestId('new-agent-group').click();
      await page.getByTestId('new-group-input').fill('UI');
      await page.getByTestId('new-group-input').press('Enter');
      await expect(page.getByTestId('agent-group')).toHaveAttribute('data-group-id', 'ui');

      // New thread in the group from its header.
      await page.getByTestId('agent-group').hover();
      await page.getByTestId('agent-group-new-thread').click();
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', { timeout: 20_000 });
      const grouped = (await threads(page)).find((t) => t.groupId === 'ui');
      expect(grouped).toBeTruthy();

      // A permission card counts as "needs you" until it is answered.
      await page.getByTestId('composer-input').fill('add a comment to `App.tsx`');
      await page.getByTestId('composer-input').press('Enter');
      await expect(page.getByTestId('permission-card')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('attention-badge')).toHaveText('1');
      await expect(page.getByTestId('app')).toHaveAttribute('data-last-cue', /^permission:/);
      await page.getByTestId('permission-allow_once').click();
      await expect(page.getByTestId('diff')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready');
      // Once the window has focus with the thread on screen, its finish counts as seen.
      await focusWindow(app);
      await expect(page.getByTestId('attention-badge')).toHaveCount(0);

      // A second thread, outside any group, finishes while the first one is on screen.
      await page.getByTestId('show-threads').click();
      const second = await newThread(page);
      await page.getByTestId('show-threads').click();
      await expect(page.locator(`[data-thread-id="${second}"]`)).toHaveAttribute('data-group-id', '');
      await page.evaluate(
        (threadId) =>
          window.arbora.invoke('agent.prompt', {
            threadId,
            blocks: [{ type: 'text', text: 'hello' }],
            attachments: [],
          }),
        second,
      );
      const row = page.locator(`[data-thread-id="${second}"]`);
      await expect(row.getByTestId('thread-attention')).toHaveAttribute('data-kind', 'finished');
      await expect(page.getByTestId('attention-badge')).toHaveText('1');
      await page.keyboard.press('ControlOrMeta+Alt+A');
      await expect(page.getByTestId('thread-view')).toBeVisible();
      await focusWindow(app);
      await expect(page.getByTestId('attention-badge')).toHaveCount(0);

      // Pinning and moving persist in the thread file.
      await page.evaluate(
        (threadId) => window.arbora.invoke('agent.setThreadPinned', { threadId, pinned: true }),
        second,
      );
      await page.evaluate(
        (threadId) => window.arbora.invoke('agent.setThreadGroup', { threadId, groupId: 'ui' }),
        second,
      );
      await expect
        .poll(async () => (await threads(page)).find((t) => t.id === second))
        .toMatchObject({
          pinned: true,
          groupId: 'ui',
        });
      const groupsFile = JSON.parse(readFileSync(join(project, '.arbora', 'agent-groups.json'), 'utf8')) as {
        groups: { id: string; name: string }[];
      };
      expect(groupsFile.groups).toEqual([expect.objectContaining({ id: 'ui', name: 'UI' })]);
    } finally {
      await app.close();
    }
  });
});

test.describe('Stage 9 settings', () => {
  test('edits a shortcut with conflict detection and shows every section', async () => {
    const userData = tempUserData();
    const project = tempProject();
    writeSettings(userData);
    const { app, page } = await launch(userData, [project]);
    try {
      await page.keyboard.press('ControlOrMeta+,');
      await expect(page.getByTestId('settings-page')).toBeVisible();
      for (const section of [
        'general',
        'appearance',
        'notifications',
        'editor',
        'browser',
        'project',
        'updates',
        'agents',
      ]) {
        await page.getByTestId(`settings-nav-${section}`).click();
      }
      await page.getByTestId('settings-nav-project').click();
      await page.getByTestId('project-dev-command').fill('pnpm start');
      await page.getByTestId('project-dev-command').press('Enter');
      await expect
        .poll(() => JSON.parse(readFileSync(join(project, '.arbora', 'project.json'), 'utf8')) as object)
        .toMatchObject({ devCommand: 'pnpm start' });
      await page.getByTestId('project-tool-evaluate').locator('[data-value="allow"]').click();
      await expect
        .poll(() => JSON.parse(readFileSync(join(project, '.arbora', 'project.json'), 'utf8')) as object)
        .toMatchObject({ browserTools: { evaluate: 'allow' } });

      await page.getByTestId('settings-nav-keyboard').click();
      await page.getByTestId('shortcut-filter').fill('Toggle Theme');
      const row = page.locator('[data-testid="shortcut-row"][data-command="arbora.toggleTheme"]');
      await row.getByTestId('shortcut-record').click();
      // Ctrl+K is agent mode: main must not intercept it while recording.
      await page.keyboard.press('ControlOrMeta+K');
      await expect(page.getByTestId('shortcut-conflict')).toContainText('Toggle Agent Mode');
      await expect(page.getByTestId('mode-pills')).toHaveAttribute('data-mode', 'idle');
      await page.getByTestId('shortcut-replace').click();
      await expect(row.getByTestId('shortcut-record')).toHaveText(process.platform === 'darwin' ? '⌘K' : 'Ctrl+K');
      const saved = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as {
        keybindings: Record<string, string | null>;
      };
      expect(saved.keybindings).toEqual({ 'arbora.toggleTheme': 'mod+k', 'arbora.agentMode': null });

      await page.getByTestId('settings-nav-notifications').click();
      await page.getByTestId('setting-notifications').click();
      await expect(page.getByTestId('setting-notifications')).toHaveAttribute('aria-checked', 'false');
      await page.getByTestId('settings-nav-updates').click();
      await expect(page.getByTestId('updates-section')).toContainText('Development build');
    } finally {
      await app.close();
    }
  });

  test('zooms the interface and sets the agent and code fonts from Appearance', async () => {
    const userData = tempUserData();
    const project = tempProject();
    writeSettings(userData);
    const { app, page } = await launch(userData, [project]);
    try {
      await page.keyboard.press('ControlOrMeta+,');
      await page.getByTestId('settings-nav-appearance').click();
      await page.getByTestId('ui-scale-125').click();
      await expect
        .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor()))
        .toBe(1.25);

      await page.getByTestId('setting-agent-font-size').fill('17');
      await page.getByTestId('setting-codeFont').fill('Fira Code');
      await page.getByTestId('setting-codeFont').press('Enter');
      await expect
        .poll(() =>
          page.evaluate(() => {
            const style = document.documentElement.style;
            const mono = style.getPropertyValue('--font-mono');
            return [style.getPropertyValue('--agent-font-size'), mono.startsWith("'Fira Code', 'Dank Mono'")];
          }),
        )
        .toEqual(['17px', true]);
      const saved = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as { appearance: object };
      expect(saved.appearance).toMatchObject({ uiScale: 125, agentFontSize: 17, codeFont: 'Fira Code' });
    } finally {
      await app.close();
    }
  });
});
