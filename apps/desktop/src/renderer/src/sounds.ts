import type { SoundId } from '@arbora/shared';

/** A note of a cue: frequency in Hz, start and length in seconds, relative gain, waveform. */
interface Tone {
  readonly freq: number;
  readonly at: number;
  readonly length: number;
  readonly gain?: number;
  readonly type?: OscillatorType;
  /** Glide to this frequency over the note. */
  readonly to?: number;
}

/**
 * Short synthesized cues, so the app ships no audio files: soft enough to hear across the room
 * without startling, and each one distinct (Solo and Cursor use a chime for "done" and a brighter
 * ping for "needs you").
 */
export const SOUND_TONES: Readonly<Record<Exclude<SoundId, 'none'>, readonly Tone[]>> = {
  chime: [
    { freq: 659.25, at: 0, length: 0.35 },
    { freq: 987.77, at: 0.12, length: 0.5 },
  ],
  ping: [
    { freq: 1318.5, at: 0, length: 0.25, gain: 0.8 },
    { freq: 1318.5, at: 0.16, length: 0.3, gain: 0.6 },
  ],
  pop: [{ freq: 520, to: 880, at: 0, length: 0.12, type: 'triangle' }],
  knock: [
    { freq: 196, at: 0, length: 0.16, type: 'triangle', gain: 1 },
    { freq: 164.81, at: 0.14, length: 0.22, type: 'triangle', gain: 0.9 },
  ],
  bell: [
    { freq: 880, at: 0, length: 0.9, gain: 0.7 },
    { freq: 1760, at: 0, length: 0.6, gain: 0.25 },
    { freq: 2637, at: 0, length: 0.35, gain: 0.12 },
  ],
};

export const SOUND_LABELS: Readonly<Record<SoundId, string>> = {
  none: 'None',
  chime: 'Chime',
  ping: 'Ping',
  pop: 'Pop',
  knock: 'Knock',
  bell: 'Bell',
};

let context: AudioContext | null = null;
let lastPlayed = 0;

/** Plays a cue at `volume` (0..100). Several finishes in the same moment play once. */
export function playSound(id: SoundId, volume: number): void {
  if (id === 'none' || volume <= 0) return;
  const now = performance.now();
  if (now - lastPlayed < 250) return;
  lastPlayed = now;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const ctx = context;
    const master = ctx.createGain();
    master.gain.value = Math.min(1, volume / 100) * 0.25;
    master.connect(ctx.destination);
    const start = ctx.currentTime + 0.01;
    for (const tone of SOUND_TONES[id]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.type ?? 'sine';
      osc.frequency.setValueAtTime(tone.freq, start + tone.at);
      if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, start + tone.at + tone.length);
      const peak = tone.gain ?? 1;
      gain.gain.setValueAtTime(0.0001, start + tone.at);
      gain.gain.exponentialRampToValueAtTime(peak, start + tone.at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.at + tone.length);
      osc.connect(gain).connect(master);
      osc.start(start + tone.at);
      osc.stop(start + tone.at + tone.length + 0.05);
    }
  } catch {
    // No audio device (CI, some remote sessions): the badge and notification still say it.
  }
}
