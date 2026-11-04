import { describe, expect, it } from 'vitest';
import { checkoutBranch } from '../packages/shared/src/updates.ts';
import { checkoutBranchFor, settingsPath } from './checkout-channel.mjs';

const settings = (channel) => JSON.stringify({ version: 3, updates: { channel } });

describe('checkoutBranchFor', () => {
  it('follows the update channel', () => {
    expect(checkoutBranchFor(settings('latest'), {})).toBe('main');
    expect(checkoutBranchFor(settings('beta'), {})).toBe('beta');
    expect(checkoutBranchFor(settings('off'), {})).toBeNull();
  });

  it('matches checkoutBranch in the app', () => {
    for (const channel of ['latest', 'beta', 'off']) {
      expect(checkoutBranchFor(settings(channel), {})).toBe(checkoutBranch(channel));
    }
  });

  it('treats a missing or broken settings file as Stable', () => {
    expect(checkoutBranchFor('', {})).toBe('main');
    expect(checkoutBranchFor('{"updates":', {})).toBe('main');
    expect(checkoutBranchFor('{}', {})).toBe('main');
  });

  it('never moves the checkout with ARBORA_UPDATES=off', () => {
    expect(checkoutBranchFor(settings('beta'), { ARBORA_UPDATES: 'off' })).toBeNull();
    expect(checkoutBranchFor('', { ARBORA_UPDATES: '0' })).toBeNull();
  });
});

describe('settingsPath', () => {
  it('uses the app user-data folder', () => {
    expect(settingsPath({}, 'linux', '/home/a')).toBe('/home/a/.config/arbora/settings.json');
    expect(settingsPath({ XDG_CONFIG_HOME: '/x' }, 'linux', '/home/a')).toBe('/x/arbora/settings.json');
    expect(settingsPath({}, 'darwin', '/Users/a')).toBe('/Users/a/Library/Application Support/arbora/settings.json');
    expect(settingsPath({ ARBORA_USER_DATA_DIR: '/tmp/p' }, 'linux', '/home/a')).toBe('/tmp/p/settings.json');
  });
});
