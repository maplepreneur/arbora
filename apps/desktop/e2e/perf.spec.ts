import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { _electron as electron, chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { FIXTURES, MAIN_ENTRY, tempUserData } from './app';
import { freePort, startPlainHtmlFixture, type RunningServer } from './servers';

/**
 * F-NFR-02 budget. `pnpm perf` measures `out/` (run `pnpm build` first for production code); the
 * release workflow sets `ARBORA_APP` to the packaged Linux executable. Skipped in the normal e2e
 * run. Memory is PSS from `/proc/<pid>/smaps_rollup` (Linux): summed working sets count shared
 * pages once per process and read more than twice as high.
 */
const RSS_BUDGET_MB = Number(process.env['ARBORA_RSS_BUDGET_MB'] ?? 350);
const SCREENSHOT_BUDGET_MS = Number(process.env['ARBORA_SCREENSHOT_BUDGET_MS'] ?? 300);
const SETTLE_MS = 10_000;

function pssKb(pid: number): number {
  try {
    const match = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
    return match?.[1] ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

/** `root` and its descendants that run `executable` (not the shells the terminal panel starts). */
function processTree(root: number, executable: string): number[] {
  const parents = new Map<number, number>();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      // The command name in parentheses may contain spaces; the parent pid follows the last ')'.
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      parents.set(Number(name), ppid);
    } catch {
      // The process exited while we looked.
    }
  }
  const tree = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, ppid] of parents) {
      if (!tree.has(pid) && tree.has(ppid)) {
        tree.add(pid);
        grew = true;
      }
    }
  }
  return [...tree].filter((pid) => {
    try {
      return readlinkSync(`/proc/${pid}/exe`) === executable;
    } catch {
      return false;
    }
  });
}

async function screenshotMedian(page: Page): Promise<number> {
  const timings: number[] = [];
  for (let i = 0; i < 5; i++) {
    timings.push(
      await page.evaluate(async () => {
        const start = performance.now();
        await window.arbora.invoke('browser.screenshot', { mode: 'viewport', save: false });
        return performance.now() - start;
      }),
    );
  }
  const sorted = [...timings].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0);
}

async function loadFixture(page: Page, url: string): Promise<void> {
  await page.waitForSelector('[data-testid="workspace"]');
  const result = await page.evaluate((target) => window.arbora.invoke('browser.navigate', { url: target }), url);
  expect(result.ok).toBe(true);
  await page.waitForTimeout(SETTLE_MS);
}

test.describe('performance budget', () => {
  test.skip(process.env['ARBORA_PERF'] !== '1', 'set ARBORA_PERF=1 (pnpm perf)');
  test.skip(process.platform !== 'linux', 'PSS is read from /proc');

  let server: RunningServer;
  test.beforeAll(async () => {
    server = await startPlainHtmlFixture();
  });
  test.afterAll(async () => {
    await server.close();
  });

  test('idle memory with the fixture loaded and screenshot latency stay under budget', async () => {
    test.setTimeout(120_000);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
    const userData = tempUserData();
    env['ARBORA_USER_DATA_DIR'] = userData;
    env['ARBORA_SKIP_ONBOARDING'] = '1';
    delete env['ELECTRON_RENDERER_URL'];
    // ARBORA_PERF_EXTENSIONS=startup measures with React/Vue DevTools loaded up front (~22 MB each).
    if (process.env['ARBORA_PERF_EXTENSIONS'] === 'startup') {
      writeFileSync(
        join(userData, 'settings.json'),
        JSON.stringify({ version: 3, browser: { devToolsExtensionsLoad: 'startup' } }),
      );
    }
    const project = join(FIXTURES, 'plain-html');
    const sandbox = process.env['CI'] ? ['--no-sandbox'] : [];

    let rssMb: number;
    let median: number;
    const packaged = process.env['ARBORA_APP'];
    if (packaged) {
      // Playwright's Electron launcher cannot attach to the packaged ESM main ("session closed"),
      // so the packaged build is driven over CDP like the Stage 4 packaged checks.
      const executable = realpathSync(packaged);
      const port = await freePort();
      const child = spawn(executable, [...sandbox, `--remote-debugging-port=${port}`, project], {
        env,
        stdio: 'ignore',
      });
      try {
        let browser: Browser | undefined;
        for (let attempt = 0; !browser; attempt++) {
          try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
          } catch (error) {
            if (attempt > 50) throw error;
            await new Promise((resolveRetry) => setTimeout(resolveRetry, 200));
          }
        }
        const connected = browser;
        const appPage = (): Page | undefined =>
          connected
            .contexts()
            .flatMap((c) => c.pages())
            .find((p) => p.url().includes('renderer/index.html'));
        await expect.poll(() => Boolean(appPage())).toBe(true);
        const page = appPage();
        if (!page || child.pid === undefined) throw new Error('no app window');
        await loadFixture(page, server.url);
        const pids = processTree(child.pid, executable);
        rssMb = Math.round(pids.reduce((sum, pid) => sum + pssKb(pid), 0) / 1024);
        const kind = (pid: number): string =>
          /--type=([\w-]+)/.exec(readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' '))?.[1] ?? 'browser';
        console.log(
          `[perf] packaged ${pids.map((pid) => `${kind(pid)}=${Math.round(pssKb(pid) / 1024)}MB`).join(' ')}`,
        );
        median = await screenshotMedian(page);
        await browser.close();
      } finally {
        child.kill();
      }
    } else {
      const app = await electron.launch({ args: [MAIN_ENTRY, ...sandbox, project], env });
      try {
        const page = await app.firstWindow();
        await loadFixture(page, server.url);
        const metrics = await app.evaluate(({ app: electronApp }) =>
          electronApp.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type })),
        );
        const perProcess = metrics.map((m) => ({ ...m, kb: pssKb(m.pid) }));
        console.log(`[perf] ${perProcess.map((m) => `${m.type}=${Math.round(m.kb / 1024)}MB`).join(' ')}`);
        rssMb = Math.round(perProcess.reduce((sum, m) => sum + m.kb, 0) / 1024);
        median = await screenshotMedian(page);
      } finally {
        await app.close();
      }
    }

    console.log(
      `[perf] memory=${rssMb}MB (budget ${RSS_BUDGET_MB}) screenshot median=${median}ms (budget ${SCREENSHOT_BUDGET_MS})`,
    );
    test.info().annotations.push({ type: 'memory-mb', description: String(rssMb) });
    test.info().annotations.push({ type: 'screenshot-ms', description: String(median) });
    expect(rssMb, `idle memory ${rssMb} MB`).toBeLessThanOrEqual(RSS_BUDGET_MB);
    expect(median, `screenshot median ${median} ms`).toBeLessThanOrEqual(SCREENSHOT_BUDGET_MS);
  });
});
