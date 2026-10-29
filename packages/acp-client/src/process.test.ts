import { describe, expect, it } from 'vitest';
import { restartDelay, spawnSpec } from './process.js';

describe('spawnSpec', () => {
  it('spawns the command directly on POSIX', () => {
    expect(spawnSpec('linux', 'npx', ['-y', 'pkg@1'], () => undefined)).toEqual({
      file: 'npx',
      args: ['-y', 'pkg@1'],
      shell: false,
    });
  });

  it('runs .cmd shims through cmd.exe on Windows (Node refuses to spawn them directly)', () => {
    const lookup = (cmd: string): string | undefined => (cmd === 'npx' ? 'C:\\nodejs\\npx.cmd' : undefined);
    expect(spawnSpec('win32', 'npx', ['-y', 'pkg@1'], lookup)).toEqual({
      file: 'C:\\nodejs\\npx.cmd',
      args: ['-y', 'pkg@1'],
      shell: true,
    });
  });

  it('spawns Windows executables directly', () => {
    const lookup = (cmd: string): string | undefined => (cmd === 'kimi' ? 'C:\\kimi\\kimi.exe' : undefined);
    expect(spawnSpec('win32', 'kimi', ['acp'], lookup)).toEqual({
      file: 'C:\\kimi\\kimi.exe',
      args: ['acp'],
      shell: false,
    });
  });

  it('keeps an unresolved Windows command as given so the spawn error names it', () => {
    expect(spawnSpec('win32', 'missing', [], () => undefined)).toEqual({ file: 'missing', args: [], shell: false });
  });
});

describe('restartDelay', () => {
  it('backs off exponentially from one second and caps at thirty', () => {
    expect(restartDelay(0)).toBe(0);
    expect(restartDelay(1)).toBe(1000);
    expect(restartDelay(2)).toBe(2000);
    expect(restartDelay(3)).toBe(4000);
    expect(restartDelay(10)).toBe(30_000);
  });
});
