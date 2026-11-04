import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkillLibrary } from './skill-library.js';

function writeSkill(dir: string, name: string, description = `About ${name}`): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`);
}

describe('SkillLibrary', () => {
  let home: string;
  let library: SkillLibrary;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'arbora-skills-'));
    mkdirSync(join(home, '.claude'));
    library = new SkillLibrary({
      home,
      platform: process.platform,
      env: () => Promise.resolve({ ...process.env, XDG_CONFIG_HOME: '', CLAUDE_CONFIG_DIR: '', GROK_HOME: '' }),
      gitBase: `${home}/remote/`,
    });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('lists targets with whether the agent is installed', async () => {
    const state = await library.list();
    expect(state.libraryPath).toBe(join(home, '.arbora', 'skills'));
    expect(state.skills).toEqual([]);
    expect(state.targets.find((t) => t.id === 'claude')).toMatchObject({
      installed: true,
      path: join(home, '.claude', 'skills'),
    });
    expect(state.targets.find((t) => t.id === 'grok')?.installed).toBe(false);
  });

  it('links a library skill into chosen agents and unlinks it again', async () => {
    writeSkill(join(home, '.arbora', 'skills', 'tidy'), 'tidy');
    let state = await library.setTargets('tidy', ['claude', 'agents']);
    expect(state.skills[0]).toMatchObject({ name: 'tidy', description: 'About tidy' });
    expect(state.skills[0]?.links).toMatchObject({ claude: 'linked', agents: 'linked', grok: 'none' });
    expect(lstatSync(join(home, '.claude', 'skills', 'tidy')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(home, '.agents', 'skills', 'tidy', 'SKILL.md'), 'utf8')).toContain('name: tidy');

    state = await library.setTargets('tidy', ['agents']);
    expect(state.skills[0]?.links.claude).toBe('none');
    expect(existsSync(join(home, '.claude', 'skills', 'tidy'))).toBe(false);
    expect(existsSync(join(home, '.arbora', 'skills', 'tidy', 'SKILL.md'))).toBe(true);
  });

  it('never replaces a different folder of the same name', async () => {
    writeSkill(join(home, '.arbora', 'skills', 'tidy'), 'tidy');
    writeSkill(join(home, '.claude', 'skills', 'tidy'), 'tidy', 'Hand-written');
    const state = await library.list();
    expect(state.skills[0]?.links.claude).toBe('other');
    await expect(library.setTargets('tidy', ['claude'])).rejects.toThrow(/already exists/);
    expect(readFileSync(join(home, '.claude', 'skills', 'tidy', 'SKILL.md'), 'utf8')).toContain('Hand-written');
  });

  it('adopts a skill from an agent folder and links it back', async () => {
    writeSkill(join(home, '.claude', 'skills', 'mine'), 'mine');
    mkdirSync(join(home, '.agents', 'skills'), { recursive: true });
    symlinkSync(join(home, '.claude', 'skills', 'mine'), join(home, '.agents', 'skills', 'mine'), 'dir');
    let state = await library.list();
    expect(state.found).toEqual([{ name: 'mine', description: 'About mine', targets: ['claude', 'agents'] }]);

    state = await library.adopt('mine');
    expect(state.found).toEqual([]);
    expect(state.skills[0]?.links).toMatchObject({ claude: 'linked', agents: 'linked', grok: 'none' });
    expect(lstatSync(join(home, '.arbora', 'skills', 'mine')).isDirectory()).toBe(true);
    expect(lstatSync(join(home, '.claude', 'skills', 'mine')).isSymbolicLink()).toBe(true);
  });

  it('removes a skill from every agent and the library', async () => {
    writeSkill(join(home, '.arbora', 'skills', 'gone'), 'gone');
    await library.setTargets('gone', ['claude', 'cursor']);
    const state = await library.remove('gone');
    expect(state.skills).toEqual([]);
    expect(existsSync(join(home, '.claude', 'skills', 'gone'))).toBe(false);
    expect(existsSync(join(home, '.cursor', 'skills', 'gone'))).toBe(false);
  });

  it('installs a skill from its repository and remembers the source', async () => {
    const repo = join(home, 'remote', 'acme', 'skills.git');
    writeSkill(join(repo, 'skills', 'react-tips'), 'react-tips');
    writeSkill(join(repo, 'skills', 'other'), 'other');
    writeFileSync(join(repo, 'skills', 'react-tips', 'extra.md'), 'more');
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    };
    git('init', '-q');
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'skills');

    const state = await library.install('acme/skills', 'react-tips', ['claude']);
    expect(state.skills.map((skill) => [skill.name, skill.source, skill.links.claude])).toEqual([
      ['react-tips', 'acme/skills/react-tips', 'linked'],
    ]);
    expect(readFileSync(join(home, '.arbora', 'skills', 'react-tips', 'extra.md'), 'utf8')).toBe('more');
    await expect(library.install('acme/skills', 'missing', [])).rejects.toThrow(/No SKILL.md for missing/);
  });

  it('searches skills.sh', async () => {
    const urls: string[] = [];
    const search = new SkillLibrary({
      home,
      platform: process.platform,
      env: () => Promise.resolve({}),
      fetch: (input) => {
        urls.push(input instanceof Request ? input.url : input.toString());
        return Promise.resolve(
          new Response(
            JSON.stringify({
              skills: [{ id: 'a/b/c', source: 'a/b', skillId: 'c', name: 'c', installs: 12 }],
            }),
          ),
        );
      },
    });
    expect(await search.search('react')).toEqual([
      { id: 'a/b/c', source: 'a/b', skillId: 'c', name: 'c', installs: 12 },
    ]);
    expect(urls[0]).toBe('https://skills.sh/api/search?q=react&limit=30');
  });
});
