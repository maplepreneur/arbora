import { describe, expect, it } from 'vitest';
import { TerminalOutputBuffer } from './terminal-output.js';

describe('TerminalOutputBuffer', () => {
  it('collects ANSI-stripped output and reports no truncation under the limit', () => {
    const buffer = new TerminalOutputBuffer(100);
    buffer.push('\u001b[32mhello\u001b[0m\r\n');
    buffer.push('world\n');
    expect(buffer.snapshot()).toEqual({ output: 'hello\r\nworld\n', truncated: false });
  });

  it('drops output from the beginning once the byte limit is exceeded', () => {
    const buffer = new TerminalOutputBuffer(10);
    buffer.push('0123456789');
    buffer.push('abc');
    expect(buffer.snapshot()).toEqual({ output: '3456789abc', truncated: true });
  });

  it('truncates on a character boundary, never splitting a multi-byte character', () => {
    const buffer = new TerminalOutputBuffer(7);
    buffer.push('ééééé'); // 5 chars, 10 bytes; 3 excess bytes means dropping 2 whole characters
    const { output, truncated } = buffer.snapshot();
    expect(truncated).toBe(true);
    expect(output).toBe('ééé');
    expect(Buffer.byteLength(output)).toBe(6);
  });

  it('never splits a surrogate pair', () => {
    const buffer = new TerminalOutputBuffer(6);
    buffer.push('ab😀😀'); // 2 + 4 + 4 = 10 bytes
    const { output } = buffer.snapshot();
    expect(output).toBe('😀');
    expect(Buffer.byteLength(output)).toBe(4);
  });

  it('keeps everything when no limit is given', () => {
    const buffer = new TerminalOutputBuffer(null);
    buffer.push('x'.repeat(100_000));
    expect(buffer.snapshot()).toEqual({ output: 'x'.repeat(100_000), truncated: false });
  });
});
