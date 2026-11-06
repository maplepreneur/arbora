import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { join, resolve } from 'node:path';
import { DESKTOP_ROOT, FIXTURES } from './app';

const REPO_ROOT = resolve(DESKTOP_ROOT, '../..');

export interface RunningServer {
  readonly url: string;
  close(): Promise<void>;
}

export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolvePort(address.port);
        else reject(new Error('No port'));
      });
    });
  });
}

async function waitForHttp(url: string, child: ChildProcess, output: () => string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited (${child.exitCode}):\n${output()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${url}:\n${output()}`);
}

function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolveStop) => {
    child.once('exit', () => resolveStop());
    // Next and Nuxt run their server in a child process; Windows does not kill descendants.
    if (process.platform === 'win32' && child.pid !== undefined) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill();
    }
  });
}

async function startProcess(
  args: string[],
  cwd: string,
  url: string,
  env: Record<string, string> = {},
  timeoutMs = 30_000,
): Promise<RunningServer> {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
  let log = '';
  child.stdout.on('data', (chunk: Buffer) => (log += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (log += chunk.toString()));
  try {
    await waitForHttp(url, child, () => log, timeoutMs);
  } catch (error) {
    await stop(child);
    throw error;
  }
  return { url, close: () => stop(child) };
}

/** Runs the `fixtures/vite-react` dev server (real Vite + React dev build) on a free port. */
export async function startViteFixture(): Promise<RunningServer> {
  const port = await freePort();
  const vite = join(REPO_ROOT, 'node_modules/vite/bin/vite.js');
  return startProcess(
    [vite, '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    join(FIXTURES, 'vite-react'),
    `http://127.0.0.1:${port}/`,
  );
}

/** Framework dev servers compile on the first request, which takes a while on CI runners. */
const FRAMEWORK_START_TIMEOUT_MS = 120_000;

/** Runs the `fixtures/next` dev server (Next.js App Router, React 19, Turbopack) on a free port. */
export async function startNextFixture(): Promise<RunningServer> {
  const port = await freePort();
  return startProcess(
    [join(REPO_ROOT, 'node_modules/next/dist/bin/next'), 'dev', '--port', String(port), '--hostname', '127.0.0.1'],
    join(FIXTURES, 'next'),
    `http://127.0.0.1:${port}/`,
    { NEXT_TELEMETRY_DISABLED: '1' },
    FRAMEWORK_START_TIMEOUT_MS,
  );
}

/** Runs the `fixtures/nuxt` dev server (Nuxt 4, Vue 3) on a free port. */
export async function startNuxtFixture(): Promise<RunningServer> {
  const port = await freePort();
  return startProcess(
    [join(REPO_ROOT, 'node_modules/@nuxt/cli/bin/nuxi.mjs'), 'dev', '--port', String(port), '--host', '127.0.0.1'],
    join(FIXTURES, 'nuxt'),
    `http://127.0.0.1:${port}/`,
    { NUXT_TELEMETRY_DISABLED: '1' },
    FRAMEWORK_START_TIMEOUT_MS,
  );
}

/** Serves `dir` with the dependency-free static server on a free port. */
export async function startStaticFixture(dir: string): Promise<RunningServer> {
  const port = await freePort();
  return startProcess([join(FIXTURES, 'plain-html/server.mjs')], dir, `http://127.0.0.1:${port}/`, {
    PORT: String(port),
    ROOT: dir,
  });
}

/** Runs `fixtures/plain-html/server.mjs` on a free port. */
export async function startPlainHtmlFixture(): Promise<RunningServer> {
  const port = await freePort();
  return startProcess(
    [join(FIXTURES, 'plain-html/server.mjs')],
    join(FIXTURES, 'plain-html'),
    `http://127.0.0.1:${port}/`,
    {
      PORT: String(port),
    },
  );
}

/** HTTPS server with a self-signed `localhost` certificate (checked in under e2e/certs, test only). */
export async function startSelfSignedServer(): Promise<RunningServer> {
  const certs = join(DESKTOP_ROOT, 'e2e/certs');
  const server = createHttpsServer(
    { key: readFileSync(join(certs, 'localhost.key')), cert: readFileSync(join(certs, 'localhost.crt')) },
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Self-signed fixture</title><h1>secure localhost</h1>');
    },
  );
  const port = await freePort();
  await new Promise<void>((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
  return {
    url: `https://localhost:${port}/`,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}
