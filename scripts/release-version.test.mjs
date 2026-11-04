import { describe, expect, it } from 'vitest';
import { compareVersions, isOfferedUpdate } from '../packages/shared/src/updates.ts';
import { nextBetaVersion, nextReleaseVersion, writeReleaseVersion } from './release-version.mjs';

describe('nextReleaseVersion', () => {
  it('keeps the current version until that tag exists', () => {
    expect(nextReleaseVersion('0.0.1', false)).toBe('0.0.1');
  });

  it('bumps the patch once the tag exists', () => {
    expect(nextReleaseVersion('0.0.1', true)).toBe('0.0.2');
    expect(nextReleaseVersion('1.2.9', true)).toBe('1.2.10');
  });

  it('rejects prerelease and empty versions', () => {
    expect(() => nextReleaseVersion('0.0.1-beta.1', false)).toThrow(/x\.y\.z/);
    expect(() => nextReleaseVersion('', true)).toThrow(/x\.y\.z/);
  });
});

describe('nextBetaVersion', () => {
  it('leads to the next stable version once the current one is tagged', () => {
    expect(nextBetaVersion('0.0.3', ['v0.0.2', 'v0.0.3'])).toBe('0.0.4-beta.1');
  });

  it('uses an untagged package.json version that is ahead of every tag', () => {
    expect(nextBetaVersion('0.1.0', ['v0.0.2', 'v0.0.3'])).toBe('0.1.0-beta.1');
    expect(nextBetaVersion('0.0.1', [])).toBe('0.0.1-beta.1');
  });

  it('does not trust a beta branch that is behind the tags', () => {
    expect(nextBetaVersion('0.0.2', ['v0.0.2', 'v0.0.3', ''])).toBe('0.0.4-beta.1');
  });

  it('counts up from the betas already tagged for that version', () => {
    const tags = ['v0.0.3', 'v0.0.4-beta.1', 'v0.0.4-beta.2', 'v0.0.3-beta.7'];
    expect(nextBetaVersion('0.0.3', tags)).toBe('0.0.4-beta.3');
  });

  it('sorts between the stable release before it and the one it leads to', () => {
    const beta = nextBetaVersion('0.0.3', ['v0.0.3', 'v0.0.4-beta.1']);
    expect(compareVersions(beta, '0.0.3')).toBeGreaterThan(0);
    expect(compareVersions(beta, '0.0.4-beta.1')).toBeGreaterThan(0);
    expect(compareVersions(beta, nextReleaseVersion('0.0.3', true))).toBeLessThan(0);
    expect(isOfferedUpdate('0.0.3', beta, 'beta')).toBe(true);
    expect(isOfferedUpdate('0.0.3', beta, 'latest')).toBe(false);
    expect(isOfferedUpdate(beta, '0.0.4', 'beta')).toBe(true);
  });

  it('rejects a prerelease on the beta branch', () => {
    expect(() => nextBetaVersion('0.0.4-beta.1', [])).toThrow(/x\.y\.z/);
  });
});

describe('writeReleaseVersion', () => {
  it('replaces only the first version field', () => {
    const text = '{\n  "version": "0.0.1",\n  "deps": { "version": "1.0.0" }\n}\n';
    expect(writeReleaseVersion(text, '0.0.2')).toBe('{\n  "version": "0.0.2",\n  "deps": { "version": "1.0.0" }\n}\n');
  });

  it('writes beta versions and rejects anything else', () => {
    expect(writeReleaseVersion('{ "version": "0.0.3" }', '0.0.4-beta.1')).toBe('{ "version": "0.0.4-beta.1" }');
    expect(() => writeReleaseVersion('{ "version": "0.0.3" }', '0.0.4-rc.1')).toThrow(/beta/);
  });
});
