import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isProjectSource, resolveSource, sourcePathCandidates } from './source-paths.js';

// `resolve` adds the drive letter on Windows, as `fileURLToPath` does.
const ROOT = resolve('/work/app');
const at = (...parts: string[]) => join(ROOT, ...parts);

describe('sourcePathCandidates', () => {
  it('keeps absolute paths and drops query strings', () => {
    expect(sourcePathCandidates(at('src', 'App.tsx'), ROOT)[0]).toBe(at('src', 'App.tsx'));
    expect(sourcePathCandidates(`${pathToFileURL(at('src', 'App.tsx')).toString()}?t=1`, ROOT)).toEqual([
      at('src', 'App.tsx'),
    ]);
  });

  it('strips webpack and Next prefixes', () => {
    expect(sourcePathCandidates('webpack://_N_E/./src/components/Card.tsx', ROOT)).toEqual([
      at('src', 'components', 'Card.tsx'),
    ]);
    expect(sourcePathCandidates('webpack:///./src/a.ts', ROOT)).toEqual([at('src', 'a.ts')]);
    expect(sourcePathCandidates('webpack-internal:///(app-pages-browser)/./app/page.tsx', ROOT)).toEqual([
      at('app', 'page.tsx'),
    ]);
    expect(sourcePathCandidates('[project]/app/page.tsx [app-client] (ecmascript)', ROOT)).toEqual([
      at('app', 'page.tsx'),
    ]);
  });

  it('maps Vite URLs onto the project root, including /@fs/', () => {
    expect(sourcePathCandidates('http://localhost:5173/src/App.tsx?t=17', ROOT)).toEqual([at('src', 'App.tsx')]);
    expect(sourcePathCandidates('/src/App.tsx', ROOT)).toContain(at('src', 'App.tsx'));
    expect(sourcePathCandidates('http://localhost:5173/@fs/work/lib/x.ts', ROOT)).toEqual(['/work/lib/x.ts']);
    expect(sourcePathCandidates('http://localhost:5173/@fs/C:/work/x.ts', ROOT)).toEqual(['C:/work/x.ts']);
  });

  it('unwraps React server stack URLs and decodes them', () => {
    const url = `about://React/Server/${pathToFileURL(at('app', 'my page.tsx')).toString()}?42`;
    expect(sourcePathCandidates(url, ROOT)).toEqual([at('app', 'my page.tsx')]);
  });

  it('resolves relative paths against the root and ignores junk', () => {
    expect(sourcePathCandidates('./src/x.vue', ROOT)).toEqual([at('src', 'x.vue')]);
    expect(sourcePathCandidates('', ROOT)).toEqual([]);
    expect(sourcePathCandidates('http://[bad', ROOT)).toEqual([]);
  });
});

describe('isProjectSource', () => {
  it('accepts files inside the project and rejects node_modules, dot-dirs and outside paths', () => {
    expect(isProjectSource(at('src', 'a.ts'), ROOT)).toBe(true);
    expect(isProjectSource(at('.env.ts'), ROOT)).toBe(true);
    expect(isProjectSource(at('node_modules', 'x', 'a.js'), ROOT)).toBe(false);
    expect(isProjectSource(at('.next', 'dev', 'server', 'chunk.js'), ROOT)).toBe(false);
    expect(isProjectSource(resolve('/work/other/a.ts'), ROOT)).toBe(false);
    expect(isProjectSource(ROOT, ROOT)).toBe(false);
  });
});

describe('resolveSource', () => {
  it('returns the first existing candidate with a forward-slash relative path', () => {
    const exists = (path: string) => path === at('src', 'components', 'Card.tsx');
    expect(
      resolveSource({ file: 'http://localhost:5173/src/components/Card.tsx', line: 19, column: 9 }, ROOT, exists),
    ).toEqual({ path: at('src', 'components', 'Card.tsx'), relative: 'src/components/Card.tsx', line: 19, column: 9 });
  });

  it('returns null for missing files, chunk URLs and build output', () => {
    expect(resolveSource({ file: at('src', 'gone.tsx'), line: 1, column: 1 }, ROOT, () => false)).toBeNull();
    expect(
      resolveSource(
        { file: 'http://localhost:3000/_next/static/chunks/abc._.js', line: null, column: null },
        ROOT,
        () => false,
      ),
    ).toBeNull();
    expect(resolveSource({ file: at('.next', 'x.js'), line: null, column: null }, ROOT, () => true)).toBeNull();
    expect(resolveSource(null, ROOT, () => true)).toBeNull();
  });
});
