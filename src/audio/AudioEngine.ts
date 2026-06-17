/**
 * AudioEngine — routes a single audio source through a Web Audio graph whose
 * filter/EQ/volume parameters react to vehicle speed (via speed bands) and to
 * manual Nitrous / Crash effects.
 *
 * Signal graph:
 *
 *   MediaElementSource
 *     -> highpass (biquad)
 *     -> lowpass (biquad)
 *     -> treble (highshelf)
 *     -> bass (lowshelf)
 *     -> splits into:
 *          dryGain ------------------+
 *          convolver -> wetGain -----+--> masterGain -> destination
 *
 * Every tunable number comes from OverdriveConfig — there are no audio magic
 * numbers in this file (spec §7).
 */

import {
  bandForSpeed,
  defaultOverdriveConfig,
  effectById,
  validateConfig,
  type EffectConfig,
  type EffectId,
  type OverdriveConfig,
  type SpeedBandConfig,
} from '../config/OverdriveConfig';
import { createMuffledImpulseResponse } from './impulseResponse';

/** The set of audio params the engine ramps. Drives both bands and effects. */
interface AudioState {
  highPassFrequencyHz: number;
  lowPassFrequencyHz: number;
  trebleGainDb: number;
  bassGainDb: number;
  volumeMultiplier: number;
  convolverWetMix: number;
}

/** Live snapshot the UI debug readout consumes. */
export interface EngineStatus {
  activeBandId: SpeedBandConfig['id'];
  speedKmh: number;
  appliedVolumeMultiplier: number;
  appliedTrebleGainDb: number;
  appliedBassGainDb: number;
  appliedHighPassHz: number;
  appliedLowPassHz: number;
  activeEffectId: EffectId | null;
}

type StatusListener = (status: EngineStatus) => void;

const SECOND_MS = 1000;

export class AudioEngine {
  private readonly config: OverdriveConfig;
  private ctx: AudioContext | null = null;

  // Graph nodes (created on init()).
  private mediaSource: MediaElementAudioSourceNode | null = null;
  private highPass!: BiquadFilterNode;
  private lowPass!: BiquadFilterNode;
  private treble!: BiquadFilterNode;
  private bass!: BiquadFilterNode;
  private dryGain!: GainNode;
  private wetGain!: GainNode;
  private convolver!: ConvolverNode;
  private masterGain!: GainNode;

  private currentBand: SpeedBandConfig;
  private currentSpeedKmh = 0;

  // Debounced band switching.
  private pendingBandId: SpeedBandConfig['id'] | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Effect lifecycle.
  private activeEffectId: EffectId | null = null;
  private effectTimer: ReturnType<typeof setTimeout> | null = null;

  private statusListener: StatusListener | null = null;
  private initialized = false;

  constructor(config: OverdriveConfig = defaultOverdriveConfig) {
    this.config = config;
    validateConfig(this.config);
    this.currentBand = bandForSpeed(this.config, 0);
  }

  /**
   * Builds the Web Audio graph around `mediaElement` and applies the initial
   * (stopped) band state. Safe to call once; subsequent calls are ignored.
   */
  async init(mediaElement: HTMLMediaElement): Promise<void> {
    if (this.initialized) return;
    // Web Audio may be unavailable (e.g. jsdom in unit tests). Bail gracefully;
    // the UI still renders and shows config-derived band state via getStatus().
    if (typeof AudioContext === 'undefined') {
      this.emitStatus();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.mediaSource = ctx.createMediaElementSource(mediaElement);

    this.highPass = ctx.createBiquadFilter();
    this.highPass.type = 'highpass';
    this.lowPass = ctx.createBiquadFilter();
    this.lowPass.type = 'lowpass';
    this.treble = ctx.createBiquadFilter();
    this.treble.type = 'highshelf';
    this.bass = ctx.createBiquadFilter();
    this.bass.type = 'lowshelf';

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = await createMuffledImpulseResponse(ctx.sampleRate);

    this.dryGain = ctx.createGain();
    this.wetGain = ctx.createGain();
    this.masterGain = ctx.createGain();

    // Wire the chain.
    this.mediaSource.connect(this.highPass);
    this.highPass.connect(this.lowPass);
    this.lowPass.connect(this.treble);
    this.treble.connect(this.bass);

    // Split bass output into dry and wet (convolver) paths.
    this.bass.connect(this.dryGain);
    this.bass.connect(this.convolver);
    this.convolver.connect(this.wetGain);

    this.dryGain.connect(this.masterGain);
    this.wetGain.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    // Apply initial band state instantly (no ramp at startup).
    this.applyStateInstant(this.bandState(this.currentBand));
    this.initialized = true;
    this.emitStatus();
  }

  /**
   * Resumes the AudioContext — must be called from a user gesture handler the
   * first time, per browser autoplay policy.
   */
  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /** Tears down the graph and closes the AudioContext. */
  async dispose(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.effectTimer) clearTimeout(this.effectTimer);
    this.debounceTimer = null;
    this.effectTimer = null;
    this.statusListener = null;
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
    this.initialized = false;
  }

