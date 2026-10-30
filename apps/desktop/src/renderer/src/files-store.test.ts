import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '@arbora/shared';
import {
  allDiagnostics,
  closeTabIn,
  fileTabId,
  omitKey,
  openTabIn,
  renamedPath,
  staleFolders,
  type EditorTab,
} from './files-store';

const file = (path: string, preview = false): EditorTab => ({ kind: 'file', id: fileTabId(path), path, preview });

describe('openTabIn', () => {
  it('replaces the preview tab with a new preview', () => {
    const tabs = [file('a.ts'), file('b.ts', true)];
    expect(openTabIn(tabs, fileTabId('a.ts'), 'c.ts', false)).toEqual([file('a.ts'), file('c.ts', true)]);
  });

  it('inserts pinned tabs after the active one and keeps the preview', () => {
    const tabs = [file('a.ts'), file('b.ts', true), file('c.ts')];
    expect(openTabIn(tabs, fileTabId('a.ts'), 'd.ts', true).map((t) => t.path)).toEqual([
      'a.ts',
      'd.ts',
      'b.ts',
      'c.ts',
    ]);
  });

  it('pins an existing preview tab instead of duplicating it', () => {
    const tabs = [file('a.ts', true)];
    expect(openTabIn(tabs, null, 'a.ts', true)).toEqual([file('a.ts')]);
    expect(openTabIn(tabs, null, 'a.ts', false)).toEqual(tabs);
  });
});

describe('closeTabIn', () => {
  it('activates the right neighbour, else the left, else the browser', () => {
    const tabs = [file('a.ts'), file('b.ts'), file('c.ts')];
    expect(closeTabIn(tabs, fileTabId('b.ts'), fileTabId('b.ts')).active).toBe(fileTabId('c.ts'));
    expect(closeTabIn(tabs, fileTabId('c.ts'), fileTabId('c.ts')).active).toBe(fileTabId('b.ts'));
    expect(closeTabIn([file('a.ts')], fileTabId('a.ts'), fileTabId('a.ts'))).toEqual({ tabs: [], active: null });
  });

  it('keeps the active tab when closing another', () => {
    const tabs = [file('a.ts'), file('b.ts')];
    expect(closeTabIn(tabs, fileTabId('a.ts'), fileTabId('b.ts'))).toEqual({
      tabs: [file('a.ts')],
      active: fileTabId('a.ts'),
    });
  });
});

describe('renamedPath', () => {
  it('moves the path and everything under it, and nothing else', () => {
    expect(renamedPath('src/a.ts', 'src/a.ts', 'lib/a.ts')).toBe('lib/a.ts');
    expect(renamedPath('src/x/a.ts', 'src', 'app')).toBe('app/x/a.ts');
    expect(renamedPath('srcfoo/a.ts', 'src', 'app')).toBeNull();
  });
});

describe('staleFolders', () => {
  it('lists the listed parents of added and removed entries only', () => {
    const listed = { '': [], src: [] };
    expect(
      staleFolders(
        [
          { type: 'add', path: 'src/a.ts' },
          { type: 'change', path: 'README.md' },
          { type: 'unlinkDir', path: 'lib' },
          { type: 'add', path: 'docs/guide/x.md' },
        ],
        listed,
      ).sort(),
    ).toEqual(['', 'src']);
  });
});

describe('allDiagnostics', () => {
  it('flattens tools and sorts by file and position', () => {
    const d = (path: string, line: number, source: 'eslint' | 'tsc'): Diagnostic => ({
      path,
      line,
      column: 1,
      severity: 'error',
      message: 'x',
      source,
    });
    const sorted = allDiagnostics({
      diagnostics: {
        'b.ts': { eslint: [d('b.ts', 3, 'eslint')], tsc: [d('b.ts', 1, 'tsc')] },
        'a.ts': { tsc: [d('a.ts', 9, 'tsc')] },
      },
    });
    expect(sorted.map((x) => `${x.path}:${x.line}`)).toEqual(['a.ts:9', 'b.ts:1', 'b.ts:3']);
  });
});

describe('omitKey', () => {
  it('drops one key without mutating', () => {
    const record = { a: 1, b: 2 };
    expect(omitKey(record, 'a')).toEqual({ b: 2 });
    expect(record).toEqual({ a: 1, b: 2 });
  });
});
