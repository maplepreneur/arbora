import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { checkedAgents, DESKTOP_ROOT, launch, tempUserData } from './app';

const FAKE_AGENT = join(DESKTOP_ROOT, '../../packages/acp-client/src/testing/fake-agent.ts');

function writeSkill(dir: string, name: string, description: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`);
}

/** A home folder with Claude Code "installed", one skill of its own, and a git remote for installs. */
function skillsHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'arbora-e2e-home-'));
  writeSkill(join(home, '.claude', 'skills', 'my-notes'), 'my-notes', 'Hand-written notes skill.');
  const repo = join(home, 'remote', 'acme', 'agent-skills.git');
  writeSkill(join(repo, 'skills', 'react-tips'), 'react-tips', 'Tips for React components.');
  writeSkill(join(repo, 'skills', 'other'), 'other', 'Not this one.');
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  };
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.email=e2e@arbora', '-c', 'user.name=e2e', 'commit', '-qm', 'skills');
  return home;
}

/** Stands in for https://skills.sh/api/search. */
async function searchServer(): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    const query = new URL(request.url ?? '/', 'http://x').searchParams.get('q') ?? '';
    const skills = /react/i.test(query)
      ? [
          {
            id: 'acme/agent-skills/react-tips',
            source: 'acme/agent-skills',
            skillId: 'react-tips',
            name: 'react-tips',
            installs: 48_200,
          },
        ]
      : [];
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ query, skills, count: skills.length }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return { url: `http://127.0.0.1:${address.port}/api/search`, server };
}

test.describe('Skills and MCP servers', () => {
  test('searches skills.sh, installs and links a skill, adopts one, and passes MCP servers to agents', async () => {
    const home = skillsHome();
    const search = await searchServer();
    const userData = tempUserData();
    writeFileSync(
      join(userData, 'settings.json'),
      JSON.stringify({
        version: 3,
        agents: {
          custom: [{ id: 'fake', name: 'Fake agent', command: process.execPath, args: [FAKE_AGENT], env: {} }],
          ...checkedAgents(['fake']),
        },
      }),
    );
    const project = mkdtempSync(join(tmpdir(), 'arbora-e2e-skills-project-'));
    writeFileSync(join(project, 'package.json'), '{"name":"skills-e2e"}\n');
    const { app, page } = await launch(userData, [project], {
      ARBORA_SKILLS_HOME: home,
      ARBORA_SKILLS_API: search.url,
      ARBORA_SKILLS_GIT_BASE: `${home}/remote/`,
      // These move agents' folders out of `home`, and CI sets XDG_CONFIG_HOME (GitHub's Ubuntu image does).
      XDG_CONFIG_HOME: '',
      CLAUDE_CONFIG_DIR: '',
      GROK_HOME: '',
    });
    try {
      await page.keyboard.press('ControlOrMeta+,');
      await page.getByTestId('settings-nav-skills').click();
      await expect(page.getByTestId('skills-settings')).toBeVisible();
      await expect(page.getByTestId('skill-found-my-notes')).toContainText('Claude Code');

      // Search and install: the skill lands in the library and is linked for the installed agent.
      await page.getByTestId('skills-search').fill('react');
      await expect(page.getByTestId('skills-result')).toContainText('48.2k installs');
      await page.getByTestId('skills-install-react-tips').click();
      const row = page.getByTestId('skill-react-tips');
      await expect(row).toContainText('Tips for React components.');
      await expect(row).toContainText('acme/agent-skills');
      await expect(page.getByTestId('skill-link-react-tips-claude')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('skill-link-react-tips-agents')).toHaveAttribute('aria-pressed', 'false');
      expect(lstatSync(join(home, '.claude', 'skills', 'react-tips')).isSymbolicLink()).toBe(true);
      await expect(page.getByTestId('skills-install-react-tips')).toContainText('Update');

      // Turn it on for Codex and Kimi (~/.agents/skills), then for every agent.
      await page.getByTestId('skill-link-react-tips-agents').click();
      await expect(page.getByTestId('skill-link-react-tips-agents')).toHaveAttribute('aria-pressed', 'true');
      expect(readFileSync(join(home, '.agents', 'skills', 'react-tips', 'SKILL.md'), 'utf8')).toContain('react-tips');
      await page.getByTestId('skill-all-react-tips').click();
      await expect(page.getByTestId('skill-link-react-tips-opencode')).toHaveAttribute('aria-pressed', 'true');
      expect(lstatSync(join(home, '.config', 'opencode', 'skills', 'react-tips')).isSymbolicLink()).toBe(true);

      // A skill Claude Code already had moves into the library and stays linked for Claude.
      await page.getByTestId('skill-adopt-my-notes').click();
      await expect(page.getByTestId('skill-my-notes')).toBeVisible();
      await expect(page.getByTestId('skill-link-my-notes-claude')).toHaveAttribute('aria-pressed', 'true');
      expect(lstatSync(join(home, '.arbora', 'skills', 'my-notes')).isDirectory()).toBe(true);
      expect(lstatSync(join(home, '.claude', 'skills', 'my-notes')).isSymbolicLink()).toBe(true);

      // MCP: import Claude Code's servers, add one by hand, and the agent gets both.
      writeFileSync(
        join(home, '.claude.json'),
        JSON.stringify({ mcpServers: { 'from-claude': { command: 'npx', args: ['-y', 'some-mcp'] } } }),
      );
      await page.getByTestId('settings-nav-mcp').click();
      await page.getByTestId('mcp-import-scan').click();
      await expect(page.getByTestId('mcp-importable')).toContainText('Claude Code');
      await page.getByTestId('mcp-import-from-claude').click();
      await expect(page.getByTestId('mcp-server-from-claude')).toContainText('npx -y some-mcp');

      await page.getByTestId('mcp-add').click();
      await page.getByTestId('mcp-form-name').fill('docs');
      await page.getByTestId('mcp-form-command').fill('node "/opt/docs server/index.js" --stdio');
      await page.getByTestId('mcp-form-env').fill('DOCS_TOKEN=abc');
      await page.getByTestId('mcp-form-save').click();
      await expect(page.getByTestId('mcp-server-docs')).toContainText('node "/opt/docs server/index.js" --stdio');
      await expect
        .poll(() => {
          const saved = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as {
            mcpServers?: { name: string; args: string[]; env: Record<string, string> }[];
          };
          return saved.mcpServers?.map((server) => [server.name, server.args, server.env]);
        })
        .toEqual([
          ['from-claude', ['-y', 'some-mcp'], {}],
          ['docs', ['/opt/docs server/index.js', '--stdio'], { DOCS_TOKEN: 'abc' }],
        ]);
      await page.getByTestId('mcp-enabled-from-claude').click();
      await expect(page.getByTestId('mcp-enabled-from-claude')).toHaveAttribute('aria-checked', 'false');

      await page.getByTestId('settings-close').click();
      await page.getByTestId('new-thread-choose').click();
      await page.getByTestId('pick-agent-fake').click();
      await expect(page.getByTestId('thread-view')).toHaveAttribute('data-thread-status', 'ready', { timeout: 20_000 });
      const input = page.getByTestId('composer-input');
      await input.fill('list mcp servers');
      await input.press('Enter');
      const reply = page.getByTestId('agent-message').last();
      await expect(reply).toContainText('docs (not connected)', { timeout: 20_000 });
      await expect(reply).toContainText('arbora-browser');
      await expect(reply).not.toContainText('from-claude');
    } finally {
      await app.close();
      search.server.close();
    }
  });
});
