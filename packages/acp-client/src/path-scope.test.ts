import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PathScopeError, resolveInsideRoot } from './path-scope.js';

describe('resolveInsideRoot', () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'arbora-scope-')));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), 'a');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('accepts files inside the root and returns the absolute path', () => {
    expect(resolveInsideRoot(root, join(root, 'src', 'a.ts'))).toBe(join(root, 'src', 'a.ts'));
  });

  it('accepts paths to files that do not exist yet in existing folders', () => {
    expect(resolveInsideRoot(root, join(root, 'src', 'new.ts'))).toBe(join(root, 'src', 'new.ts'));
  });

  it('accepts paths in folders that do not exist yet', () => {
    expect(resolveInsideRoot(root, join(root, 'deep', 'er', 'file.ts'))).toBe(join(root, 'deep', 'er', 'file.ts'));
  });

  it('rejects relative paths (ACP requires absolute paths)', () => {
    expect(() => resolveInsideRoot(root, 'src/a.ts')).toThrow(PathScopeError);
  });

  it('rejects paths that escape with ..', () => {
    expect(() => resolveInsideRoot(root, join(root, '..', 'outside.ts'))).toThrow(PathScopeError);
    expect(() => resolveInsideRoot(root, join(root, 'src', '..', '..', 'x'))).toThrow(PathScopeError);
  });

  it('rejects a sibling folder whose name starts with the root name', () => {
    expect(() => resolveInsideRoot(root, `${root}-evil/file.ts`)).toThrow(PathScopeError);
  });

  it('rejects symlinks that point outside the root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'arbora-outside-'));
    try {
      writeFileSync(join(outside, 'secret'), 's');
      symlinkSync(outside, join(root, 'link'));
      expect(() => resolveInsideRoot(root, join(root, 'link', 'secret'))).toThrow(PathScopeError);
      // A new file under a symlinked folder is still outside.
      expect(() => resolveInsideRoot(root, join(root, 'link', 'new'))).toThrow(PathScopeError);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('follows symlinks that stay inside the root', () => {
    symlinkSync(join(root, 'src'), join(root, 'alias'));
    expect(resolveInsideRoot(root, join(root, 'alias', 'a.ts'))).toBe(join(root, 'src', 'a.ts'));
  });

  it('accepts the root itself', () => {
    expect(resolveInsideRoot(root, root)).toBe(root);
  });
});
