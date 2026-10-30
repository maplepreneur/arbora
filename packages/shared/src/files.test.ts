import { describe, expect, it } from 'vitest';
import {
  applyEol,
  baseName,
  detectEol,
  joinPath,
  parentPath,
  relativePathSchema,
  splitGlobs,
  toProjectPath,
} from './files.js';

describe('detectEol', () => {
  it('detects the majority line end', () => {
    expect(detectEol('a\r\nb\r\nc\n')).toBe('crlf');
    expect(detectEol('a\nb\r\nc\n')).toBe('lf');
  });

  it('defaults to lf for single-line text', () => {
    expect(detectEol('no newline')).toBe('lf');
  });
});

describe('applyEol', () => {
  it('normalises mixed line ends', () => {
    expect(applyEol('a\r\nb\nc\rd', 'lf')).toBe('a\nb\nc\nd');
    expect(applyEol('a\nb\r\nc', 'crlf')).toBe('a\r\nb\r\nc');
  });
});

describe('relative paths', () => {
  it('accepts project-relative paths only', () => {
    expect(relativePathSchema.safeParse('src/App.tsx').success).toBe(true);
    expect(relativePathSchema.safeParse('').success).toBe(true);
    expect(relativePathSchema.safeParse('/etc/passwd').success).toBe(false);
    expect(relativePathSchema.safeParse('C:/Windows').success).toBe(false);
    expect(relativePathSchema.safeParse('src/../../secret').success).toBe(false);
  });

  it('splits and joins', () => {
    expect(baseName('src/components/Card.tsx')).toBe('Card.tsx');
    expect(parentPath('src/components/Card.tsx')).toBe('src/components');
    expect(parentPath('README.md')).toBe('');
    expect(joinPath('', 'a.ts')).toBe('a.ts');
    expect(joinPath('src', 'a.ts')).toBe('src/a.ts');
  });

  it('splits glob lists', () => {
    expect(splitGlobs(' src/**, *.ts ,, ')).toEqual(['src/**', '*.ts']);
  });
});

describe('toProjectPath', () => {
  it('maps absolute paths inside the project', () => {
    expect(toProjectPath('/home/me/app/src/App.tsx', '/home/me/app')).toBe('src/App.tsx');
    expect(toProjectPath('/home/me/app', '/home/me/app/')).toBe('');
  });

  it('rejects paths outside the project', () => {
    expect(toProjectPath('/home/me/other/a.ts', '/home/me/app')).toBeNull();
    expect(toProjectPath('/home/me/app-2/a.ts', '/home/me/app')).toBeNull();
    expect(toProjectPath('../a.ts', '/home/me/app')).toBeNull();
  });

  it('handles relative and Windows paths', () => {
    expect(toProjectPath('./src/main.ts', '/p')).toBe('src/main.ts');
    expect(toProjectPath('c:\\Work\\App\\src\\a.ts', 'C:\\Work\\App')).toBe('src/a.ts');
  });
});
