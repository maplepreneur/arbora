import { describe, expect, it } from 'vitest';
import { adapterPackage, AgentRegistry, BUILT_IN_AGENTS, withAdapterVersion } from './registry.js';

describe('BUILT_IN_AGENTS', () => {
  it('defines the built-in agents with the verified launch commands', () => {
    const byId = Object.fromEntries(BUILT_IN_AGENTS.map((a) => [a.id, a]));
    expect(Object.keys(byId).sort()).toEqual(['antigravity', 'claude-code', 'codex', 'grok', 'kimi', 'opencode']);
    expect(byId['claude-code']).toMatchObject({
      command: 'npx',
      args: ['-y', '@zed-industries/claude-code-acp@0.16.2'],
    });
    expect(byId['codex']).toMatchObject({ command: 'npx', args: ['-y', '@agentclientprotocol/codex-acp@2.5.0'] });
    expect(byId['kimi']).toMatchObject({ command: 'kimi', args: ['acp'] });
    expect(byId['grok']).toMatchObject({ command: 'grok', args: ['agent', 'stdio'] });
    expect(byId['opencode']).toMatchObject({ command: 'opencode', args: ['acp'] });
    expect(byId['antigravity']).toMatchObject({ command: 'agy', args: ['acp'] });
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
    expect(ids.slice(0, BUILT_IN_AGENTS.length)).toEqual(BUILT_IN_AGENTS.map((a) => a.id));
    expect(ids[BUILT_IN_AGENTS.length]).toBe('mine');
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
      { id: 'antigravity', available: false },
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

describe('agent overrides', () => {
  it('reads the pinned npm adapter and swaps its version', () => {
    const claude = BUILT_IN_AGENTS.find((a) => a.id === 'claude-code');
    const kimi = BUILT_IN_AGENTS.find((a) => a.id === 'kimi');
    if (!claude || !kimi) throw new Error('missing built-ins');
    expect(adapterPackage(claude)).toEqual({ name: '@zed-industries/claude-code-acp', version: '0.16.2' });
    expect(adapterPackage(kimi)).toBeNull();
    expect(withAdapterVersion(claude, 'latest').args).toEqual(['-y', '@zed-industries/claude-code-acp@latest']);
    expect(withAdapterVersion(kimi, '1.0.0')).toBe(kimi);
  });

  it('applies adapter versions to built-ins and merges extra env into any agent', () => {
    const registry = new AgentRegistry(
      () => [{ id: 'mine', name: 'Mine', command: 'npx', args: ['-y', 'mine@1.0.0'], env: { A: '1' } }],
      () => ({
        env: { mine: { B: '2' }, codex: { OPENAI_BASE_URL: 'http://localhost' } },
        adapterVersions: { codex: '2.6.0', mine: '9.9.9' },
      }),
    );
    expect(registry.get('codex')).toMatchObject({
      args: ['-y', '@agentclientprotocol/codex-acp@2.6.0'],
      env: { OPENAI_BASE_URL: 'http://localhost' },
    });
    // Custom agents own their command line; only env is layered over them.
    expect(registry.get('mine')).toMatchObject({ args: ['-y', 'mine@1.0.0'], env: { A: '1', B: '2' } });
    expect(registry.builtIn('codex')?.args).toEqual(['-y', '@agentclientprotocol/codex-acp@2.5.0']);
  });
});
