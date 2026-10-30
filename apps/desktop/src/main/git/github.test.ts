import { describe, expect, it } from 'vitest';
import { parsePrs } from './github.js';

describe('parsePrs', () => {
  it('maps gh pr list json', () => {
    expect(
      parsePrs(
        '[{"number":4,"title":"Add git","url":"https://github.com/a/b/pull/4","state":"OPEN","headRefName":"git"}]',
      ),
    ).toEqual([{ number: 4, title: 'Add git', url: 'https://github.com/a/b/pull/4', state: 'OPEN', head: 'git' }]);
  });
});
