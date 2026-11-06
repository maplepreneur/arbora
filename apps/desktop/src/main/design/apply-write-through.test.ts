import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitWriteThrough, prepareWriteThrough } from './apply-write-through.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('prepareWriteThrough', () => {
  it('patches the resolved project file and leaves it alone when the class is dynamic', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbora-write-'));
    dirs.push(root);
    const file = join(root, 'Card.tsx');
    const original = '<section className="p-6">\n';
    writeFileSync(file, original);
    const prepared = prepareWriteThrough(root, [
      {
        file: 'Card.tsx',
        line: 1,
        classes: [{ className: 'pt-10', property: 'padding-top' }],
      },
    ]);
    expect(prepared.map((entry) => entry.relative)).toEqual(['Card.tsx']);
    expect(readFileSync(file, 'utf8')).toBe(original);
    commitWriteThrough(prepared);
    expect(readFileSync(file, 'utf8')).toBe('<section className="p-6 pt-10">\n');

    writeFileSync(file, '<section className={clsx("p-6")}>\n');
    expect(() =>
      prepareWriteThrough(root, [
        { file: 'Card.tsx', line: 1, classes: [{ className: 'pt-10', property: 'padding-top' }] },
      ]),
    ).toThrow(/expression/);
    expect(readFileSync(file, 'utf8')).toBe('<section className={clsx("p-6")}>\n');
  });
});
