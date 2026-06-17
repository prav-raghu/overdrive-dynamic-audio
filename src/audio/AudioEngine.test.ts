import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioEngine } from './AudioEngine';
import { defaultOverdriveConfig, bandForSpeed } from '../config/OverdriveConfig';

/**
 * Minimal Web Audio mocks. jsdom has no Web Audio API, so we stub the pieces the
 * engine touches.
 *
 * AudioParams are time-aware: ramps are recorded as scheduled (time, value)
 * events and `.value` resolves to the most recent event at or before the
 * context's current time. This mirrors real Web Audio closely enough that
 * scheduling order (attack now, release later) behaves correctly instead of the
 * later ramp clobbering the earlier one.
 */
class FakeAudioParam {
  private events: { time: number; value: number }[] = [];
  constructor(private ctx: { currentTime: number }, initial = 0) {
    this.events.push({ time: 0, value: initial });
  }

  get value(): number {
    const now = this.ctx.currentTime;
    let resolved = this.events[0].value;
    for (const e of this.events) {
      if (e.time <= now) resolved = e.value;
    }
    return resolved;
  }

  set value(v: number) {
    this.events = [{ time: this.ctx.currentTime, value: v }];
  }

  cancelScheduledValues = (time: number) => {
    this.events = this.events.filter((e) => e.time < time);
    return this;
  };
  setValueAtTime = (v: number, time: number) => {
    this.events.push({ time, value: v });
    return this;
  };
  linearRampToValueAtTime = (v: number, time: number) => {
    this.events.push({ time, value: v });
    return this;
  };
}

class FakeBiquad {
  type = '';
  frequency: FakeAudioParam;
  gain: FakeAudioParam;
  connect = vi.fn();
  constructor(ctx: { currentTime: number }) {
    this.frequency = new FakeAudioParam(ctx);
    this.gain = new FakeAudioParam(ctx);
  }
}

class FakeGain {
  gain: FakeAudioParam;
  connect = vi.fn();
  constructor(ctx: { currentTime: number }) {
    this.gain = new FakeAudioParam(ctx);
  }
}

class FakeConvolver {
  buffer: AudioBuffer | null = null;
  connect = vi.fn();
}

class FakeMediaSource {
  mediaElement: HTMLMediaElement;
  connect = vi.fn();
  constructor(el: HTMLMediaElement) {
    this.mediaElement = el;
  }
}

class FakeAudioContext {
  state: AudioContextState = 'running';
  sampleRate = 44100;
  destination = {};
  // currentTime tracks the fake timer clock (seconds) so scheduled ramps resolve
  // at the right wall-clock moment as tests advance time.
  get currentTime(): number {
    return Date.now() / 1000;
  }
  createMediaElementSource = (el: HTMLMediaElement) => new FakeMediaSource(el);
  createBiquadFilter = () => new FakeBiquad(this);
  createGain = () => new FakeGain(this);
  createConvolver = () => new FakeConvolver();
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
}

class FakeOfflineAudioContext {
  destination = {};
  currentTime = 0;
  constructor(
    public channels: number,
    public length: number,
    public sampleRate: number,
  ) {}
  createBuffer = () => ({
    getChannelData: () => new Float32Array(this.length),
  });
  createBufferSource = () => ({ buffer: null, connect: vi.fn(), start: vi.fn() });
  createBiquadFilter = () => new FakeBiquad(this);
  startRendering = async () => ({}) as AudioBuffer;
}

