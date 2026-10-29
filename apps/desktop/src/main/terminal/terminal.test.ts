import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { toPlatform, type TerminalInfo } from '@arbora/shared';
import { findLockfiles, inferProjectDevCommand } from './dev-command.js';
import { DevServer, waitForPortFree } from './dev-server.js';
import { descendantsOf, isAlive, parseProcessTable } from './process-tree.js';
import { mergePath, parseShellEnvOutput } from './shell-env.js';
import { TerminalService } from './terminal-service.js';

const platform = toPlatform(process.platform);

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbora-terminal-'));
}

describe('process tree', () => {
  it('parses ps output and lists descendants deepest first', () => {
    const table = parseProcessTable('  1     0\n 10     1\n 11    10\n 12    11\n 13    10\n 99     1\nbad line\n');
    expect(descendantsOf(10, table)).toEqual([12, 11, 13]);
    expect(descendantsOf(12, table)).toEqual([]);
  });

  it('survives cycles in a corrupt table', () => {
    const table = new Map([
      [1, [2]],
      [2, [1]],
    ]);
    expect(descendantsOf(1, table)).toEqual([2]);
  });
});

describe('login shell environment', () => {
  it('reads PATH between the markers, ignoring rc-file noise', () => {
    const output =
      'Welcome!\n__ARBORA_SHELL_ENV__\nHOME=/home/me\nPATH=/home/me/.local/bin:/usr/bin\nSHELL=/bin/zsh\n__ARBORA_SHELL_ENV__\nbye';
    expect(parseShellEnvOutput(output)).toBe('/home/me/.local/bin:/usr/bin');
    expect(parseShellEnvOutput('PATH=/usr/bin')).toBeUndefined();
  });

  it('merges login PATH first and dedupes', () => {
    expect(mergePath('/a:/b', '/b:/c', ':')).toBe('/a:/b:/c');
    expect(mergePath(undefined, '/usr/bin', ':')).toBe('/usr/bin');
  });
});

describe('dev command inference', () => {
  it('finds the lockfile in an ancestor (monorepo packages) and infers the command', () => {
    const root = tempDir();
    writeFileSync(join(root, 'pnpm-lock.yaml'), '');
    const app = join(root, 'apps', 'web');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    expect(findLockfiles(app)).toEqual(['pnpm-lock.yaml']);
    expect(inferProjectDevCommand(app)).toBe('pnpm dev');
  });

  it('returns null without package.json or a dev-like script', () => {
    const dir = tempDir();
    expect(inferProjectDevCommand(dir)).toBeNull();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' } }));
    expect(inferProjectDevCommand(dir)).toBeNull();
  });
});

describe('waitForPortFree', () => {
  it('waits until the port stops accepting connections', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    expect(await waitForPortFree(address.port, 300)).toBe(false);
    setTimeout(() => server.close(), 100);
    expect(await waitForPortFree(address.port, 3000)).toBe(true);
  });
});

