import type { SoundId } from '@arbora/shared';

/** A note of a cue: frequency in Hz, start and length in seconds, relative gain, waveform. */
export interface Tone {
  readonly freq: number;
  readonly at: number;
  readonly length: number;
  readonly gain?: number;
  /** `noise` is white noise, shaped by `filter` (leaves, the woodpecker's tap). */
  readonly type?: OscillatorType | 'noise';
  /** Glide to this frequency over the note. */
  readonly to?: number;
  /** Seconds to reach the peak; short for taps, longer for a soft whistle. */
  readonly attack?: number;
  /** Pitch wobble in Hz at `rate` per second: the warble in a bird's note. */
  readonly vibrato?: { readonly rate: number; readonly depth: number };
  /** Band or low-pass filter; for noise its `freq` is the centre. */
  readonly filter?: { readonly type: BiquadFilterType; readonly q?: number };
}

/** A bird's chirp: a fast whistle sweep. */
function chirp(at: number, from: number, to: number, length = 0.07, gain = 0.8): Tone {
  return { freq: from, to, at, length, gain, attack: 0.008 };
}

/** One tap of a woodpecker: a short burst of band-passed noise over a low thud. */
function tap(at: number, gain: number): Tone[] {
  return [
    { type: 'noise', freq: 1800, at, length: 0.035, gain, attack: 0.002, filter: { type: 'bandpass', q: 6 } },
    { type: 'triangle', freq: 420, to: 260, at, length: 0.05, gain: gain * 0.6, attack: 0.002 },
  ];
}

/**
 * Short synthesized cues, so the app ships no audio files. The nature set follows the tree in the
 * logo: a chickadee's two-note "fee-bee" for "needs you", a robin's rising phrase for "finished",
 * and a woodpecker for "failed". The classic set is the original synth.
 */
export const SOUND_TONES: Readonly<Record<Exclude<SoundId, 'none'>, readonly Tone[]>> = {
  chickadee: [
    { freq: 3950, to: 3900, at: 0, length: 0.26, gain: 0.7, attack: 0.03 },
    { freq: 3350, to: 3250, at: 0.3, length: 0.34, gain: 0.6, attack: 0.03, vibrato: { rate: 28, depth: 30 } },
  ],
  robin: [chirp(0, 2300, 2900, 0.09), chirp(0.13, 2600, 3300, 0.09), chirp(0.27, 3000, 3700, 0.12, 0.9)],
  songbird: Array.from({ length: 9 }, (_, i) =>
    chirp(i * 0.055, i % 2 === 0 ? 4200 : 3600, i % 2 === 0 ? 3500 : 4100, 0.045, 0.55 + (i % 3) * 0.1),
  ),
  woodpecker: [0, 0.07, 0.14, 0.21, 0.28].flatMap((at, i) => tap(at, 1 - i * 0.12)),
  owl: [
    { freq: 410, to: 390, at: 0, length: 0.32, gain: 0.9, attack: 0.06, vibrato: { rate: 6, depth: 6 } },
    { freq: 380, to: 350, at: 0.42, length: 0.5, gain: 0.8, attack: 0.08, vibrato: { rate: 6, depth: 6 } },
  ],
  droplet: [
    { freq: 650, to: 1500, at: 0, length: 0.11, gain: 0.9, attack: 0.004 },
    { freq: 1300, to: 1700, at: 0.14, length: 0.07, gain: 0.25, attack: 0.004 },
  ],
  leaves: [
    { type: 'noise', freq: 3200, at: 0, length: 0.5, gain: 0.7, attack: 0.12, filter: { type: 'bandpass', q: 0.8 } },
    {
      type: 'noise',
      freq: 5200,
      at: 0.12,
      length: 0.35,
      gain: 0.4,
      attack: 0.08,
      filter: { type: 'bandpass', q: 1.2 },
    },
  ],
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
  chickadee: 'Chickadee',
  robin: 'Robin',
  songbird: 'Songbird trill',
  woodpecker: 'Woodpecker',
  owl: 'Owl',
  droplet: 'Water drop',
  leaves: 'Rustling leaves',
  chime: 'Chime',
  ping: 'Ping',
  pop: 'Pop',
  knock: 'Knock',
  bell: 'Bell',
};

/** How long a cue lasts, in seconds. */
export function cueLength(id: Exclude<SoundId, 'none'>): number {
  return Math.max(...SOUND_TONES[id].map((tone) => tone.at + tone.length));
}

let context: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let lastPlayed = 0;

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (noise?.sampleRate === ctx.sampleRate) return noise;
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noise = buffer;
  return buffer;
}

function playTone(ctx: BaseAudioContext, master: AudioNode, tone: Tone, start: number): void {
  const begin = start + tone.at;
  const end = begin + tone.length;
  const gain = ctx.createGain();
  const peak = tone.gain ?? 1;
  gain.gain.setValueAtTime(0.0001, begin);
  gain.gain.exponentialRampToValueAtTime(peak, begin + (tone.attack ?? 0.015));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  let source: AudioScheduledSourceNode;
  if (tone.type === 'noise') {
    const buffer = ctx.createBufferSource();
    buffer.buffer = noiseBuffer(ctx);
    buffer.loop = true;
    source = buffer;
  } else {
    const osc = ctx.createOscillator();
    osc.type = tone.type ?? 'sine';
    osc.frequency.setValueAtTime(tone.freq, begin);
    if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, end);
    if (tone.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = tone.vibrato.rate;
      depth.gain.value = tone.vibrato.depth;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(begin);
      lfo.stop(end + 0.05);
    }
    source = osc;
  }

  if (tone.filter) {
    const filter = ctx.createBiquadFilter();
    filter.type = tone.filter.type;
    filter.frequency.value = tone.freq;
    filter.Q.value = tone.filter.q ?? 1;
    source.connect(filter).connect(gain);
  } else {
    source.connect(gain);
  }
  gain.connect(master);
  source.start(begin);
  source.stop(end + 0.05);
}

/** Plays a cue at `volume` (0..100). Several finishes in the same moment play once. */
export function playSound(id: SoundId, volume: number): void {
  if (id === 'none' || volume <= 0) return;
  const now = performance.now();
  if (now - lastPlayed < 250) return;
  lastPlayed = now;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    scheduleCue(context, id, volume, context.currentTime + 0.01);
  } catch {
    // No audio device (CI, some remote sessions): the badge and notification still say it.
  }
}

/** Schedules a cue on any audio context; an `OfflineAudioContext` renders it to samples. */
export function scheduleCue(ctx: BaseAudioContext, id: Exclude<SoundId, 'none'>, volume: number, start: number): void {
  const master = ctx.createGain();
  master.gain.value = Math.min(1, volume / 100) * 0.25;
  master.connect(ctx.destination);
  for (const tone of SOUND_TONES[id]) playTone(ctx, master, tone, start);
}
