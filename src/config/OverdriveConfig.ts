/**
 * OverdriveConfig — single source of truth for every tunable value in the app.
 *
 * Nothing in the audio engine, UI, or speed logic should hardcode a number that
 * appears here. Edit this file (and hot-reload) to retune the whole experience
 * without touching engine code.
 */

export type SpeedBandId = 'stopped' | 'cruising' | 'driving';
export type EffectId = 'nitrous' | 'crash';

export interface SpeedBandConfig {
  id: SpeedBandId;
  minSpeedKmh: number; // inclusive lower bound
  maxSpeedKmh: number | null; // inclusive upper bound, null = no upper limit
  highPassFrequencyHz: number;
  lowPassFrequencyHz: number;
  trebleGainDb: number;
  bassGainDb: number;
  volumeMultiplier: number; // 1.0 = unchanged, 0.0–2.0 range
  transitionRampMs: number;
}

export interface EffectConfig {
  id: EffectId;
  highPassFrequencyHz: number | null; // null = not modified by this effect
  lowPassFrequencyHz: number | null;
  trebleGainDb: number | null;
  bassGainDb: number | null;
  volumeMultiplier: number | null;
  convolverWetMix: number | null; // 0.0–1.0, only used by crash
  pitchShiftSemitones: number | null; // only used by nitrous
  attackMs: number; // time to reach full effect
  holdMs: number; // time to stay at full effect before reverting
  releaseMs: number; // time to ramp back to the underlying speed band's state
}

export interface OverdriveConfig {
  speedBands: SpeedBandConfig[];
  effects: EffectConfig[];
  bandChangeDebounceMs: number; // min time a new speed must persist before band switches
  gpsPollIntervalMs: number; // how often GpsSpeedSource samples position
  gpsSpeedSmoothingWindowSize: number; // rolling average sample count to reduce GPS jitter
}

/**
 * The literal starting config shipped as the default. Every number here was
 * previously described loosely in prose — now it is exhaustive and exact.
 */
export const defaultOverdriveConfig: OverdriveConfig = {
  speedBands: [
    {
      id: 'stopped',
      minSpeedKmh: 0,
      maxSpeedKmh: 19,
      highPassFrequencyHz: 20, // effectively no high-pass
      lowPassFrequencyHz: 20000, // effectively no low-pass
      trebleGainDb: 0,
      bassGainDb: 0,
      volumeMultiplier: 1.0,
      transitionRampMs: 200,
    },
    {
      id: 'cruising',
      minSpeedKmh: 20,
      maxSpeedKmh: 59,
      highPassFrequencyHz: 80,
      lowPassFrequencyHz: 20000,
      trebleGainDb: 1.5,
      bassGainDb: 0,
      volumeMultiplier: 1.05, // barely-there lift, not loudness-war territory
      transitionRampMs: 250,
    },
    {
      id: 'driving',
      minSpeedKmh: 60,
      maxSpeedKmh: null,
      highPassFrequencyHz: 150,
      lowPassFrequencyHz: 20000,
      trebleGainDb: 3,
      bassGainDb: -1,
      volumeMultiplier: 1.1,
      transitionRampMs: 250,
    },
  ],
  effects: [
    {
      id: 'nitrous',
      highPassFrequencyHz: 400, // sweeps from current band's value up to this
      lowPassFrequencyHz: null, // unaffected
      trebleGainDb: 4,
      bassGainDb: -4,
      volumeMultiplier: 1.15,
      convolverWetMix: null,
      pitchShiftSemitones: 2,
      attackMs: 300,
      holdMs: 700,
      releaseMs: 2000,
    },
    {
      id: 'crash',
      highPassFrequencyHz: null, // unaffected
      lowPassFrequencyHz: 500, // slams down to this
      trebleGainDb: -6,
      bassGainDb: -2,
      volumeMultiplier: 0.6, // crash genuinely lowers volume, simulating impact/shock
      convolverWetMix: 0.7,
      pitchShiftSemitones: null,
      attackMs: 80, // crash hits FAST, almost instant
      holdMs: 400,
      releaseMs: 2500, // slow recovery, "ears ringing back to normal"
    },
  ],
  bandChangeDebounceMs: 1000,
  gpsPollIntervalMs: 1000,
  gpsSpeedSmoothingWindowSize: 3,
};

/** Audible / valid biquad filter frequency range, in Hz. */
const MIN_FREQUENCY_HZ = 20;
const MAX_FREQUENCY_HZ = 20000;
/** Allowed volume multiplier range. */
const MIN_VOLUME_MULTIPLIER = 0.0;
const MAX_VOLUME_MULTIPLIER = 2.0;

/**
 * Thrown when {@link validateConfig} finds an invalid config. This is a tuning
 * tool — we fail loudly rather than silently clamp, so mistakes surface during
 * development instead of being masked.
 */
export class OverdriveConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverdriveConfigError';
  }
}

