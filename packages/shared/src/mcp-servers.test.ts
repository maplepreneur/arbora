import { describe, expect, it } from 'vitest';
import {
  joinCommandLine,
  mcpServerConfigSchema,
  mcpServersFor,
  parseKeyValueLines,
  parseMcpConfigJson,
  splitCommandLine,
} from './mcp-servers.js';

const server = (fields: Record<string, unknown>) =>
  mcpServerConfigSchema.parse({ id: String(fields['name']), ...fields });

describe('mcpServersFor', () => {
  const servers = [
    server({ name: 'docs', command: 'npx', args: ['-y', 'docs-mcp'], env: { KEY: 'v' } }),
    server({ name: 'remote', transport: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'x' } }),
    server({ name: 'off', command: 'x', enabled: false }),
    server({ name: 'claude-only', command: 'y', agents: ['claude-code'] }),
    server({ name: 'arbora-browser', command: 'z' }),
  ];

  it('maps enabled servers to ACP shapes for the agent', () => {
    expect(mcpServersFor(servers, 'codex', true)).toEqual([
      { name: 'docs', command: 'npx', args: ['-y', 'docs-mcp'], env: [{ name: 'KEY', value: 'v' }] },
      {
        type: 'http',
        name: 'remote',
        url: 'https://mcp.example.com/mcp',
        headers: [{ name: 'Authorization', value: 'x' }],
      },
    ]);
  });

  it('skips HTTP servers for agents without HTTP MCP and honours the agent list', () => {
    expect(mcpServersFor(servers, 'claude-code', false).map((s) => s.name)).toEqual(['docs', 'claude-only']);
  });
});

describe('parseMcpConfigJson', () => {
  let n = 0;
  const id = (): string => `id-${++n}`;

  it('reads stdio and http servers, leaving SSE out', () => {
    const text = JSON.stringify({
      mcpServers: {
        context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'], env: { A: '1', B: 2 } },
        'my remote': { type: 'http', url: 'https://example.com/mcp', headers: { 'X-Key': 'k' } },
        gemini: { httpUrl: 'https://g.example/mcp' },
        old: { type: 'sse', url: 'https://example.com/sse' },
        off: { command: 'x', disabled: true },
      },
    });
    const parsed = parseMcpConfigJson(text, id);
    expect(parsed.map((s) => [s.name, s.transport, s.enabled])).toEqual([
      ['context7', 'stdio', true],
      ['my-remote', 'http', true],
      ['gemini', 'http', true],
      ['off', 'stdio', false],
    ]);
    expect(parsed[0]?.env).toEqual({ A: '1' });
    expect(parsed[1]?.headers).toEqual({ 'X-Key': 'k' });
  });

  it('ignores files without mcpServers', () => {
    expect(parseMcpConfigJson('{"theme":"dark"}', id)).toEqual([]);
    expect(parseMcpConfigJson('not json', id)).toEqual([]);
  });
});

describe('command lines', () => {
  it('splits on whitespace and keeps quoted words', () => {
    expect(splitCommandLine(`npx -y "@scope/pkg" --dir '/a b' ""`)).toEqual([
      'npx',
      '-y',
      '@scope/pkg',
      '--dir',
      '/a b',
      '',
    ]);
  });

  it('round-trips through joinCommandLine', () => {
    const words = ['node', '/path with space/server.js', '--flag'];
    expect(splitCommandLine(joinCommandLine(words))).toEqual(words);
  });

  it('parses KEY=value and Name: value lines', () => {
    expect(parseKeyValueLines('A=1\n\nB = two=2\nnoequals')).toEqual({ A: '1', B: 'two=2' });
    expect(parseKeyValueLines('Authorization: Bearer x\nX: y', ':')).toEqual({ Authorization: 'Bearer x', X: 'y' });
  });
});
