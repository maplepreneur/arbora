import { describe, expect, it } from 'vitest';
import { priceFor } from './model-prices.js';

describe('priceFor', () => {
  it('uses the longest matching model alias', () => {
    expect(priceFor('claude-sonnet-4-6-20261101')?.input).toBe(3);
    expect(priceFor('claude-sonnet-4-20250801')?.input).toBe(3);
  });

  it('lets an exact override win', () => {
    expect(
      priceFor('claude-sonnet-4-6', [
        { modelId: 'claude-sonnet-4-6', input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ]),
    ).toMatchObject({ input: 0, output: 0, asOf: 'custom' });
  });

  it('keeps a free model explicitly zero and unknown models unpriced', () => {
    expect(priceFor('opencode/deepseek-v4.1-flash-free')).toMatchObject({ input: 0, output: 0 });
    expect(priceFor('some-new-model')).toBeNull();
  });
});
