import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IgnoreRules } from './ignore-rules.js';

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'arbora-ignore-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe('IgnoreRules', () => {
  it('always ignores node_modules, .git and build output folders', () => {
    const rules = new IgnoreRules(project({}));
    expect(rules.ignores('node_modules', true)).toBe(true);
    expect(rules.ignores('packages/a/node_modules/react/index.js', false)).toBe(true);
    expect(rules.ignores('dist', true)).toBe(true);
    expect(rules.ignores('.next', true)).toBe(true);
    expect(rules.ignores('src/dist.ts', false)).toBe(false);
  });

  it('applies the root .gitignore, including folder-only patterns', () => {
    const rules = new IgnoreRules(project({ '.gitignore': '*.log\ncoverage/\n!keep.log\n' }));
    expect(rules.ignores('debug.log', false)).toBe(true);
    expect(rules.ignores('keep.log', false)).toBe(false);
    expect(rules.ignores('coverage', true)).toBe(true);
    expect(rules.ignores('coverage/index.html', false)).toBe(true);
    expect(rules.ignores('coverage', false)).toBe(false);
  });

  it('applies nested .gitignore files relative to their folder', () => {
    const rules = new IgnoreRules(project({ 'packages/web/.gitignore': 'generated\n/local.txt\n' }));
    expect(rules.ignores('packages/web/generated', true)).toBe(true);
    expect(rules.ignores('packages/web/src/generated', true)).toBe(true);
    expect(rules.ignores('packages/web/local.txt', false)).toBe(true);
    expect(rules.ignores('local.txt', false)).toBe(false);
    expect(rules.ignores('packages/other/generated', true)).toBe(false);
  });

  it('reads .git/info/exclude and picks up changes after invalidate', () => {
    const root = project({ '.git/info/exclude': 'secret.txt\n' });
    const rules = new IgnoreRules(root);
    expect(rules.ignores('secret.txt', false)).toBe(true);
    expect(rules.ignores('notes.md', false)).toBe(false);
    writeFileSync(join(root, '.gitignore'), 'notes.md\n');
    expect(rules.ignores('notes.md', false)).toBe(false);
    rules.invalidate();
    expect(rules.ignores('notes.md', false)).toBe(true);
  });
});
