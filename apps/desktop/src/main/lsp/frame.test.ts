import { describe, expect, it } from 'vitest';
import { encodeLspFrame, LspFrameDecoder } from './frame.js';

describe('LSP frames', () => {
  it('round-trips a message split across chunks', () => {
    const frame = encodeLspFrame('{"jsonrpc":"2.0"}');
    const decoder = new LspFrameDecoder();
    expect(decoder.push(frame.subarray(0, 10))).toEqual([]);
    expect(decoder.push(frame.subarray(10))).toEqual(['{"jsonrpc":"2.0"}']);
  });

  it('reads two messages from one chunk', () => {
    const frame = Buffer.concat([encodeLspFrame('{"a":1}'), encodeLspFrame('{"b":2}')]);
    expect(new LspFrameDecoder().push(frame)).toEqual(['{"a":1}', '{"b":2}']);
  });
});
