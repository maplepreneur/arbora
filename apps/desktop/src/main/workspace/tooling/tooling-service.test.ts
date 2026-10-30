import { fork } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { editorSettingsSchema, type Diagnostic } from '@arbora/shared';
import { formatWithProject, lintWithProject } from './project-tools.js';
import type { ToolRequest, ToolResponse } from './protocol.js';
import { ToolingService, type ForkTool, type ToolProcess } from './tooling-service.js';

/** The repo's own node_modules has Prettier, ESLint and TypeScript; projects link to it. */
const REPO_MODULES = resolve(import.meta.dirname, '../../../../../../node_modules');

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'arbora-tools-'));
  symlinkSync(REPO_MODULES, join(root, 'node_modules'), 'junction');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** Runs the worker's handlers in-process; `tsc` forks for real through `child_process`. */
const inProcessFork: ForkTool = (modulePath, args, options) => {
  if (modulePath === 'worker') {
    let listener: ((message: ToolResponse) => void) | undefined;
    return {
      postMessage: (request: ToolRequest) => {
        const run = request.type === 'format' ? formatWithProject : lintWithProject;
        void run(request.root, request.file, request.content).then(
          (result) => listener?.({ id: request.id, ok: true, type: request.type, result } as ToolResponse),
          (error: unknown) => listener?.({ id: request.id, ok: false, error: (error as Error).message }),
        );
      },
      onMessage: (l) => (listener = l),
      onExit: () => undefined,
      stdout: () => Promise.resolve(''),
      kill: () => undefined,
    };
  }
  const child = fork(modulePath, [...args], { cwd: options.cwd, env: options.env, stdio: 'pipe' });
  let output = '';
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
  const exited = new Promise<string>((done) => child.on('exit', () => done(output)));
  const process: ToolProcess = {
    postMessage: () => undefined,
    onMessage: () => undefined,
    onExit: (l) => child.on('exit', l),
    stdout: () => exited,
    kill: () => child.kill(),
  };
  return process;
};

function tooling(root: string, settings = {}) {
  const diagnostics: { path: string; source: string; list: Diagnostic[] }[] = [];
  const errors: string[] = [];
  const service = new ToolingService({
    root,
    workerPath: 'worker',
    fork: inProcessFork,
    environment: () => Promise.resolve(process.env),
    settings: () => editorSettingsSchema.parse(settings),
    events: {
      diagnostics: (path, source, list) => diagnostics.push({ path, source, list }),
      toolError: (source, message) => errors.push(`${source}: ${message}`),
    },
    tscDebounceMs: 10,
  });
  return { service, diagnostics, errors };
}

describe('ToolingService with the project tools', () => {
  it("formats with the project's Prettier and its config", async () => {
    const root = project({ '.prettierrc': '{ "singleQuote": true }', 'src/a.ts': '' });
    const { service } = tooling(root);
    const result = await service.format('src/a.ts', 'const a = "x"');
    expect(result).toEqual({ content: "const a = 'x';\n" });
    service.dispose();
  });

  it('skips files Prettier ignores or cannot parse', async () => {
    const root = project({ '.prettierignore': 'vendor/\n' });
    const { service } = tooling(root);
    expect(await service.format('vendor/a.ts', 'const a = "x"')).toEqual({ content: null });
    expect(await service.format('notes.unknownext', 'x')).toEqual({ content: null });
    service.dispose();
  });

  it('returns null without Prettier', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arbora-tools-none-'));
    const { service } = tooling(root);
    expect(await service.format('a.ts', 'x')).toEqual({ content: null });
    service.dispose();
  });

  it('lints with a flat ESLint config after save', async () => {
    const root = project({ 'eslint.config.mjs': "export default [{ rules: { 'no-debugger': 'error' } }];\n" });
    const { service, diagnostics } = tooling(root);
    service.afterSave('src/a.js', 'function f() {\n  debugger;\n}\nf();\n');
    await vi.waitFor(() => expect(diagnostics).toHaveLength(1), { timeout: 15_000 });
    expect(diagnostics[0]).toMatchObject({ path: 'src/a.js', source: 'eslint' });
    expect(diagnostics[0]?.list[0]).toMatchObject({ line: 2, severity: 'error', code: 'no-debugger' });
    service.dispose();
  });

  it('runs tsc only when enabled, and clears fixed files', async () => {
    const root = project({
      'tsconfig.json':
        '{ "compilerOptions": { "strict": true, "noEmit": true, "skipLibCheck": true, "types": [] }, "include": ["src"] }',
      'src/a.ts': 'export const n: number = "x";\n',
    });
    const { service, diagnostics } = tooling(root, { eslintOnSave: false, tscOnSave: true });
    service.afterSave('src/a.ts', '');
    await vi.waitFor(() => expect(diagnostics).toHaveLength(1), { timeout: 30_000 });
    expect(diagnostics[0]).toMatchObject({ path: 'src/a.ts', source: 'tsc' });
    expect(diagnostics[0]?.list[0]).toMatchObject({ line: 1, code: 'TS2322' });

    writeFileSync(join(root, 'src/a.ts'), 'export const n: number = 1;\n');
    service.afterSave('src/a.ts', '');
    await vi.waitFor(() => expect(diagnostics).toHaveLength(2), { timeout: 30_000 });
    expect(diagnostics[1]).toEqual({ path: 'src/a.ts', source: 'tsc', list: [] });
    service.dispose();
  }, 60_000);

  it('times out a hung tool and restarts it', async () => {
    let kills = 0;
    const hung: ForkTool = () => ({
      postMessage: () => undefined,
      onMessage: () => undefined,
      onExit: () => undefined,
      stdout: () => Promise.resolve(''),
      kill: () => kills++,
    });
    const service = new ToolingService({
      root: tmpdir(),
      workerPath: 'worker',
      fork: hung,
      environment: () => Promise.resolve({}),
      settings: () => editorSettingsSchema.parse({}),
      events: { diagnostics: () => undefined, toolError: () => undefined },
      timeoutMs: 50,
    });
    const result = await service.format('a.ts', 'x');
    expect(result.content).toBeNull();
    expect(result.error).toMatch(/timed out/);
    expect(kills).toBe(1);
    service.dispose();
  });
});
