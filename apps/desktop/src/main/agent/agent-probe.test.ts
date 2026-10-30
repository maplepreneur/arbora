import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { FAKE_AGENT_PATH } from '@arbora/acp-client';
import { toPlatform, type AgentDefinition } from '@arbora/shared';
import { modelChoices, probeAgent } from './agent-probe.js';

function fake(env: Record<string, string> = {}): AgentDefinition {
  return { id: 'fake', name: 'Fake agent', command: process.execPath, args: [FAKE_AGENT_PATH], env, builtIn: false };
}

function probe(agent: AgentDefinition, lookup: (command: string) => string | undefined = (c) => c) {
  return probeAgent({
    agent,
    platform: toPlatform(process.platform),
    cwd: tmpdir(),
    env: { ...process.env } as Record<string, string>,
    lookup,
    now: () => 42,
    timeoutMs: 20_000,
  });
}

describe('probeAgent', () => {
  it('reports a signed-in agent with its models', async () => {
    const result = await probe(fake());
    expect(result).toMatchObject({
      status: 'ready',
      checkedAt: 42,
      models: [
        { value: 'fast', name: 'Fast' },
        { value: 'smart', name: 'Smart' },
      ],
    });
  });

  it('reports an agent that asks for a login, and one that is not installed', async () => {
    expect((await probe(fake({ FAKE_AGENT_AUTH: '1' }))).status).toBe('auth_required');
    expect((await probe(fake(), () => undefined)).status).toBe('missing');
  });

  it('flattens grouped model choices', () => {
    expect(
      modelChoices([
        {
          type: 'select',
          id: 'model',
          name: 'Model',
          category: 'model',
          currentValue: 'a',
          options: [{ group: 'free', name: 'Free', options: [{ value: 'a', name: 'A' }] }],
        },
      ]),
    ).toEqual([{ value: 'a', name: 'A' }]);
  });
});
