import { describe, expect, it } from 'vitest';
import { redact, REDACTED } from './redact.js';

describe('redact', () => {
  it('redacts values of secret-looking keys at any depth', () => {
    expect(
      redact({
        method: 'authenticate',
        params: { methodId: 'xai.api_key', apiKey: 'sk-123', nested: { token: 'abc', Authorization: 'Bearer x' } },
      }),
    ).toEqual({
      method: 'authenticate',
      params: { methodId: 'xai.api_key', apiKey: REDACTED, nested: { token: REDACTED, Authorization: REDACTED } },
    });
  });

  it('redacts env values but keeps names, in both record and ACP array form', () => {
    expect(redact({ env: { PATH: '/bin', OPENAI_API_KEY: 'sk' } })).toEqual({
      env: { PATH: REDACTED, OPENAI_API_KEY: REDACTED },
    });
    expect(
      redact({
        params: {
          command: 'node',
          env: [
            { name: 'HOME', value: '/me' },
            { name: 'SECRET', value: 's' },
          ],
        },
      }),
    ).toEqual({
      params: {
        command: 'node',
        env: [
          { name: 'HOME', value: REDACTED },
          { name: 'SECRET', value: REDACTED },
        ],
      },
    });
  });

  it('redacts HTTP header values', () => {
    expect(redact({ headers: [{ name: 'Authorization', value: 'Bearer t' }] })).toEqual({
      headers: [{ name: 'Authorization', value: REDACTED }],
    });
  });

  it('redacts bearer tokens inside strings', () => {
    expect(redact('Authorization: Bearer abc.def-ghi')).toBe(`Authorization: Bearer ${REDACTED}`);
  });

  it('leaves ordinary content alone', () => {
    const message = {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 's',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
      },
    };
    expect(redact(message)).toEqual(message);
  });

  it('does not treat `toolCallId` or `sessionId` as secrets', () => {
    expect(redact({ toolCallId: 't1', sessionId: 's1', optionId: 'allow' })).toEqual({
      toolCallId: 't1',
      sessionId: 's1',
      optionId: 'allow',
    });
  });

  it('handles arrays, null and primitives', () => {
    expect(redact([1, null, 'x', { password: 'p' }])).toEqual([1, null, 'x', { password: REDACTED }]);
    expect(redact('the password is s3cret-fixture', ['s3cret-fixture'])).toBe('the password is •••');
    expect(redact(null)).toBeNull();
    expect(redact(42)).toBe(42);
  });
});
