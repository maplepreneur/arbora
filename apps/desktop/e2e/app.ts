import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export const DESKTOP_ROOT = resolve(import.meta.dirname, '..');
export const MAIN_ENTRY = join(DESKTOP_ROOT, 'out/main/index.js');
export const FIXTURES = resolve(DESKTOP_ROOT, '../../fixtures');

export function tempUserData(): string {
  return mkdtempSync(join(tmpdir(), 'arbora-e2e-'));
}

export interface LaunchedApp {
  readonly app: ElectronApplication;
  readonly page: Page;
}

/** Launches the built app (`pnpm build:test`) with an isolated userData directory. */
export async function launch(userData: string, args: string[] = []): Promise<LaunchedApp> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env['ARBORA_USER_DATA_DIR'] = userData;
  delete env['ELECTRON_RENDERER_URL'];
  const extra = process.env['CI'] && process.platform === 'linux' ? ['--no-sandbox'] : [];
  const app = await electron.launch({ args: [MAIN_ENTRY, ...extra, ...args], env, cwd: DESKTOP_ROOT });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="app"]');
  return { app, page };
}
