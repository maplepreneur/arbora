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

async function waitForHttp(url: string, child: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + 30_000;
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
    child.kill();
  });
}

async function startProcess(
  args: string[],
  cwd: string,
  url: string,
  env: Record<string, string> = {},
): Promise<RunningServer> {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
  let log = '';
  child.stdout.on('data', (chunk: Buffer) => (log += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (log += chunk.toString()));
  try {
    await waitForHttp(url, child, () => log);
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
