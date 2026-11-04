import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@arbora/shared';
import { redactSettings, redactText, shortenHome } from './diagnostics-redact.js';

describe('redactSettings', () => {
  it('drops agent env values and secret-looking keys, and shortens home paths', () => {
    const settings = {
      ...defaultSettings(),
      agents: {
        ...defaultSettings().agents,
        custom: [{ id: 'mine', name: 'Mine', command: '/home/ana/bin/agent', args: [], env: { API_KEY: 'abc' } }],
        env: { codex: { OPENAI_API_KEY: 'sk-live-123', OPENAI_BASE_URL: 'http://localhost' } },
      },
      recentProjects: [{ path: '/home/ana/code/shop', name: 'shop', openedAt: 1 }],
    };
    const out = JSON.stringify(redactSettings(settings, '/home/ana'));
    expect(out).not.toContain('abc');
    expect(out).not.toContain('sk-live-123');
    expect(out).not.toContain('http://localhost');
    expect(out).not.toContain('/home/ana');
    expect(out).toContain('~/code/shop');
    expect(out).toContain('"OPENAI_API_KEY":"[redacted]"');
  });

  it('drops MCP server env values and headers', () => {
    const settings = {
      ...defaultSettings(),
      mcpServers: [
        {
          id: '1',
          name: 'docs',
          enabled: true,
          transport: 'stdio' as const,
          command: 'npx',
          args: [],
          env: { DOCS_KEY: 'plain-value-1' },
          url: '',
          headers: { 'X-Custom': 'plain-value-2' },
          agents: [],
        },
      ],
    };
    const out = JSON.stringify(redactSettings(settings, '/home/ana'));
    expect(out).not.toContain('plain-value');
    expect(out).toContain('"DOCS_KEY":"[redacted]"');
  });
});

describe('redactText', () => {
  it('removes token-shaped values from log lines', () => {
    const line =
      '[agent] start /home/ana/x token=abc123 ghp_abcdefghijklmnopqrstuvwxyz0123 Authorization: Bearer abcdefghijklmnopqrstu';
    const out = redactText(line, '/home/ana');
    expect(out).toContain('~/x');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('ghp_');
    expect(out).not.toContain('abcdefghijklmnopqrstu');
  });

  it('leaves text alone for a root home', () => {
    expect(shortenHome('/a/b', '/')).toBe('/a/b');
  });
});