function assertVolume(value: number, label: string): void {
  if (value < MIN_VOLUME_MULTIPLIER || value > MAX_VOLUME_MULTIPLIER) {
    throw new OverdriveConfigError(
      `${label} volumeMultiplier ${value} is out of range [${MIN_VOLUME_MULTIPLIER}, ${MAX_VOLUME_MULTIPLIER}]`,
    );
  }
}

function assertFrequency(value: number, label: string): void {
  if (value < MIN_FREQUENCY_HZ || value > MAX_FREQUENCY_HZ) {
    throw new OverdriveConfigError(
      `${label} ${value}Hz is out of range [${MIN_FREQUENCY_HZ}, ${MAX_FREQUENCY_HZ}]`,
    );
  }
}

function assertUnitRange(value: number, label: string): void {
  if (value < 0 || value > 1) {
    throw new OverdriveConfigError(`${label} ${value} is out of range [0, 1]`);
  }
}

/**
 * Validates an {@link OverdriveConfig}, throwing {@link OverdriveConfigError} on
 * the first violation. Call once at startup (engine init) and let it throw.
 *
 * Rules (per spec §5):
 * - Speed bands cover 0→∞ with no gaps and no overlaps: sorted by `minSpeedKmh`,
 *   each band's `maxSpeedKmh + 1 === nextBand.minSpeedKmh`, last band's
 *   `maxSpeedKmh` is `null`, first band starts at 0.
 * - All `volumeMultiplier` values within [0, 2].
 * - All frequency values within [20, 20000].
 * - `convolverWetMix` (and any 0–1 ranged value) within [0, 1].
 */
export function validateConfig(config: OverdriveConfig): void {
  const { speedBands, effects } = config;

  if (speedBands.length === 0) {
    throw new OverdriveConfigError('speedBands must not be empty');
  }

  const sorted = [...speedBands].sort((a, b) => a.minSpeedKmh - b.minSpeedKmh);

  if (sorted[0].minSpeedKmh !== 0) {
    throw new OverdriveConfigError(
      `speed bands must start at 0; lowest band "${sorted[0].id}" starts at ${sorted[0].minSpeedKmh}`,
    );
  }

  for (let i = 0; i < sorted.length; i++) {
    const band = sorted[i];
    const label = `band "${band.id}"`;
    const isLast = i === sorted.length - 1;

    assertVolume(band.volumeMultiplier, label);
    assertFrequency(band.highPassFrequencyHz, `${label} highPassFrequencyHz`);
    assertFrequency(band.lowPassFrequencyHz, `${label} lowPassFrequencyHz`);

    if (isLast) {
      if (band.maxSpeedKmh !== null) {
        throw new OverdriveConfigError(
          `last band "${band.id}" must have maxSpeedKmh = null (no upper limit), got ${band.maxSpeedKmh}`,
        );
      }
    } else {
      if (band.maxSpeedKmh === null) {
        throw new OverdriveConfigError(
          `only the last band may have maxSpeedKmh = null; band "${band.id}" is not last`,
        );
      }
      const next = sorted[i + 1];
      if (band.maxSpeedKmh + 1 !== next.minSpeedKmh) {
        throw new OverdriveConfigError(
          `gap or overlap between band "${band.id}" (max ${band.maxSpeedKmh}) and "${next.id}" ` +
            `(min ${next.minSpeedKmh}); expected next.minSpeedKmh === ${band.maxSpeedKmh + 1}`,
        );
      }
    }
  }

  for (const effect of effects) {
    const label = `effect "${effect.id}"`;
    if (effect.volumeMultiplier !== null) {
      assertVolume(effect.volumeMultiplier, label);
    }
    if (effect.highPassFrequencyHz !== null) {
      assertFrequency(effect.highPassFrequencyHz, `${label} highPassFrequencyHz`);
    }
    if (effect.lowPassFrequencyHz !== null) {
      assertFrequency(effect.lowPassFrequencyHz, `${label} lowPassFrequencyHz`);
    }
    if (effect.convolverWetMix !== null) {
      assertUnitRange(effect.convolverWetMix, `${label} convolverWetMix`);
    }
  }
}

/** Returns the band whose [minSpeedKmh, maxSpeedKmh] range contains `speedKmh`. */
export function bandForSpeed(
  config: OverdriveConfig,
  speedKmh: number,
): SpeedBandConfig {
  const clamped = Math.max(0, speedKmh);
  const band = config.speedBands.find(
    (b) =>
      clamped >= b.minSpeedKmh &&
      (b.maxSpeedKmh === null || clamped <= b.maxSpeedKmh),
  );
  // Validation guarantees full 0→∞ coverage, so this is always defined.
  return band ?? config.speedBands[config.speedBands.length - 1];
}

/** Looks up an effect config by id. Throws if absent. */
export function effectById(config: OverdriveConfig, id: EffectId): EffectConfig {
  const effect = config.effects.find((e) => e.id === id);
  if (!effect) {
    throw new OverdriveConfigError(`no effect configured with id "${id}"`);
  }
  return effect;
}
