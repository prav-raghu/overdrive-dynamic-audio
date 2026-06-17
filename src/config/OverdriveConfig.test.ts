import { describe, it, expect } from 'vitest';
import {
  defaultOverdriveConfig,
  validateConfig,
  bandForSpeed,
  effectById,
  OverdriveConfigError,
  type OverdriveConfig,
} from './OverdriveConfig';

/** Deep-clone the default config so each test can mutate freely. */
function cloneDefault(): OverdriveConfig {
  return structuredClone(defaultOverdriveConfig);
}

describe('validateConfig', () => {
  it('accepts the shipped default config', () => {
    expect(() => validateConfig(defaultOverdriveConfig)).not.toThrow();
  });

  it('throws when bands do not start at 0', () => {
    const config = cloneDefault();
    config.speedBands[0].minSpeedKmh = 5;
    expect(() => validateConfig(config)).toThrow(OverdriveConfigError);
    expect(() => validateConfig(config)).toThrow(/start at 0/);
  });

  it('throws on a gap between bands', () => {
    const config = cloneDefault();
    // stopped ends at 19, cruising starts at 20 -> make a gap.
    config.speedBands[1].minSpeedKmh = 25;
    expect(() => validateConfig(config)).toThrow(/gap or overlap/);
  });

  it('throws on an overlap between bands', () => {
    const config = cloneDefault();
    config.speedBands[0].maxSpeedKmh = 25; // overlaps cruising (starts 20)
    expect(() => validateConfig(config)).toThrow(/gap or overlap/);
  });

  it('throws when the last band has a non-null maxSpeedKmh', () => {
    const config = cloneDefault();
    config.speedBands[config.speedBands.length - 1].maxSpeedKmh = 200;
    expect(() => validateConfig(config)).toThrow(/maxSpeedKmh = null/);
  });

  it('throws when a non-last band has a null maxSpeedKmh', () => {
    const config = cloneDefault();
    config.speedBands[0].maxSpeedKmh = null;
    expect(() => validateConfig(config)).toThrow(/only the last band/);
  });

  it('throws on out-of-range volumeMultiplier', () => {
    const config = cloneDefault();
    config.speedBands[0].volumeMultiplier = 2.5;
    expect(() => validateConfig(config)).toThrow(/volumeMultiplier/);
  });

  it('throws on out-of-range frequency', () => {
    const config = cloneDefault();
    config.speedBands[0].lowPassFrequencyHz = 25000;
    expect(() => validateConfig(config)).toThrow(/out of range \[20, 20000\]/);
  });

  it('throws on out-of-range convolverWetMix', () => {
    const config = cloneDefault();
    const crash = config.effects.find((e) => e.id === 'crash');
    crash!.convolverWetMix = 1.5;
    expect(() => validateConfig(config)).toThrow(/convolverWetMix/);
  });

  it('throws on empty speedBands', () => {
    const config = cloneDefault();
    config.speedBands = [];
    expect(() => validateConfig(config)).toThrow(/must not be empty/);
  });
});

describe('bandForSpeed', () => {
  it.each([
    [0, 'stopped'],
    [19, 'stopped'],
    [20, 'cruising'],
    [59, 'cruising'],
    [60, 'driving'],
    [200, 'driving'],
  ])('maps %i km/h to the %s band', (speed, expectedId) => {
    expect(bandForSpeed(defaultOverdriveConfig, speed).id).toBe(expectedId);
  });

  it('clamps negative speeds into the lowest band', () => {
    expect(bandForSpeed(defaultOverdriveConfig, -10).id).toBe('stopped');
  });
});

describe('effectById', () => {
  it('returns the matching effect', () => {
    expect(effectById(defaultOverdriveConfig, 'nitrous').id).toBe('nitrous');
    expect(effectById(defaultOverdriveConfig, 'crash').id).toBe('crash');
  });
});
