import { describe, expect, it } from 'vitest';
import { pastedImageOnly } from './paste';

describe('pastedImageOnly', () => {
  it('takes a screenshot or a copied image', () => {
    expect(pastedImageOnly([{ kind: 'file', type: 'image/png' }])).toBe(true);
    expect(
      pastedImageOnly([
        { kind: 'string', type: 'text/html' },
        { kind: 'file', type: 'image/png' },
      ]),
    ).toBe(true);
  });

  it('leaves text pastes to the textarea', () => {
    expect(pastedImageOnly([{ kind: 'string', type: 'text/plain' }])).toBe(false);
    expect(
      pastedImageOnly([
        { kind: 'string', type: 'text/plain' },
        { kind: 'file', type: 'image/png' },
      ]),
    ).toBe(false);
  });
});
