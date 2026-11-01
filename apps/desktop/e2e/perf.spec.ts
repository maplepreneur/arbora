import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { FIXTURES, MAIN_ENTRY, tempUserData } from './app';
import { startPlainHtmlFixture, type RunningServer } from './servers';

/**
 * F-NFR-02 budget, run by the release workflow against the packaged Linux build (`ARBORA_APP` is
 * its executable) or locally against `out/` with `pnpm perf`. Skipped in the normal e2e run.
 */
const RSS_BUDGET_MB = Number(process.env['ARBORA_RSS_BUDGET_MB'] ?? 350);
const SCREENSHOT_BUDGET_MS = Number(process.env['ARBORA_SCREENSHOT_BUDGET_MS'] ?? 300);
const SETTLE_MS = 10_000;

test.describe('performance budget', () => {
  test.skip(process.env['ARBORA_PERF'] !== '1', 'set ARBORA_PERF=1 (pnpm perf)');

  let server: RunningServer;
  test.beforeAll(async () => {
    server = await startPlainHtmlFixture();
  });
  test.afterAll(async () => {
    await server.close();
  });

  test('idle RSS with the fixture loaded and screenshot latency stay under budget', async () => {
    test.setTimeout(120_000);
    const packaged = process.env['ARBORA_APP'];
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
    env['ARBORA_USER_DATA_DIR'] = tempUserData();
    env['ARBORA_SKIP_ONBOARDING'] = '1';
    // ARBORA_PERF_NO_EXTENSIONS=1 measures without the bundled React/Vue DevTools (~22 MB each).
    if (process.env['ARBORA_PERF_NO_EXTENSIONS'] === '1') {
      writeFileSync(
        join(env['ARBORA_USER_DATA_DIR'], 'settings.json'),
        JSON.stringify({ version: 3, browser: { devToolsExtensions: false } }),
      );
    }
    delete env['ELECTRON_RENDERER_URL'];
    const project = join(FIXTURES, 'plain-html');
    const sandbox = process.env['CI'] && process.platform === 'linux' ? ['--no-sandbox'] : [];
    const app = packaged
      ? await electron.launch({ executablePath: packaged, args: [...sandbox, project], env })
      : await electron.launch({ args: [MAIN_ENTRY, ...sandbox, project], env });
    try {
      const page = await app.firstWindow();
      await page.waitForSelector('[data-testid="workspace"]');
      const result = await page.evaluate((url) => window.arbora.invoke('browser.navigate', { url }), server.url);
      expect(result.ok).toBe(true);
      await page.waitForTimeout(SETTLE_MS);

      const metrics = await app.evaluate(({ app: electronApp }) =>
        electronApp.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, kb: m.memory.workingSetSize })),
      );
      // Summed working sets count shared pages once per process; PSS splits them fairly (Linux).
      const pssKb = (pid: number): number | null => {
        try {
          const match = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
          return match?.[1] ? Number(match[1]) : null;
        } catch {
          return null;
        }
      };
      const perProcess = metrics.map((m) => ({ ...m, kb: pssKb(m.pid) ?? m.kb }));
      console.log(`[perf] ${perProcess.map((m) => `${m.type}=${Math.round(m.kb / 1024)}MB`).join(' ')}`);
      const rssMb = Math.round(perProcess.reduce((sum, m) => sum + m.kb, 0) / 1024);

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
      const median = Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0);

      console.log(
        `[perf] rss=${rssMb}MB (budget ${RSS_BUDGET_MB}) screenshot median=${median}ms (budget ${SCREENSHOT_BUDGET_MS})`,
      );
      test.info().annotations.push({ type: 'rss-mb', description: String(rssMb) });
      test.info().annotations.push({ type: 'screenshot-ms', description: String(median) });
      expect(rssMb, `idle RSS ${rssMb} MB`).toBeLessThanOrEqual(RSS_BUDGET_MB);
      expect(median, `screenshot median ${median} ms`).toBeLessThanOrEqual(SCREENSHOT_BUDGET_MS);
    } finally {
      await app.close();
    }
  });
});
