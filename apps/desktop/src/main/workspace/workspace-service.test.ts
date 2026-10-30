import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileChange } from '@arbora/shared';
import { WorkspaceService, type WorkspaceServiceOptions } from './workspace-service.js';

function project(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), 'arbora-ws-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const services: WorkspaceService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
});

function service(
  root: string,
  overrides: Partial<WorkspaceServiceOptions> = {},
): {
  ws: WorkspaceService;
  changes: FileChange[];
  trash: ReturnType<typeof vi.fn>;
} {
  const changes: FileChange[] = [];
  const trash = vi.fn(() => Promise.resolve());
  const ws = new WorkspaceService({
    root,
    rg: () => Promise.resolve(null),
    trash,
    reveal: () => undefined,
    tooling: null,
    formatOnSave: () => true,
    events: {
      changed: (batch) => changes.push(...batch),
      watchWarning: () => undefined,
      searchResults: () => undefined,
      searchDone: () => undefined,
    },
    ...overrides,
  });
  services.push(ws);
  return { ws, changes, trash };
}

describe('WorkspaceService', () => {
  it('lists folders first, marks ignored entries and hides .git', async () => {
    const root = project({
      '.gitignore': 'build/\n',
      '.git/HEAD': 'ref',
      'b.ts': '',
      'A.ts': '',
      'src/x.ts': '',
      'build/out.js': '',
      'node_modules/x/index.js': '',
    });
    const { ws } = service(root);
    const entries = await ws.readDir('');
    expect(entries.map((e) => `${e.kind === 'directory' ? 'd' : 'f'}:${e.name}${e.ignored ? '*' : ''}`)).toEqual([
      'd:build*',
      'd:node_modules*',
      'd:src',
      'f:.gitignore',
      'f:A.ts',
      'f:b.ts',
    ]);
    expect((await ws.readDir('src'))[0]?.path).toBe('src/x.ts');
  });

  it('reads text with its line ends, images as data URLs and spots binaries', async () => {
    const root = project({
      'crlf.txt': 'a\r\nb\r\n',
      'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      'blob.bin': Buffer.from([1, 0, 2]),
    });
    const { ws } = service(root);
    const text = await ws.read('crlf.txt');
    expect(text).toMatchObject({ type: 'text', eol: 'crlf', large: false, content: 'a\r\nb\r\n' });
    expect(await ws.read('logo.png')).toMatchObject({ type: 'image', dataUrl: 'data:image/png;base64,iVBORw==' });
    expect((await ws.read('blob.bin')).type).toBe('binary');
  });

  it('opens large files read-only', async () => {
    const root = project({ 'big.txt': 'x'.repeat(2 * 1024 * 1024 + 1) });
    const { ws } = service(root);
    expect(await ws.read('big.txt')).toMatchObject({ type: 'text', large: true });
  });

  it('saves with the requested line ends', async () => {
    const root = project({ 'a.txt': 'old\r\n' });
    const { ws } = service(root);
    const result = await ws.save('a.txt', 'one\ntwo\n', 'crlf', true);
    expect(result).toMatchObject({ content: 'one\ntwo\n', formatted: false });
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('one\r\ntwo\r\n');
  });

  it('formats through the tooling service and runs diagnostics after saving', async () => {
    const root = project({ 'a.ts': '' });
    const format = vi.fn(() => Promise.resolve({ content: 'const a = 1;\n' }));
    const afterSave = vi.fn();
    const tooling = { format, afterSave, dispose: vi.fn() } as unknown as NonNullable<
      WorkspaceServiceOptions['tooling']
    >;
    const { ws } = service(root, { tooling });
    const result = await ws.save('a.ts', 'const a=1', 'lf', true);
    expect(result).toMatchObject({ content: 'const a = 1;\n', formatted: true });
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('const a = 1;\n');
    expect(afterSave).toHaveBeenCalledWith('a.ts', 'const a = 1;\n');
    await ws.save('a.ts', 'const a=1', 'lf', false);
    expect(format).toHaveBeenCalledOnce();
  });

  it('creates, renames and trashes, refusing to overwrite', async () => {
    const root = project({ 'a.ts': 'a' });
    const { ws, trash } = service(root);
    await ws.create('src/new.ts', 'file');
    await ws.create('src/lib', 'directory');
    expect(existsSync(join(root, 'src/new.ts'))).toBe(true);
    await expect(ws.create('a.ts', 'file')).rejects.toThrow(/already exists/);
    await ws.rename('a.ts', 'src/lib/a.ts');
    expect(readFileSync(join(root, 'src/lib/a.ts'), 'utf8')).toBe('a');
    await expect(ws.rename('src/new.ts', 'src/lib/a.ts')).rejects.toThrow(/already exists/);
    await expect(ws.rename('src', 'src/lib/src')).rejects.toThrow(/into itself/);
    await ws.delete('src/new.ts');
    // Paths are resolved through symlinks (macOS temp folders live under /private/var).
    expect(trash).toHaveBeenCalledWith(join(realpathSync(root), 'src/new.ts'));
  });

  it('refuses paths that escape the project, including through symlinks', async () => {
    const outside = project({ 'secret.txt': 'secret' });
    const root = project({});
    symlinkSync(outside, join(root, 'link'), 'junction');
    const { ws } = service(root);
    await expect(ws.read('../secret.txt')).rejects.toThrow();
    await expect(ws.read('link/secret.txt')).rejects.toThrow(/not inside the project/);
  });

  it('indexes files and reports changes from the watcher', async () => {
    const root = project({ 'src/a.ts': '', 'node_modules/x.js': '' });
    const { ws, changes } = service(root);
    expect((await ws.listFiles()).files).toEqual(['src/a.ts']);
    // Give chokidar a moment to finish its initial scan before writing.
    await new Promise((resolve) => setTimeout(resolve, 300));
    writeFileSync(join(root, 'src/b.ts'), 'b');
    await vi.waitFor(() => expect(changes).toContainEqual({ path: 'src/b.ts', type: 'add' }), { timeout: 5000 });
    expect((await ws.listFiles()).files).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
