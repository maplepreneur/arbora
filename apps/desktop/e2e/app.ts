import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const appRoot = resolve(import.meta.dirname, '..');
const mainEntry = join(appRoot, 'out/main/index.js');

export const fixtures = {
  viteReact: resolve(appRoot, '../../fixtures/vite-react'),
  plainHtml: resolve(appRoot, '../../fixtures/plain-html'),
};

export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Presses a chord through Electron's native input pipeline (`webContents.sendInputEvent`).
 * Playwright's `keyboard.press` uses CDP `Input.dispatchKeyEvent`, which skips
 * `before-input-event`, so chords that main intercepts never fire with it.
 */
export async function pressNative(
  app: ElectronApplication,
  key: string,
  modifiers: readonly ('mod' | 'shift' | 'alt')[] = [],
): Promise<void> {
  const electronModifiers = modifiers.map((modifier) =>
    modifier === 'mod' ? (process.platform === 'darwin' ? 'meta' : 'control') : modifier,
  );
  await app.evaluate(
    ({ BrowserWindow }, { keyCode, modifiers: mods }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      if (!contents) throw new Error('No window');
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: mods });
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: mods });
    },
    { keyCode: key, modifiers: electronModifiers },
  );
}

export interface LaunchedApp {
  readonly app: ElectronApplication;
  readonly page: Page;
}

export function createUserDataDir(): { path: string; dispose: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'arbora-e2e-'));
  return {
    path,
    dispose: () => {
      rmSync(path, { recursive: true, force: true });
    },
  };
}

/** Launches the built app (`pnpm build:test`) with an isolated userData directory. */
export async function launchArbora(userDataDir: string, args: string[] = []): Promise<LaunchedApp> {
  const chromiumArgs =
    // GitHub's Ubuntu runners restrict unprivileged user namespaces, which the Chromium sandbox
    // needs. Only CI disables it; local runs keep the sandbox.
    process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [];
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && name !== 'ELECTRON_RENDERER_URL') env[name] = value;
  }
  env.ARBORA_USER_DATA_DIR = userDataDir;
  const app = await electron.launch({ args: [mainEntry, ...chromiumArgs, ...args], env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}
