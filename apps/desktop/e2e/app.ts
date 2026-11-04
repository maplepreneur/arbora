import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';

export const DESKTOP_ROOT = resolve(import.meta.dirname, '..');
export const MAIN_ENTRY = join(DESKTOP_ROOT, 'out/main/index.js');
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
 * Shows Browser or Grove. A narrow title bar folds the switch into the active option, so the
 * other segment is not a button; the workspace chord toggles it.
 */
export async function switchWorkspace(page: Page, kind: 'browser' | 'grove'): Promise<void> {
  const group = page.getByTestId('workspace-switch');
  await expect(group).toBeVisible();
  if ((await group.getAttribute('data-workspace')) === kind) return;
  if ((await group.getAttribute('data-collapsed')) === 'true') {
    await page.keyboard.press('ControlOrMeta+Alt+G');
  } else {
    await page.getByTestId(`workspace-${kind}`).click();
  }
  await expect(group).toHaveAttribute('data-workspace', kind);
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
