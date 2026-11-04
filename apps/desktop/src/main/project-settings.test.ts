import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARBORA_GITIGNORE, ensureArboraGitignore, ensureProjectSettingsFile } from './project-settings.js';

describe('ensureArboraGitignore', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'arbora-project-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('does not create .arbora unless asked', () => {
    ensureArboraGitignore(root);
    expect(existsSync(join(root, '.arbora'))).toBe(false);
  });

  it('ignores everything in an existing .arbora folder', () => {
    mkdirSync(join(root, '.arbora'));
    ensureArboraGitignore(root);
    const text = readFileSync(join(root, '.arbora', '.gitignore'), 'utf8');
    expect(text).toBe(ARBORA_GITIGNORE);
    expect(text.split('\n')).toContain('*');
  });

  it('creates the folder when asked', () => {
    ensureArboraGitignore(root, true);
    expect(existsSync(join(root, '.arbora', '.gitignore'))).toBe(true);
  });

  it('leaves a user-written .gitignore alone', () => {
    mkdirSync(join(root, '.arbora'));
    writeFileSync(join(root, '.arbora', '.gitignore'), '*\n!project.json\n');
    ensureArboraGitignore(root);
    expect(readFileSync(join(root, '.arbora', '.gitignore'), 'utf8')).toBe('*\n!project.json\n');
  });

  it('is written along with a new project.json', () => {
    ensureProjectSettingsFile(root);
    expect(existsSync(join(root, '.arbora', '.gitignore'))).toBe(true);
  });
});
