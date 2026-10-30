import { describe, expect, it } from 'vitest';
import type { FileEntry } from '@arbora/shared';
import { dropFolder, validateName, visibleRows } from './tree';

const dir = (path: string): FileEntry => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  kind: 'directory',
  ignored: false,
  symlink: false,
});
const file = (path: string): FileEntry => ({ ...dir(path), kind: 'file' });

const CHILDREN = {
  '': [dir('src'), dir('docs'), file('README.md')],
  src: [dir('src/components'), file('src/App.tsx')],
  'src/components': [file('src/components/Card.tsx')],
  docs: [file('docs/a.md')],
};

describe('visibleRows', () => {
  it('walks expanded folders depth first', () => {
    const rows = visibleRows(CHILDREN, { src: true, 'src/components': true }, null);
    expect(rows.map((r) => (r.kind === 'entry' ? `${r.depth}:${r.entry.path}` : 'create'))).toEqual([
      '0:src',
      '1:src/components',
      '2:src/components/Card.tsx',
      '1:src/App.tsx',
      '0:docs',
      '0:README.md',
    ]);
  });

  it('skips collapsed folders even when listed', () => {
    expect(visibleRows(CHILDREN, {}, null)).toHaveLength(3);
  });

  it('puts the new-entry input at the top of its folder', () => {
    const rows = visibleRows(CHILDREN, { src: true }, { dir: 'src', kind: 'file' });
    expect(rows[1]).toEqual({ kind: 'create', dir: 'src', entryKind: 'file', depth: 1 });
  });
});

describe('dropFolder', () => {
  it('drops into folders, or next to files', () => {
    expect(dropFolder(dir('src/components'))).toBe('src/components');
    expect(dropFolder(file('src/App.tsx'))).toBe('src');
    expect(dropFolder(file('README.md'))).toBe('');
    expect(dropFolder(null)).toBe('');
  });
});

describe('validateName', () => {
  it('accepts names and nested paths', () => {
    expect(validateName('Button.tsx')).toBeNull();
    expect(validateName('components/Button.tsx')).toBeNull();
  });

  it('rejects empty, reserved and invalid names', () => {
    expect(validateName('  ')).toMatch(/required/);
    expect(validateName('..')).toMatch(/reserved/);
    expect(validateName('a/../b')).toMatch(/reserved/);
    expect(validateName('/abs')).toMatch(/slash/);
    expect(validateName('a\\b')).toMatch(/Use \//);
    expect(validateName('what?.ts')).toMatch(/cannot contain/);
  });
});
