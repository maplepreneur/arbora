import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from './fuzzy.js';

const PATHS = [
  'src/App.tsx',
  'src/components/Button.tsx',
  'src/components/Card.tsx',
  'src/main.tsx',
  'docs/application-notes.md',
  'packages/shared/src/app-state.ts',
  'node_modules/react/index.js',
];

describe('fuzzyScore', () => {
  it('needs every query character in order', () => {
    expect(fuzzyScore('btn', 'src/components/Button.tsx')).not.toBeNull();
    expect(fuzzyScore('tsxsrc', 'src/components/Button.tsx')).toBeNull();
  });

  it('ignores case and spaces', () => {
    expect(fuzzyScore('CARD tsx', 'src/components/Card.tsx')).not.toBeNull();
  });

  it('reports the matched positions', () => {
    const result = fuzzyScore('app', 'src/App.tsx');
    expect(result?.positions).toEqual([4, 5, 6]);
  });

  it('prefers word-boundary matches for the positions', () => {
    // "ct" should pick the C of Card (after "/") rather than the c of "components".
    const result = fuzzyScore('cardt', 'src/components/Card.tsx');
    expect(result?.positions[0]).toBe(15);
  });

  it('matches everything with an empty query', () => {
    expect(fuzzyScore('  ', 'anything')).toEqual({ path: 'anything', score: 0, positions: [] });
  });
});

describe('fuzzyFilter', () => {
  it('ranks file-name matches above scattered ones', () => {
    const [first] = fuzzyFilter('app', PATHS);
    expect(first?.path).toBe('src/App.tsx');
  });

  it('ranks consecutive runs above gaps', () => {
    const results = fuzzyFilter('card', PATHS).map((r) => r.path);
    expect(results[0]).toBe('src/components/Card.tsx');
  });

  it('keeps the given order for an empty query and honours the limit', () => {
    expect(fuzzyFilter('', PATHS, 2).map((r) => r.path)).toEqual(['src/App.tsx', 'src/components/Button.tsx']);
  });

  it('drops non-matches', () => {
    expect(fuzzyFilter('zzz', PATHS)).toEqual([]);
  });

  it('filters 10k paths quickly', () => {
    const many: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      many.push(`packages/module-${i % 97}/src/components/feature-${i}/FeatureComponent${i}.tsx`);
    }
    const started = performance.now();
    const results = fuzzyFilter('feat123comp', many);
    const elapsed = performance.now() - started;
    expect(results.length).toBeGreaterThan(0);
    // The acceptance target is 100 ms in the app; leave headroom for slow CI machines.
    expect(elapsed).toBeLessThan(400);
  });
});
