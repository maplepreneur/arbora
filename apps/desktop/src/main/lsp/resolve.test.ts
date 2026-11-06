import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveTypeScriptLsp } from './resolve.js';

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'arbora-lsp-'));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

describe('resolveTypeScriptLsp', () => {
  it('uses the project TypeScript and its language server', () => {
    const root = project({
      'node_modules/typescript/lib/tsserver.js': '',
      'node_modules/typescript-language-server/lib/cli.mjs': '',
    });
    expect(resolveTypeScriptLsp(root)).toEqual({
      cli: join(root, 'node_modules/typescript-language-server/lib/cli.mjs'),
      tsserver: join(root, 'node_modules/typescript/lib/tsserver.js'),
    });
  });

  it('says which package is missing', () => {
    const typed = project({ 'node_modules/typescript/lib/tsserver.js': '' });
    expect(resolveTypeScriptLsp(typed)).toEqual({
      error: 'Install typescript-language-server in this project to turn the language server on.',
    });
    expect(resolveTypeScriptLsp(project({}))).toEqual({
      error: 'This project has no TypeScript in node_modules. The language server uses that copy.',
    });
  });
});
