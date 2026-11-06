import { describe, expect, it } from 'vitest';
import {
  allowedMapUrl,
  decodeDataUrl,
  isGeneratedScript,
  originalFromMap,
  resolveMappingUrl,
  sourceMappingUrl,
} from './script-map.js';

const MAP = JSON.stringify({
  version: 3,
  file: 'app.js',
  sources: ['../src/App.tsx'],
  names: [],
  mappings: 'AAAA',
});

describe('script source maps', () => {
  it('keeps positions only for http scripts', () => {
    expect(isGeneratedScript('http://127.0.0.1:4173/assets/index-abc.js')).toBe(true);
    expect(isGeneratedScript('http://127.0.0.1:5173/src/App.tsx')).toBe(false);
    expect(isGeneratedScript('http://127.0.0.1:5173/src/App.tsx?t=1')).toBe(false);
    expect(isGeneratedScript('/tmp/app.js')).toBe(false);
  });

  it('reads a mapping comment and resolves it against the script', () => {
    const source = 'function Button(){return null;}\n//# sourceMappingURL=app.js.map\n';
    expect(sourceMappingUrl(source)).toBe('app.js.map');
    expect(sourceMappingUrl('var x = 1; /*# sourceMappingURL=inline.js.map */')).toBe('inline.js.map');
    expect(resolveMappingUrl('http://127.0.0.1:4173/assets/app.js', 'app.js.map')).toBe(
      'http://127.0.0.1:4173/assets/app.js.map',
    );
    expect(allowedMapUrl('http://127.0.0.1:4173/assets/app.js', 'http://127.0.0.1:4173/assets/app.js.map')).toBe(true);
    expect(allowedMapUrl('http://127.0.0.1:4173/assets/app.js', 'http://evil.example/app.js.map')).toBe(false);
    expect(allowedMapUrl('http://127.0.0.1:4173/assets/app.js', 'file:///etc/passwd')).toBe(false);
  });

  it('decodes an inlined map and maps a generated position onto the project file', () => {
    const data = `data:application/json;base64,${Buffer.from(MAP).toString('base64')}`;
    expect(decodeDataUrl(data)).toBe(MAP);
    const original = originalFromMap(MAP, 'http://127.0.0.1:4173/assets/app.js.map', 1, 1);
    expect(original).toEqual({ source: 'http://127.0.0.1:4173/src/App.tsx', line: 1, column: 1 });
    expect(originalFromMap('{', 'http://127.0.0.1/a.js.map', 1, 1)).toBeNull();
  });
});
