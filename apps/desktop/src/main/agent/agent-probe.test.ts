import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '@arbora/shared';
import { probeAgent } from './agent-probe.js';
import { runAgentTask } from './agent-task.js';

const agent = (patch: Partial<AgentDefinition>): AgentDefinition => ({
  id: 'fake',
  name: 'Fake agent',
  command: process.execPath,
  args: [],
  env: {},
  builtIn: true,
  probe: [],
  task: [],
  ...patch,
});

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbora-probe-'));
  writeFileSync(join(dir, 'package.json'), '{}');
  return dir;
}

describe('probeAgent', () => {
  it('reports a missing command without spawning anything', async () => {
    const result = await probeAgent({
      agent: agent({ command: 'definitely-not-a-command-xyz' }),
      platform: 'linux',
      cwd: tempProject(),
      env: {},
      lookup: () => undefined,
      now: () => 1,
    });
    expect(result.status).toBe('missing');
  });

  it('runs the version command and records its first line', async () => {
    const result = await probeAgent({
      agent: agent({ probe: ['-e', 'console.log("FakeAgent 9.9.9")'] }),
      platform: 'linux',
      cwd: tempProject(),
      env: {},
      lookup: (command) => command,
      now: () => 1,
    });
    expect(result).toMatchObject({ status: 'ready', version: 'FakeAgent 9.9.9' });
  });

  it('records a failed version command', async () => {
    const result = await probeAgent({
      agent: agent({ probe: ['-e', 'console.error("nope"); process.exit(7)'] }),
      platform: 'linux',
      cwd: tempProject(),
      env: {},
      lookup: (command) => command,
      now: () => 1,
    });
    expect(result.status).toBe('error');
    expect(result.error).toContain('code 7');
  });
});

describe('runAgentTask', () => {
  it('refuses agents without a one-off command', async () => {
    await expect(
      runAgentTask({
        agent: agent({ task: [] }),
        platform: 'linux',
        projectPath: tempProject(),
        env: {},
        lookup: (command) => command,
        prompt: 'hi',
      }),
    ).rejects.toThrow(/cannot run one-off tasks/);
  });

  it('runs the prompt through the task args and returns the reply', async () => {
    const result = await runAgentTask({
      agent: agent({ task: ['-e', 'console.log("answer: " + process.argv[1])', '--'] }),
      platform: 'linux',
      projectPath: tempProject(),
      env: {},
      lookup: (command) => command,
      prompt: 'make a commit message',
    });
    expect(result).toContain('answer: make a commit message');
  });

  it('reports a failed task', async () => {
    await expect(
      runAgentTask({
        agent: agent({ task: ['-e', 'console.error("boom"); process.exit(5)'] }),
        platform: 'linux',
        projectPath: tempProject(),
        env: {},
        lookup: (command) => command,
        prompt: 'x',
      }),
    ).rejects.toThrow(/exited with code 5/);
  });
});
