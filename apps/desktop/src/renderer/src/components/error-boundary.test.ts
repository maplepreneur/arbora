import { describe, expect, it } from 'vitest';
import { isMissingChunk } from './ErrorBoundary';

describe('isMissingChunk', () => {
  it('spots a lazy chunk that no longer exists', () => {
    expect(
      isMissingChunk(
        new TypeError(
          'Failed to fetch dynamically imported module: file:///app/out/renderer/assets/SettingsPage-C1aYWFjg.js',
        ),
      ),
    ).toBe(true);
  });

  it('leaves ordinary render errors alone', () => {
    expect(isMissingChunk(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(false);
  });
});