function fakeMediaElement(): HTMLMediaElement {
  return { playbackRate: 1.0 } as HTMLMediaElement;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function makeEngine(): Promise<AudioEngine> {
  const engine = new AudioEngine(defaultOverdriveConfig);
  await engine.init(fakeMediaElement());
  return engine;
}

describe('AudioEngine constructor', () => {
  it('validates config and throws on a broken one', () => {
    const broken = structuredClone(defaultOverdriveConfig);
    broken.speedBands[0].volumeMultiplier = 5;
    expect(() => new AudioEngine(broken)).toThrow(/volumeMultiplier/);
  });
});

describe('volume direction (spec §7)', () => {
  it('increases volume multiplier as speed climbs through bands', async () => {
    const engine = await makeEngine();
    const stopped = bandForSpeed(defaultOverdriveConfig, 0).volumeMultiplier;

    // stopped -> cruising -> driving, letting each debounce + ramp complete.
    engine.setSpeed(40); // cruising
    vi.advanceTimersByTime(defaultOverdriveConfig.bandChangeDebounceMs + 500);
    const cruising = engine.getStatus().appliedVolumeMultiplier;

    engine.setSpeed(100); // driving
    vi.advanceTimersByTime(defaultOverdriveConfig.bandChangeDebounceMs + 500);
    const driving = engine.getStatus().appliedVolumeMultiplier;

    expect(cruising).toBeGreaterThan(stopped);
    expect(driving).toBeGreaterThan(cruising);
  });

  it('crash sharply lowers the volume multiplier to its configured value', async () => {
    const engine = await makeEngine();
    const crash = defaultOverdriveConfig.effects.find((e) => e.id === 'crash')!;

    engine.triggerEffect('crash');
    // Advance to the end of the (fast, 80ms) attack so the ramp has resolved,
    // but before hold ends so we read the full crash value.
    vi.advanceTimersByTime(crash.attackMs);
    const v = engine.getStatus().appliedVolumeMultiplier;
    expect(v).toBeCloseTo(crash.volumeMultiplier!);
    expect(v).toBeLessThan(1.0);
  });
});

describe('band change debounce (spec §3.1)', () => {
  it('does not switch bands until the debounce elapses', async () => {
    const engine = await makeEngine();
    let band = '';
    engine.onStatus((s) => {
      band = s.activeBandId;
    });

    engine.setSpeed(100); // driving, but debounced
    expect(band).toBe('stopped');
    vi.advanceTimersByTime(defaultOverdriveConfig.bandChangeDebounceMs - 1);
    expect(band).toBe('stopped');
    vi.advanceTimersByTime(1);
    expect(band).toBe('driving');
  });

  it('cancels the pending switch if speed returns to the current band', async () => {
    const engine = await makeEngine();
    let band = '';
    engine.onStatus((s) => {
      band = s.activeBandId;
    });

    engine.setSpeed(100); // pending driving
    engine.setSpeed(0); // back to stopped before debounce fires
    vi.advanceTimersByTime(defaultOverdriveConfig.bandChangeDebounceMs);
    expect(band).toBe('stopped');
  });
});

describe('last-trigger-wins (spec §3.4)', () => {
  it('crash during nitrous cancels nitrous and applies crash', async () => {
    const engine = await makeEngine();
    const nitrous = defaultOverdriveConfig.effects.find((e) => e.id === 'nitrous')!;
    const crash = defaultOverdriveConfig.effects.find((e) => e.id === 'crash')!;

    engine.triggerEffect('nitrous');
    expect(engine.getStatus().activeEffectId).toBe('nitrous');
    // Let nitrous's attack resolve, staying within its hold window.
    vi.advanceTimersByTime(nitrous.attackMs);
    expect(engine.getStatus().appliedVolumeMultiplier).toBeCloseTo(
      nitrous.volumeMultiplier!,
    );

    // Press crash partway through nitrous -> last-trigger-wins.
    engine.triggerEffect('crash');
    expect(engine.getStatus().activeEffectId).toBe('crash');
    vi.advanceTimersByTime(crash.attackMs);
    expect(engine.getStatus().appliedVolumeMultiplier).toBeCloseTo(
      crash.volumeMultiplier!,
    );

    // After crash's full envelope, the effect clears.
    vi.advanceTimersByTime(engine.effectDurationMs('crash'));
    expect(engine.isEffectActive()).toBe(false);
  });

  it('reports the effect as active for its full duration', async () => {
    const engine = await makeEngine();
    engine.triggerEffect('nitrous');
    expect(engine.isEffectActive()).toBe(true);
    vi.advanceTimersByTime(engine.effectDurationMs('nitrous') - 1);
    expect(engine.isEffectActive()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(engine.isEffectActive()).toBe(false);
  });
});
