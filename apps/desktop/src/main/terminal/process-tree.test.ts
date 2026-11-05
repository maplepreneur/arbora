import { describe, expect, it } from 'vitest';
import { parseProcessSamples, treeSample } from './process-tree.js';

describe('process samples', () => {
  it('sums a process tree and names the agent CLI inside it', () => {
    const rows = parseProcessSamples(
      [
        '  10  1  1000  0.1 bash',
        '  11  10  4000  1.5 claude --resume',
        '  12  11  2000  0.4 node',
        '  99  1  9000  9.0 other',
      ].join('\n'),
    );
    expect(treeSample(10, rows)).toEqual({ rssKb: 7000, cpuPercent: 2, agentCli: 'Claude Code' });
  });
});
