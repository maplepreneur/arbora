import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';

export const DESKTOP_ROOT = resolve(import.meta.dirname, '..');
/** `ARBORA_E2E_OUT` points at another build folder, so a checkout instance running from `out/` keeps its files. */
export const MAIN_ENTRY = join(DESKTOP_ROOT, process.env['ARBORA_E2E_OUT'] ?? 'out', 'main/index.js');
export const FIXTURES = resolve(DESKTOP_ROOT, '../../fixtures');

export function tempUserData(): string {
  return mkdtempSync(join(tmpdir(), 'arbora-e2e-'));
}

/**
 * `agents` settings that mark the given custom agents as already checked and signed in, with the
 * fake agent's two models. Pickers only offer checked agents, and automatic checks stay off so the
 * built-in `npx` adapters never start in CI.
 */
export function checkedAgents(ids: readonly string[]): { verified: Record<string, unknown>; autoVerify: false } {
  const models = [
    { value: 'fast', name: 'Fast' },
    { value: 'smart', name: 'Smart' },
  ];
  return {
    verified: Object.fromEntries(ids.map((id) => [id, { status: 'ready', checkedAt: 0, models }])),
    autoVerify: false,
  };
}

export interface LaunchedApp {
  readonly app: ElectronApplication;
  readonly page: Page;
}

/**
 * The shell shows the tree, the chat and the right column together. `browser` brings the right
 * column's Browser tab forward; `grove` only waits for the shell.
 */
export async function switchWorkspace(page: Page, kind: 'browser' | 'grove'): Promise<void> {
  await expect(page.getByTestId('grove')).toBeVisible();
  if (kind === 'browser') await page.getByTestId('content-tab-browser').click();
}

/** Puts focus on the app chrome (not the page, a text field or a terminal) so chords reach the renderer. */
export async function focusChrome(page: Page): Promise<void> {
  const chat = page.getByTestId('panel-chat');
  if ((await chat.boundingBox())?.width) await chat.click({ position: { x: 4, y: 4 } });
  else await page.getByTestId('content-tabs').click({ position: { x: 2, y: 2 } });
}

const RIGHT_CHORDS = {
  terminal: 'Control+`',
  problems: 'ControlOrMeta+Shift+M',
} as const;

/** Shows a right-column tab: Browser, a terminal (starting one when there is none), or Problems. */
export async function showRight(page: Page, view: 'browser' | keyof typeof RIGHT_CHORDS): Promise<void> {
  if (view === 'browser') {
    await page.getByTestId('content-tab-browser').click();
    await expect(page.getByTestId('browser-panel')).toBeVisible();
    return;
  }
  await focusChrome(page);
  await page.keyboard.press(RIGHT_CHORDS[view]);
  await expect(page.getByTestId(view === 'terminal' ? 'terminal-panel' : 'content-tab-problems')).toBeVisible();
}

const SIDE_CHORDS = {
  files: 'ControlOrMeta+Shift+E',
  git: 'ControlOrMeta+Shift+G',
  search: 'ControlOrMeta+Shift+F',
} as const;

/** Opens the side column on Files, Source Control or Search; a narrow window makes room for it. */
export async function showSide(page: Page, view: keyof typeof SIDE_CHORDS): Promise<void> {
  await focusChrome(page);
  await page.keyboard.press(SIDE_CHORDS[view]);
  await expect(page.getByTestId(`side-view-${view}`)).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await page.getByTestId('panel-side').boundingBox())?.width ?? 0).toBeGreaterThan(100);
}

/** Starts `agentId` from the Grove launcher of the first project and waits for its thread. */
export async function startAgent(page: Page, agentId: string): Promise<void> {
  await page.getByTestId('grove-new-choose').first().click();
  await page.getByTestId(`launcher-agent-${agentId}`).click();
  await page.keyboard.press('Enter');
  await page.getByTestId('launcher-start').click();
  await expect(page.getByTestId('grove-launcher')).toHaveCount(0);
  await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', { timeout: 20_000 });
}

/** Launches the built app (`pnpm build:test`) with an isolated userData directory. */
export async function launch(
  userData: string,
  args: string[] = [],
  extraEnv: Record<string, string> = {},
): Promise<LaunchedApp> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  // The first-run wizard would cover every test's window; the onboarding spec turns it back on.
  env['ARBORA_SKIP_ONBOARDING'] = '1';
  // The harness has to be able to exit. Interactive quits still confirm when Grove processes are live.
  env['ARBORA_E2E'] = '1';
  Object.assign(env, extraEnv);
  env['ARBORA_USER_DATA_DIR'] = userData;
  delete env['ELECTRON_RENDERER_URL'];
  const extra = process.env['CI'] && process.platform === 'linux' ? ['--no-sandbox'] : [];
  const app = await electron.launch({ args: [MAIN_ENTRY, ...extra, ...args], env, cwd: DESKTOP_ROOT });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="app"]');
  await waitForStableSize(page);
  return { app, page };
}

/**
 * Tiling compositors (Hyprland) re-tile when the previous test's window closes, so a new window can
 * still be resizing when the test starts measuring or dragging panels.
 */
async function waitForStableSize(page: Page, quietMs = 400, timeoutMs = 5000): Promise<void> {
  await page.evaluate(
    ({ quietMs, timeoutMs }) =>
      new Promise<void>((resolve) => {
        const deadline = performance.now() + timeoutMs;
        let last = `${window.innerWidth}x${window.innerHeight}`;
        let since = performance.now();
        const tick = (): void => {
          const now = performance.now();
          const size = `${window.innerWidth}x${window.innerHeight}`;
          if (size !== last) {
            last = size;
            since = now;
          }
          if (now - since >= quietMs || now >= deadline) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { quietMs, timeoutMs },
  );
}