/** Runs real shells through node-pty (N-API, so the Electron-built binary also loads in Node). */
describe('TerminalService', { timeout: 20_000 }, () => {
  let service: TerminalService | undefined;
  afterEach(() => service?.dispose());

  function setup(cwd = tempDir(), onUrl?: (id: string, url: string) => void) {
    const data = new Map<string, string>();
    const urls: string[] = [];
    let terminals: TerminalInfo[] = [];
    service = new TerminalService({
      platform,
      cwd,
      environment: () => {
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
        return Promise.resolve(env);
      },
      shell: () => undefined,
      events: {
        data: (id, chunk) => data.set(id, (data.get(id) ?? '') + chunk),
        changed: (list) => (terminals = list),
        url: (id, url) => {
          urls.push(url);
          onUrl?.(id, url);
        },
      },
    });
    return { service, data, urls, terminals: () => terminals };
  }

  const nodeScript = (code: string): string => `node -e "${code.replace(/"/g, '\\"')}"`;

  it('runs a command, buffers ANSI-stripped lines, detects the URL once and reports the exit', async () => {
    const { service, urls, terminals } = setup();
    const info = await service.create({
      kind: 'dev',
      command: nodeScript(
        "console.log('\\x1b[32m  Local:\\x1b[0m   http://localhost:\\x1b[1m5173\\x1b[22m/'); console.log('again http://localhost:5173/'); setTimeout(() => process.exit(3), 200)",
      ),
    });
    expect(info.pid).toBeGreaterThan(0);
    await expect.poll(() => terminals().find((t) => t.id === info.id)?.exitCode, { timeout: 10_000 }).toBe(3);
    expect(urls).toEqual(['http://localhost:5173/']);
    const lines = service.lines(info.id);
    expect(lines.some((l) => l.includes('Local:   http://localhost:5173/'))).toBe(true);
    expect(lines.join('\n')).not.toContain('\u001b');
  });

  it('kills the whole process tree, so a child holding a port dies too', async () => {
    const { service, data } = setup();
    const info = await service.create({
      command: nodeScript(
        "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); console.log('child ' + c.pid); setInterval(() => {}, 1000)",
      ),
    });
    await expect.poll(() => /child (\d+)/.exec(data.get(info.id) ?? '')?.[1], { timeout: 10_000 }).toBeDefined();
    const childPid = Number(/child (\d+)/.exec(data.get(info.id) ?? '')?.[1]);
    expect(isAlive(childPid)).toBe(true);
    await service.kill(info.id);
    await expect.poll(() => isAlive(childPid), { timeout: 10_000 }).toBe(false);
  });

  it('restarts a terminal in place and finds the URL again', async () => {
    const { service, urls } = setup();
    const info = await service.create({
      kind: 'dev',
      command: nodeScript("console.log('ready on http://127.0.0.1:4321/'); setInterval(() => {}, 1000)"),
    });
    await expect.poll(() => urls.length, { timeout: 10_000 }).toBe(1);
    const restarted = await service.restart(info.id);
    expect(restarted?.id).toBe(info.id);
    expect(restarted?.pid).not.toBe(info.pid);
    await expect.poll(() => urls.length, { timeout: 10_000 }).toBe(2);
    expect(service.scrollback(info.id)).toContain('restarting');
  });

  it('runs interactive shells that accept input', async () => {
    const { service, data } = setup();
    const info = await service.create({ cols: 120, rows: 30 });
    service.write(info.id, platform === 'win32' ? 'echo arbora-$((6*7))\r' : 'echo arbora-$((6*7))\r');
    if (platform !== 'win32') {
      await expect.poll(() => data.get(info.id) ?? '', { timeout: 10_000 }).toContain('arbora-42');
    }
    await service.close(info.id);
    expect(service.list()).toEqual([]);
  });

  it('DevServer infers the command, saves it, and restarts the same terminal', async () => {
    const project = tempDir();
    writeFileSync(join(project, 'package-lock.json'), '{}');
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify({
        scripts: { dev: 'node -e "console.log(\'http://localhost:4999/\'); setInterval(() => {}, 1000)"' },
      }),
    );
    const { service } = setup(project, (id, url) => devServer.noteUrl(id, url));
    let devCommand: string | undefined;
    const devServer = new DevServer({
      terminals: service,
      projectPath: project,
      settings: () => ({ version: 1, ...(devCommand ? { devCommand } : {}) }),
      saveDevCommand: (command) => (devCommand = command),
    });
    const first = await devServer.run();
    expect(devCommand).toBe('npm run dev');
    expect(first.terminal?.kind).toBe('dev');
    await expect.poll(() => devServer.status().url, { timeout: 20_000 }).toBe('http://localhost:4999/');
    expect(devServer.status()).toMatchObject({ running: true, command: 'npm run dev' });
    const second = await devServer.run();
    expect(second.terminal?.id).toBe(first.terminal?.id);
    await devServer.stop();
    expect(devServer.status().running).toBe(false);
  });

  it('DevServer reports a missing dev script', async () => {
    const project = tempDir();
    const { service } = setup(project);
    const devServer = new DevServer({
      terminals: service,
      projectPath: project,
      settings: () => ({ version: 1 }),
      saveDevCommand: () => undefined,
    });
    expect((await devServer.run()).error).toMatch(/No dev, start or serve script/);
  });
});
