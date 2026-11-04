import { describe, expect, it } from 'vitest';
import { NATURE_SOUND_IDS, SOUND_IDS } from '@arbora/shared';
import { cueLength, SOUND_LABELS, SOUND_TONES } from './sounds';

describe('sounds', () => {
  it('has a label and tones for every sound, short enough to not get in the way', () => {
    for (const id of SOUND_IDS) {
      expect(SOUND_LABELS[id]).toBeTruthy();
      if (id === 'none') continue;
      expect(SOUND_TONES[id].length).toBeGreaterThan(0);
      expect(cueLength(id)).toBeLessThanOrEqual(1);
      for (const tone of SOUND_TONES[id]) {
        expect(tone.gain ?? 1).toBeLessThanOrEqual(1);
        expect(tone.freq).toBeGreaterThan(20);
        expect(tone.freq).toBeLessThan(8000);
      }
    }
  });

  it('keeps the bird calls in a bird range and the default trio distinct', () => {
    for (const id of ['chickadee', 'robin', 'songbird'] as const) {
      for (const tone of SOUND_TONES[id]) expect(tone.freq).toBeGreaterThanOrEqual(2000);
    }
    expect(NATURE_SOUND_IDS).toContain('woodpecker');
    expect(new Set([SOUND_TONES.chickadee, SOUND_TONES.robin, SOUND_TONES.woodpecker]).size).toBe(3);
  });
});
