import { describe, expect, it } from 'vitest';
import { AgentRegistry, BUILT_IN_AGENTS } from './registry.js';

describe('BUILT_IN_AGENTS', () => {
  it('defines the five built-in agents with the verified launch commands', () => {
    const byId = Object.fromEntries(BUILT_IN_AGENTS.map((a) => [a.id, a]));
    expect(Object.keys(byId).sort()).toEqual(['claude-code', 'codex', 'grok', 'kimi', 'opencode']);
    expect(byId['claude-code']).toMatchObject({
      command: 'npx',
      args: ['-y', '@zed-industries/claude-code-acp@0.16.2'],
    });
    expect(byId['codex']).toMatchObject({ command: 'npx', args: ['-y', '@agentclientprotocol/codex-acp@2.5.0'] });
    expect(byId['kimi']).toMatchObject({ command: 'kimi', args: ['acp'] });
    expect(byId['grok']).toMatchObject({ command: 'grok', args: ['agent', 'stdio'] });
    expect(byId['opencode']).toMatchObject({ command: 'opencode', args: ['acp'] });
    for (const agent of BUILT_IN_AGENTS) {
      expect(agent.builtIn).toBe(true);
      expect(agent.installHint).toBeTruthy();
      expect(agent.docsUrl).toMatch(/^https:\/\//);
    }
  });
});

describe('AgentRegistry', () => {
  it('lists built-ins followed by custom agents', () => {
    const registry = new AgentRegistry(() => [{ id: 'mine', name: 'Mine', command: 'mine', args: ['acp'], env: {} }]);
    const ids = registry.list().map((a) => a.id);
    expect(ids.slice(0, 5)).toEqual(BUILT_IN_AGENTS.map((a) => a.id));
    expect(ids[5]).toBe('mine');
    expect(registry.get('mine')).toMatchObject({ builtIn: false, command: 'mine' });
  });

  it('lets a custom agent override a built-in with the same id', () => {
    const registry = new AgentRegistry(() => [
      { id: 'kimi', name: 'Kimi (dev build)', command: '/opt/kimi/bin/kimi', args: ['acp'], env: {} },
    ]);
    expect(registry.list().filter((a) => a.id === 'kimi')).toHaveLength(1);
    expect(registry.get('kimi')).toMatchObject({
      name: 'Kimi (dev build)',
      command: '/opt/kimi/bin/kimi',
      builtIn: false,
    });
  });

  it('reads custom agents live, so settings changes apply without restarting', () => {
    let custom: { id: string; name: string; command: string; args: string[]; env: Record<string, string> }[] = [];
    const registry = new AgentRegistry(() => custom);
    expect(registry.get('later')).toBeUndefined();
    custom = [{ id: 'later', name: 'Later', command: 'later', args: [], env: {} }];
    expect(registry.get('later')).toBeDefined();
  });

  it('detects executables through the provided lookup and reports where they resolved', () => {
    const registry = new AgentRegistry(() => []);
    const found: Record<string, string> = { npx: '/usr/bin/npx', kimi: '/home/me/.kimi-code/bin/kimi' };
    const availability = registry.detect((command) => found[command]);
    expect(availability).toEqual([
      { id: 'claude-code', available: true, resolvedCommand: '/usr/bin/npx' },
      { id: 'codex', available: true, resolvedCommand: '/usr/bin/npx' },
      { id: 'kimi', available: true, resolvedCommand: '/home/me/.kimi-code/bin/kimi' },
      { id: 'grok', available: false },
      { id: 'opencode', available: false },
    ]);
  });

  it('treats an absolute command path as available when the lookup confirms it', () => {
    const registry = new AgentRegistry(() => [
      { id: 'abs', name: 'Abs', command: '/opt/agent/bin/agent', args: [], env: {} },
    ]);
    const availability = registry.detect((command) => (command === '/opt/agent/bin/agent' ? command : undefined));
    expect(availability.find((a) => a.id === 'abs')).toEqual({
      id: 'abs',
      available: true,
      resolvedCommand: '/opt/agent/bin/agent',
    });
  });
});
