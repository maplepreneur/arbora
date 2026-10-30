import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { searchQuerySchema, type SearchMatch } from '@arbora/shared';
import { walkFiles } from './file-index.js';
import { IgnoreRules } from './ignore-rules.js';
import {
  globFilter,
  parseRipgrepJson,
  preview,
  queryRegExp,
  ripgrepSearchArgs,
  searchWithNode,
  searchWithRipgrep,
  type SearchCallbacks,
} from './text-search.js';

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'arbora-search-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function systemRipgrep(): string | null {
  try {
    execFileSync('rg', ['--version'], { stdio: 'ignore' });
    return 'rg';
  } catch {
    return null;
  }
}

function collect(
  start: (callbacks: SearchCallbacks) => void,
): Promise<{ matches: SearchMatch[]; total: number; truncated: boolean; error?: string }> {
  return new Promise((resolve) => {
    const matches: SearchMatch[] = [];
    start({
      matches: (batch) => matches.push(...batch),
      done: (result) => resolve({ matches, ...result }),
    });
  });
}

const FILES = {
  '.gitignore': 'generated/\n',
  'src/App.tsx': 'export function App() {\n  return <Card title="Hello" />;\n}\n',
  'src/Card.tsx': 'export const Card = () => null; // Card component\n',
  'generated/out.ts': 'Card\n',
  'node_modules/lib/index.js': 'Card\n',
  'README.md': 'A card list.\n',
};

describe('parseRipgrepJson', () => {
  it('converts byte offsets to UTF-16 columns', () => {
    const line = JSON.stringify({
      type: 'match',
      data: {
        path: { text: './src/ü.ts' },
        lines: { text: 'const é = "Card";\n' },
        line_number: 3,
        submatches: [{ match: { text: 'Card' }, start: 13, end: 17 }],
      },
    });
    expect(parseRipgrepJson(line)).toEqual([
      { path: 'src/ü.ts', line: 3, column: 13, length: 4, preview: 'const é = "Card";', previewStart: 12 },
    ]);
  });

  it('ignores other message types and junk', () => {
    expect(parseRipgrepJson('{"type":"begin","data":{}}')).toEqual([]);
    expect(parseRipgrepJson('not json')).toEqual([]);
  });
});

describe('preview', () => {
  it('trims long lines around the match', () => {
    const line = `${'x'.repeat(100)}MATCH${'y'.repeat(300)}`;
    const result = preview(line, 100, 5);
    expect(result.preview.startsWith('…')).toBe(true);
    expect(result.preview.slice(result.previewStart, result.previewStart + 5)).toBe('MATCH');
    expect(result.preview.length).toBeLessThan(220);
  });
});

describe('query options', () => {
  it('builds ripgrep arguments', () => {
    const args = ripgrepSearchArgs(
      searchQuerySchema.parse({ query: 'a.b', wholeWord: true, include: 'src/**', exclude: '*.md, docs' }),
    );
    expect(args).toEqual(
      expect.arrayContaining([
        '--fixed-strings',
        '--word-regexp',
        '--ignore-case',
        '--glob',
        'src/**',
        '!*.md',
        '!docs',
      ]),
    );
    expect(args.slice(-3)).toEqual(['--', 'a.b', '.']);
  });

  it('builds a RegExp or reports an invalid one', () => {
    expect(queryRegExp(searchQuerySchema.parse({ query: 'a.b' })).toString()).toBe('/a\\.b/gi');
    expect(typeof queryRegExp(searchQuerySchema.parse({ query: '(', isRegex: true }))).toBe('string');
  });

  it('filters by include and exclude globs', () => {
    const accept = globFilter(searchQuerySchema.parse({ query: 'x', include: 'src/**', exclude: '*.test.ts' }));
    expect(accept('src/a.ts')).toBe(true);
    expect(accept('src/a.test.ts')).toBe(false);
    expect(accept('lib/a.ts')).toBe(false);
  });
});

describe('searchWithNode', () => {
  it('finds matches in non-ignored files', async () => {
    const root = project(FILES);
    const rules = new IgnoreRules(root);
    const result = await collect((callbacks) =>
      searchWithNode(
        root,
        async () => (await walkFiles(root, rules, 1000)).files,
        searchQuerySchema.parse({ query: 'card' }),
        callbacks,
      ),
    );
    expect(result.matches.map((m) => `${m.path}:${m.line}:${m.column}`).sort()).toEqual([
      'README.md:1:3',
      'src/App.tsx:2:11',
      'src/Card.tsx:1:14',
      'src/Card.tsx:1:36',
    ]);
    expect(result.truncated).toBe(false);
  });

  it('stops at maxResults and reports an invalid regex', async () => {
    const root = project(FILES);
    const rules = new IgnoreRules(root);
    const files = async (): Promise<string[]> => (await walkFiles(root, rules, 1000)).files;
    const limited = await collect((callbacks) =>
      searchWithNode(root, files, searchQuerySchema.parse({ query: 'card', maxResults: 2 }), callbacks),
    );
    expect(limited.total).toBe(2);
    expect(limited.truncated).toBe(true);
    const invalid = await collect((callbacks) =>
      searchWithNode(root, files, searchQuerySchema.parse({ query: '(', isRegex: true }), callbacks),
    );
    expect(invalid.error).toBeTruthy();
  });
});

const rg = systemRipgrep();
describe.skipIf(!rg)('searchWithRipgrep', () => {
  it('matches the Node fallback on the same project', async () => {
    const root = project(FILES);
    const result = await collect((callbacks) =>
      searchWithRipgrep(rg ?? 'rg', root, searchQuerySchema.parse({ query: 'Card', matchCase: true }), callbacks),
    );
    expect(result.matches.map((m) => `${m.path}:${m.line}:${m.column}`).sort()).toEqual([
      'src/App.tsx:2:11',
      'src/Card.tsx:1:14',
      'src/Card.tsx:1:36',
    ]);
  });

  it('reports an invalid regex', async () => {
    const root = project(FILES);
    const result = await collect((callbacks) =>
      searchWithRipgrep(rg ?? 'rg', root, searchQuerySchema.parse({ query: '(', isRegex: true }), callbacks),
    );
    expect(result.error).toBeTruthy();
  });
});
