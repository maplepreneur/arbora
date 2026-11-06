import { describe, expect, it } from 'vitest';
import { parseSkillFrontmatter, pickSkillDir, skillSourceSchema, skillTargetPaths } from './skills.js';

describe('parseSkillFrontmatter', () => {
  it('reads name and description', () => {
    expect(parseSkillFrontmatter('---\nname: react-tips\ndescription: "Use for React work."\n---\n# Body')).toEqual({
      name: 'react-tips',
      description: 'Use for React work.',
    });
  });

  it('joins folded and continued descriptions', () => {
    const text = '---\nname: a\ndescription: >\n  First line\n  second line\nlicense: MIT\n---\n';
    expect(parseSkillFrontmatter(text)).toEqual({ name: 'a', description: 'First line second line' });
  });

  it('returns no name without front matter', () => {
    expect(parseSkillFrontmatter('# Just markdown')).toEqual({ name: null, description: '' });
  });
});

describe('pickSkillDir', () => {
  const candidates = [
    { dir: '/r/skills/alpha', name: 'alpha' },
    { dir: '/r/skills/beta-folder', name: 'beta' },
    { dir: '/r/skills/gamma', name: null },
  ];

  it('prefers the front matter name, then the folder name', () => {
    expect(pickSkillDir(candidates, 'beta')).toBe('/r/skills/beta-folder');
    expect(pickSkillDir(candidates, 'GAMMA')).toBe('/r/skills/gamma');
    expect(pickSkillDir(candidates, 'missing')).toBeUndefined();
  });

  it('takes the only skill of a single-skill repository', () => {
    expect(pickSkillDir([{ dir: '/r', name: 'other' }], 'whatever')).toBe('/r');
  });
});

describe('skillTargetPaths', () => {
  const home = '/home/me';

  it('follows the skills CLI folders', () => {
    expect(skillTargetPaths('claude', { home, env: {} }).skills).toBe('/home/me/.claude/skills');
    expect(skillTargetPaths('agents', { home, env: {} }).skills).toBe('/home/me/.agents/skills');
    expect(skillTargetPaths('opencode', { home, env: {} }).skills).toBe('/home/me/.config/opencode/skills');
    expect(skillTargetPaths('grok', { home, env: {} }).root).toBe('/home/me/.grok');
    expect(skillTargetPaths('antigravity', { home, env: {} })).toEqual({
      root: '/home/me/.gemini/antigravity-cli',
      skills: '/home/me/.gemini/config/skills',
    });
  });

  it('honours the agents’ home overrides', () => {
    expect(skillTargetPaths('claude', { home, env: { CLAUDE_CONFIG_DIR: '/cfg/claude' } }).skills).toBe(
      '/cfg/claude/skills',
    );
    expect(skillTargetPaths('opencode', { home, env: { XDG_CONFIG_HOME: '/x' } }).skills).toBe('/x/opencode/skills');
  });

  it('keeps Windows separators', () => {
    expect(skillTargetPaths('cursor', { home: 'C:\\Users\\me', env: {} }).skills).toBe(
      'C:\\Users\\me\\.cursor\\skills',
    );
  });
});

describe('skillSourceSchema', () => {
  it('accepts owner/repo only', () => {
    expect(skillSourceSchema.safeParse('vercel-labs/agent-skills').success).toBe(true);
    expect(skillSourceSchema.safeParse('../etc').success).toBe(false);
    expect(skillSourceSchema.safeParse('a/..').success).toBe(false);
    expect(skillSourceSchema.safeParse('https://evil/x').success).toBe(false);
  });
});
