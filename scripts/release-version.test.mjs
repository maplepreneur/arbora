import { describe, expect, it } from 'vitest';
import { nextReleaseVersion, writeReleaseVersion } from './release-version.mjs';

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

describe('writeReleaseVersion', () => {
  it('replaces only the first version field', () => {
    const text = '{\n  "version": "0.0.1",\n  "deps": { "version": "1.0.0" }\n}\n';
    expect(writeReleaseVersion(text, '0.0.2')).toBe('{\n  "version": "0.0.2",\n  "deps": { "version": "1.0.0" }\n}\n');
  });
});