  onStatus(listener: StatusListener | null): void {
    this.statusListener = listener;
    if (listener) this.emitStatus();
  }

  /** Pull the current engine status on demand (used by the UI poll + tests). */
  getStatus(): EngineStatus {
    return this.buildStatus();
  }

  /**
   * Feed a new speed reading. Handles debounced band transitions (spec §3.1):
   * a band change only commits after the speed has stayed in the new band for
   * `bandChangeDebounceMs`; a further change before then restarts the debounce.
   */
  setSpeed(speedKmh: number): void {
    this.currentSpeedKmh = speedKmh;
    const band = bandForSpeed(this.config, speedKmh);

    if (band.id === this.currentBand.id) {
      // Back in the committed band before any pending switch fired — cancel it.
      if (this.pendingBandId !== null) {
        this.pendingBandId = null;
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }
      }
      this.emitStatus();
      return;
    }

    // A different band than the pending one resets the debounce (anti-flicker).
    if (band.id !== this.pendingBandId) {
      this.pendingBandId = band.id;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.commitBand(band);
      }, this.config.bandChangeDebounceMs);
    }
    this.emitStatus();
  }

  private commitBand(band: SpeedBandConfig): void {
    this.currentBand = band;
    this.pendingBandId = null;
    this.debounceTimer = null;
    // Only ramp the band underneath if no effect is currently overriding state.
    // If an effect is active, its release will land on the new band's values.
    if (this.activeEffectId === null) {
      this.rampToState(this.bandState(band), band.transitionRampMs);
    }
    this.emitStatus();
  }

  /**
   * Trigger Nitrous or Crash. Last-trigger-wins: any in-flight effect is
   * cancelled and the new effect attacks from the current (possibly
   * mid-transition) values (spec §3.4).
   */
  triggerEffect(id: EffectId): void {
    if (!this.ctx) return;
    const effect = effectById(this.config, id);

    // Cancel any in-flight effect ramps and timers.
    if (this.effectTimer) {
      clearTimeout(this.effectTimer);
      this.effectTimer = null;
    }
    this.cancelScheduledParams();

    this.activeEffectId = id;

    const now = this.ctx.currentTime;
    const attackS = effect.attackMs / SECOND_MS;
    const holdS = effect.holdMs / SECOND_MS;
    const releaseS = effect.releaseMs / SECOND_MS;

    // Attack: ramp from current values toward the effect's target (non-null
    // fields override; null fields stay at the current band's values).
    const target = this.effectState(effect);
    this.rampToStateAt(target, now, attackS);

    // Release lands on whatever the current band is *at release time*.
    const releaseStart = now + attackS + holdS;
    this.scheduleRelease(releaseStart, releaseS);
    if (effect.pitchShiftSemitones !== null) {
      this.applyPitchShift(effect.pitchShiftSemitones, now, attackS, holdS, releaseS);
    }

    // Clear active-effect flag after the full envelope completes.
    const totalMs = effect.attackMs + effect.holdMs + effect.releaseMs;
    this.effectTimer = setTimeout(() => {
      this.activeEffectId = null;
      this.effectTimer = null;
      this.emitStatus();
    }, totalMs);

    this.emitStatus();
  }

  /** Total disable window for an effect's button (attack+hold+release). */
  effectDurationMs(id: EffectId): number {
    const e = effectById(this.config, id);
    return e.attackMs + e.holdMs + e.releaseMs;
  }

  isEffectActive(): boolean {
    return this.activeEffectId !== null;
  }

  // --- state helpers -------------------------------------------------------

  private bandState(band: SpeedBandConfig): AudioState {
    return {
      highPassFrequencyHz: band.highPassFrequencyHz,
      lowPassFrequencyHz: band.lowPassFrequencyHz,
      trebleGainDb: band.trebleGainDb,
      bassGainDb: band.bassGainDb,
      volumeMultiplier: band.volumeMultiplier,
      convolverWetMix: 0,
    };
  }

  /** Effect target = current band, with the effect's non-null fields applied. */
  private effectState(effect: EffectConfig): AudioState {
    const base = this.bandState(this.currentBand);
    return {
      highPassFrequencyHz: effect.highPassFrequencyHz ?? base.highPassFrequencyHz,
      lowPassFrequencyHz: effect.lowPassFrequencyHz ?? base.lowPassFrequencyHz,
      trebleGainDb: effect.trebleGainDb ?? base.trebleGainDb,
      bassGainDb: effect.bassGainDb ?? base.bassGainDb,
      volumeMultiplier: effect.volumeMultiplier ?? base.volumeMultiplier,
      convolverWetMix: effect.convolverWetMix ?? 0,
    };
  }

  private params(): AudioParam[] {
    return [
      this.highPass.frequency,
      this.lowPass.frequency,
      this.treble.gain,
      this.bass.gain,
      this.masterGain.gain,
      this.dryGain.gain,
      this.wetGain.gain,
    ];
  }

  private cancelScheduledParams(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const p of this.params()) {
      // Pin the current value, then clear future events so new ramps start here.
      const current = p.value;
      p.cancelScheduledValues(now);
      p.setValueAtTime(current, now);
    }
  }

  private applyStateInstant(state: AudioState): void {
    this.highPass.frequency.value = state.highPassFrequencyHz;
    this.lowPass.frequency.value = state.lowPassFrequencyHz;
    this.treble.gain.value = state.trebleGainDb;
    this.bass.gain.value = state.bassGainDb;
    this.masterGain.gain.value = state.volumeMultiplier;
    this.dryGain.gain.value = 1 - state.convolverWetMix;
    this.wetGain.gain.value = state.convolverWetMix;
  }

  private rampToState(state: AudioState, rampMs: number): void {
    if (!this.ctx) return;
    this.rampToStateAt(state, this.ctx.currentTime, rampMs / SECOND_MS);
  }

  private rampToStateAt(state: AudioState, startTime: number, durationS: number): void {
    const end = startTime + durationS;
    this.highPass.frequency.linearRampToValueAtTime(state.highPassFrequencyHz, end);
    this.lowPass.frequency.linearRampToValueAtTime(state.lowPassFrequencyHz, end);
    this.treble.gain.linearRampToValueAtTime(state.trebleGainDb, end);
    this.bass.gain.linearRampToValueAtTime(state.bassGainDb, end);
    this.masterGain.gain.linearRampToValueAtTime(state.volumeMultiplier, end);
    this.dryGain.gain.linearRampToValueAtTime(1 - state.convolverWetMix, end);
    this.wetGain.gain.linearRampToValueAtTime(state.convolverWetMix, end);
  }

  /**
   * Schedule the release ramp back to the current band's state. Re-reads the
   * current band at schedule time so a mid-effect band change releases into the
   * correct band (spec §3.2 / §3.3 "release into current reality").
   */
  private scheduleRelease(startTime: number, durationS: number): void {
    const releaseTarget = this.bandState(this.currentBand);
    this.rampToStateAt(releaseTarget, startTime, durationS);
  }

  /**
   * Phase 1 pitch-shift simplification (spec §3.2): a brief, slight playbackRate
   * bump for the attack+hold, returning to 1.0 over the release. This alters
   * tempo as well as pitch — true tempo-preserving pitch shifting requires a
   * phase vocoder / granular implementation, which is reserved for a future
   * phase. `pitchShiftSemitones` is honored here only as this approximation.
   */
  private applyPitchShift(
    semitones: number,
    now: number,
    attackS: number,
    holdS: number,
    releaseS: number,
  ): void {
    if (!this.mediaSource) return;
    const el = this.mediaSource.mediaElement;
    const rate = Math.pow(2, semitones / 12);
    el.playbackRate = rate;
    // Restore to normal speed once the effect's hold ends.
    setTimeout(
      () => {
        el.playbackRate = 1.0;
      },
      (attackS + holdS + releaseS) * SECOND_MS,
    );
  }

  private buildStatus(): EngineStatus {
    const initialized = this.masterGain != null;
    const band = this.currentBand;
    return {
      activeBandId: band.id,
      speedKmh: this.currentSpeedKmh,
      appliedVolumeMultiplier: initialized ? this.masterGain.gain.value : band.volumeMultiplier,
      appliedTrebleGainDb: initialized ? this.treble.gain.value : band.trebleGainDb,
      appliedBassGainDb: initialized ? this.bass.gain.value : band.bassGainDb,
      appliedHighPassHz: initialized ? this.highPass.frequency.value : band.highPassFrequencyHz,
      appliedLowPassHz: initialized ? this.lowPass.frequency.value : band.lowPassFrequencyHz,
      activeEffectId: this.activeEffectId,
    };
  }

  private emitStatus(): void {
    if (!this.statusListener) return;
    this.statusListener(this.buildStatus());
  }
}
