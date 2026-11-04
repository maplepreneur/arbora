import { describe, expect, it } from 'vitest';
import type { TerminalInfo } from '@arbora/shared';
import { groupProjectTerminals } from './project-terminals';

function terminal(overrides: Pick<TerminalInfo, 'id' | 'command'> & Partial<TerminalInfo>): TerminalInfo {
  return {
    title: overrides.command,
    kind: 'shell',
    cwd: '/proj',
    pid: 1,
    exitCode: null,
    readOnly: false,
    ...overrides,
  };
}

const commands = [{ id: 'npm:dev', command: 'npm run dev' }];

describe('groupProjectTerminals', () => {
  it('omits a runCommand terminal from the terminal list and marks that command running', () => {
    const bash = terminal({ id: 'bash', title: 'bash', command: 'bash' });
    const dev = terminal({ id: 'dev', title: 'npm:dev', command: 'npm run dev' });
    const again = terminal({ id: 'dev-2', title: 'npm:dev', command: 'npm run dev' });
    const grouped = groupProjectTerminals([bash, dev, again], commands);
    expect(grouped.terminals.map((item) => item.id)).toEqual(['bash']);
    expect(grouped.running['npm:dev']?.id).toBe('dev-2');
  });

  it('keeps the selected runCommand terminal when several match', () => {
    const dev = terminal({ id: 'dev', title: 'npm:dev', command: 'npm run dev' });
    const again = terminal({ id: 'dev-2', title: 'npm:dev', command: 'npm run dev' });
    const grouped = groupProjectTerminals([dev, again], commands, { selectedId: 'dev' });
    expect(grouped.terminals).toEqual([]);
    expect(grouped.running['npm:dev']?.id).toBe('dev');
  });

  it('does not treat an interactive shell as a project command', () => {
    const bash = terminal({ id: 'bash', title: 'bash', command: 'bash' });
    const grouped = groupProjectTerminals([bash], [{ id: 'shell', command: 'bash' }]);
    expect(grouped.terminals.map((item) => item.id)).toEqual(['bash']);
    expect(grouped.running).toEqual({});
  });

  it('leaves an agent terminal out of Commands and Terminals', () => {
    const agent = terminal({ id: 'agent', title: 'claude', command: 'npm run dev' });
    const grouped = groupProjectTerminals([agent], commands, { agentIds: new Set(['agent']) });
    expect(grouped.terminals).toEqual([]);
    expect(grouped.running).toEqual({});
  });
});
