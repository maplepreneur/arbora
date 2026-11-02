import { describe, expect, it } from 'vitest';
import {
  canSelfUpdate,
  checkoutBranch,
  compareVersions,
  detectInstallKind,
  isOfferedUpdate,
  manualUpdateHint,
  pickRelease,
  releaseNotesText,
  releasePageUrl,
  updatePolicy,
  updatesOffText,
  versionChannel,
} from './updates.js';

describe('compareVersions', () => {
  it('follows semver precedence', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('v1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    expect(compareVersions('1.0.0-1', '1.0.0-beta')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0+build.5')).toBe(0);
    expect(compareVersions('nonsense', '1.0.0')).toBe(0);
  });
});

describe('channels', () => {
  it('puts prereleases on beta and hides them from latest', () => {
    expect(versionChannel('0.2.0-beta.1')).toBe('beta');
    expect(versionChannel('0.2.0')).toBe('latest');
    expect(isOfferedUpdate('0.1.0', '0.2.0-beta.1', 'latest')).toBe(false);
    expect(isOfferedUpdate('0.1.0', '0.2.0-beta.1', 'beta')).toBe(true);
    expect(isOfferedUpdate('0.2.0', '0.2.0', 'beta')).toBe(false);
  });

  it('gives beta users the stable release a beta leads to, and keeps leavers off older stables', () => {
    expect(isOfferedUpdate('0.2.0-beta.3', '0.2.0', 'beta')).toBe(true);
    expect(isOfferedUpdate('0.2.0-beta.3', '0.2.0', 'latest')).toBe(true);
    expect(isOfferedUpdate('0.2.0-beta.3', '0.1.9', 'latest')).toBe(false);
  });
});

describe('updatePolicy', () => {
  const release = { kind: 'appimage', releaseBuild: true, env: undefined, channel: 'latest' } as const;

  it('follows the channel in release builds', () => {
    expect(updatePolicy(release)).toEqual({ enabled: true, channel: 'latest' });
    expect(updatePolicy({ ...release, channel: 'beta' })).toEqual({ enabled: true, channel: 'beta' });
    expect(updatePolicy({ ...release, channel: 'off' })).toEqual({ enabled: false, reason: 'setting' });
  });

  it('is always off when not packaged, whatever the setting or ARBORA_UPDATES says', () => {
    for (const channel of ['latest', 'beta', 'off'] as const) {
      for (const env of [undefined, 'on', 'off']) {
        expect(updatePolicy({ ...release, kind: 'dev', channel, env })).toEqual({ enabled: false, reason: 'dev' });
      }
    }
  });

  it('keeps local packaged builds put unless ARBORA_UPDATES=on', () => {
    const local = { ...release, releaseBuild: false };
    expect(updatePolicy(local)).toEqual({ enabled: false, reason: 'local-build' });
    expect(updatePolicy({ ...local, channel: 'beta' })).toEqual({ enabled: false, reason: 'local-build' });
    expect(updatePolicy({ ...local, env: 'on' })).toEqual({ enabled: true, channel: 'latest' });
    expect(updatePolicy({ ...local, env: 'on', channel: 'off' })).toEqual({ enabled: false, reason: 'setting' });
  });

  it('lets ARBORA_UPDATES=off turn any build off', () => {
    for (const env of ['off', 'OFF', '0', 'false', ' off ']) {
      expect(updatePolicy({ ...release, env })).toEqual({ enabled: false, reason: 'env' });
    }
    expect(updatePolicy({ ...release, env: 'yes' })).toEqual({ enabled: true, channel: 'latest' });
  });

  it('explains every reason', () => {
    expect(updatesOffText('dev')).toMatch(/development builds/);
    expect(updatesOffText('local-build')).toMatch(/ARBORA_UPDATES=on/);
    expect(updatesOffText('env')).toMatch(/ARBORA_UPDATES=off/);
    expect(updatesOffText('setting')).toMatch(/Development channel/);
  });
});

describe('checkoutBranch', () => {
  it('maps Stable to main, Beta to beta and Development to nothing', () => {
    expect(checkoutBranch('latest')).toBe('main');
    expect(checkoutBranch('beta')).toBe('beta');
    expect(checkoutBranch('off')).toBeNull();
  });
});

describe('detectInstallKind', () => {
  const base = { packaged: true, appImage: undefined, packageType: undefined, execPath: '/usr/bin/arbora' };
  it('recognises each install', () => {
    expect(detectInstallKind({ ...base, platform: 'darwin' })).toBe('dmg');
    expect(detectInstallKind({ ...base, platform: 'win32' })).toBe('nsis');
    expect(detectInstallKind({ ...base, platform: 'linux', appImage: '/home/me/Arbora.AppImage' })).toBe('appimage');
    expect(detectInstallKind({ ...base, platform: 'linux', execPath: '/opt/arbora/arbora' })).toBe('aur');
    expect(detectInstallKind({ ...base, platform: 'linux', packageType: 'deb\n' })).toBe('deb');
    expect(detectInstallKind({ ...base, platform: 'linux' })).toBe('tarball');
    expect(detectInstallKind({ ...base, packaged: false, platform: 'linux' })).toBe('dev');
  });

  it('only self-updates where electron-updater can replace the app', () => {
    expect(['dmg', 'nsis', 'appimage'].every((k) => canSelfUpdate(k as 'dmg'))).toBe(true);
    expect(canSelfUpdate('deb')).toBe(false);
    // Unsigned macOS builds cannot update in place; they get the download hint.
    expect(canSelfUpdate('dmg', false)).toBe(false);
    expect(manualUpdateHint('dmg', '1.0.0')).toMatch(/drag Arbora to Applications/);
    expect(manualUpdateHint('aur', '1.0.0')).toMatch(/yay/);
    expect(manualUpdateHint('deb', '1.0.0')).toMatch(/apt install/);
  });
});

describe('pickRelease', () => {
  const releases = [
    { tag_name: 'v0.3.0', draft: true, prerelease: false },
    { tag_name: 'v0.2.1-beta.1', draft: false, prerelease: true },
    { tag_name: 'v0.2.0', draft: false, prerelease: false },
    { tag_name: 'v0.1.0', draft: false, prerelease: false },
  ];
  it('skips drafts and, on latest, prereleases', () => {
    expect(pickRelease(releases, '0.1.0', 'latest')?.tag_name).toBe('v0.2.0');
    expect(pickRelease(releases, '0.1.0', 'beta')?.tag_name).toBe('v0.2.1-beta.1');
    expect(pickRelease(releases, '0.2.0', 'latest')).toBeNull();
    expect(releasePageUrl('v0.2.0')).toBe('https://github.com/maplepreneur/arbora/releases/tag/v0.2.0');
  });
});

describe('releaseNotesText', () => {
  it('flattens HTML and per-version notes', () => {
    expect(releaseNotesText('<p>Fixes</p><ul><li>One &amp; two</li></ul>')).toBe('Fixes\n- One & two');
    expect(
      releaseNotesText([
        { version: '1.0.1', note: 'A' },
        { version: '1.0.0', note: null },
      ]),
    ).toBe('## 1.0.1\n\nA\n\n## 1.0.0');
    expect(releaseNotesText(undefined)).toBe('');
  });
});
