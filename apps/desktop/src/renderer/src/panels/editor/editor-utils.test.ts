import { describe, expect, it } from 'vitest';
import { languageIdForPath } from './language-id';
import { minimalChange, textOf, toCmDiagnostics } from './text-utils';

describe('languageIdForPath', () => {
  it('maps the languages Stage 7 supports', () => {
    expect(languageIdForPath('src/App.tsx')).toBe('tsx');
    expect(languageIdForPath('src/x.mts')).toBe('typescript');
    expect(languageIdForPath('a.jsx')).toBe('jsx');
    expect(languageIdForPath('index.html')).toBe('html');
    expect(languageIdForPath('a.scss')).toBe('css');
    expect(languageIdForPath('package.json')).toBe('json');
    expect(languageIdForPath('README.md')).toBe('markdown');
    expect(languageIdForPath('main.py')).toBe('python');
    expect(languageIdForPath('main.go')).toBe('go');
    expect(languageIdForPath('lib.rs')).toBe('rust');
    expect(languageIdForPath('App.vue')).toBe('vue');
    expect(languageIdForPath('App.svelte')).toBe('svelte');
    expect(languageIdForPath('.prettierrc')).toBe('json');
  });

  it('returns null for unknown or extension-less files', () => {
    expect(languageIdForPath('Makefile')).toBeNull();
    expect(languageIdForPath('a.unknownext')).toBeNull();
  });
});

describe('minimalChange', () => {
  it('replaces only the differing middle', () => {
    expect(minimalChange('const a=1;\n', 'const a = 1;\n')).toEqual({ from: 7, to: 8, insert: ' = ' });
    expect(minimalChange('same', 'same')).toBeNull();
    expect(minimalChange('', 'new')).toEqual({ from: 0, to: 0, insert: 'new' });
  });
});

describe('toCmDiagnostics', () => {
  it('converts and clamps positions', () => {
    const doc = textOf('one\ntwo\r\nthree');
    expect(doc.lines).toBe(3);
    const [first, second] = toCmDiagnostics(doc, [
      {
        path: 'a',
        line: 2,
        column: 2,
        endLine: 2,
        endColumn: 4,
        severity: 'error',
        message: 'm',
        source: 'eslint',
        code: 'r',
      },
      { path: 'a', line: 99, column: 99, severity: 'warning', message: 'n', source: 'tsc' },
    ]);
    expect(first).toEqual({ from: 5, to: 7, severity: 'error', message: 'm', source: 'eslint (r)' });
    expect(second).toMatchObject({ from: doc.length, to: doc.length, source: 'tsc' });
  });
});
