import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectEslintConfig,
  eslintDiagnostics,
  findTsconfig,
  groupByPath,
  parseTscOutput,
  tscArgs,
} from './diagnostics.js';

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'arbora-diag-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe('parseTscOutput', () => {
  it('parses errors with message chains and drops files outside the project', () => {
    const root = '/work/app';
    const output = [
      "src/App.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "  Type 'string' is not assignable to type 'number'.",
      '../shared/x.ts(1,1): error TS1005: whatever',
      'src/util.ts(3,10): warning TS6133: unused',
      'Found 2 errors.',
    ].join('\n');
    const diagnostics = parseTscOutput(output, root, root);
    expect(diagnostics).toEqual([
      {
        path: 'src/App.tsx',
        line: 12,
        column: 5,
        severity: 'error',
        message: "Type 'string' is not assignable to type 'number'.\nType 'string' is not assignable to type 'number'.",
        source: 'tsc',
        code: 'TS2322',
      },
      {
        path: 'src/util.ts',
        line: 3,
        column: 10,
        severity: 'warning',
        message: 'unused',
        source: 'tsc',
        code: 'TS6133',
      },
    ]);
  });
});

describe('eslintDiagnostics', () => {
  it('maps severities and drops the "file ignored" notice', () => {
    const diagnostics = eslintDiagnostics('src/a.js', [
      {
        line: 2,
        column: 1,
        endLine: 2,
        endColumn: 10,
        severity: 2,
        message: 'Unexpected debugger',
        ruleId: 'no-debugger',
      },
      { line: 4, column: 3, severity: 1, message: 'x is unused', ruleId: 'no-unused-vars' },
      { severity: 1, message: 'File ignored because no matching configuration was supplied.', ruleId: null },
    ]);
    expect(diagnostics).toEqual([
      {
        path: 'src/a.js',
        line: 2,
        column: 1,
        endLine: 2,
        endColumn: 10,
        severity: 'error',
        message: 'Unexpected debugger',
        source: 'eslint',
        code: 'no-debugger',
      },
      {
        path: 'src/a.js',
        line: 4,
        column: 3,
        severity: 'warning',
        message: 'x is unused',
        source: 'eslint',
        code: 'no-unused-vars',
      },
    ]);
  });
});

describe('detectEslintConfig', () => {
  it('prefers flat configs and recognises legacy ones', () => {
    expect(detectEslintConfig(project({ 'eslint.config.mjs': '' }))?.kind).toBe('flat');
    expect(detectEslintConfig(project({ '.eslintrc.json': '{}' }))?.kind).toBe('legacy');
    expect(detectEslintConfig(project({ 'package.json': '{"eslintConfig":{"rules":{}}}' }))?.kind).toBe('legacy');
    expect(detectEslintConfig(project({ 'package.json': '{}' }))).toBeNull();
  });
});

describe('tsconfig lookup', () => {
  it('finds the nearest tsconfig and uses --build for project references', () => {
    const root = project({
      'tsconfig.json': '{ "files": [], "references": [ { "path": "./packages/a" } ] }',
      'packages/a/tsconfig.json': '{ "compilerOptions": {} }',
      'packages/a/src/x.ts': '',
      'scripts/y.ts': '',
    });
    expect(findTsconfig(root, 'packages/a/src/x.ts')).toBe(join(root, 'packages/a/tsconfig.json'));
    expect(findTsconfig(root, 'scripts/y.ts')).toBe(join(root, 'tsconfig.json'));
    expect(tscArgs(join(root, 'tsconfig.json'))[0]).toBe('--build');
    expect(tscArgs(join(root, 'packages/a/tsconfig.json'))).toEqual([
      '--noEmit',
      '-p',
      join(root, 'packages/a/tsconfig.json'),
      '--pretty',
      'false',
    ]);
  });
});

describe('groupByPath', () => {
  it('clears files that had diagnostics last time', () => {
    const grouped = groupByPath(
      [{ path: 'a.ts', line: 1, column: 1, severity: 'error', message: 'x', source: 'tsc' }],
      new Set(['b.ts']),
    );
    expect([...grouped.keys()].sort()).toEqual(['a.ts', 'b.ts']);
    expect(grouped.get('b.ts')).toEqual([]);
  });
});
