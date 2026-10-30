import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ComponentEntry, ElementDescriptor } from '@arbora/shared';
import { CANDIDATE_LIMIT, findCandidates, searchTerms } from './source-search.js';

let root: string;

function write(rel: string, text: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'arbora-search-'));
  write('app/components/Button.tsx', 'export function Button() { return <button className="fixture-button" />; }');
  write('app/components/Card.tsx', 'import { Button } from "./Button";\nexport const Card = () => <Button />;');
  write('app/page.tsx', 'export default function Page() { return null; }');
  write('app/globals.css', '.fixture-button { color: red }');
  write('app/notes.md', 'Button fixture-button');
  write('node_modules/lib/Button.js', 'export function Button() {}');
  write('.next/server/chunk.js', 'Button fixture-button');
  write('dist/out.js', 'Button fixture-button');
  write('src/ButtonGroup.tsx', 'export const ButtonGroup = 1;');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const component = (name: string, minified = false): ComponentEntry => ({
  name,
  minified,
  server: false,
  definedAt: null,
  renderedAt: null,
  rect: null,
});

const element = (classes: string[], uniqueClasses: string[]): ElementDescriptor => ({
  tag: 'button',
  id: null,
  classes,
  uniqueClasses,
  text: '',
  html: '',
  styles: {},
  rect: { x: 0, y: 0, width: 1, height: 1 },
});

describe('searchTerms', () => {
  it('uses the nearest readable component names and the first two unique classes', () => {
    expect(
      searchTerms({
        components: [component('Button'), component('t', true), component('Card'), component('App')],
        element: element(['px-4', 'fixture-button', 'x', 'other'], ['fixture-button', 'other', 'third']),
      }),
    ).toEqual([
      { text: 'Button', word: true },
      { text: 'Card', word: true },
      { text: 'fixture-button', word: false },
      { text: 'other', word: false },
    ]);
  });

  it('falls back to any classes and skips very short terms', () => {
    expect(searchTerms({ components: [], element: element(['ab', 'rounded-md'], []) })).toEqual([
      { text: 'rounded-md', word: false },
    ]);
  });
});

describe('findCandidates (Node fallback)', () => {
  it('ranks files by matched terms and component-named files, skipping dependencies and build output', async () => {
    const candidates = await findCandidates(
      root,
      [
        { text: 'Button', word: true },
        { text: 'fixture-button', word: false },
      ],
      { rg: null },
    );
    expect(candidates[0]).toEqual({
      path: join(root, 'app/components/Button.tsx'),
      relative: 'app/components/Button.tsx',
      matched: ['Button', 'fixture-button'],
    });
    const relatives = candidates.map((c) => c.relative);
    expect(relatives).toContain('app/components/Card.tsx');
    expect(relatives).toContain('app/globals.css');
    // Whole-word match only, and no docs, node_modules, dot-dirs or dist.
    expect(relatives).not.toContain('src/ButtonGroup.tsx');
    expect(relatives.some((r) => r.includes('node_modules') || r.startsWith('.next') || r.startsWith('dist'))).toBe(
      false,
    );
    expect(relatives).not.toContain('app/notes.md');
    expect(candidates.length).toBeLessThanOrEqual(CANDIDATE_LIMIT);
  });

  it('returns nothing without terms', async () => {
    expect(await findCandidates(root, [], { rg: null })).toEqual([]);
  });
});
