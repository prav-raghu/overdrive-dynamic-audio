import type { DrivingMode } from './drivingState';

export interface EffectProfile {
    /** Low-shelf gain in dB at 200 Hz. */
    bassGainDb: number;
    /** High-shelf gain in dB at 3 kHz. */
    trebleGainDb: number;
    /** Low-pass cutoff in Hz. 20 kHz means effectively wide open. */
    lowpassHz: number;
    /** Master volume, 0–1. */
    volume: number;
    /** Time constant of the exponential ramp towards the target values. */
    rampSeconds: number;
}

const OPEN_LOWPASS_HZ = 20000;

/**
 * The three mixes. High speed pushes the treble up and drops the bass, a
 * crash slams a low-pass filter shut so the track sounds muffled and distant,
 * and normal driving is a flat pass-through.
 */
export const EFFECT_PROFILES: Record<DrivingMode, EffectProfile> = {
    normal: {
        bassGainDb: 0,
        trebleGainDb: 0,
        lowpassHz: OPEN_LOWPASS_HZ,
        volume: 1,
        rampSeconds: 0.4,
    },
    highSpeed: {
        bassGainDb: -8,
        trebleGainDb: 9,
        lowpassHz: OPEN_LOWPASS_HZ,
        volume: 1,
        rampSeconds: 0.6,
    },
    crashed: {
        bassGainDb: 0,
        trebleGainDb: 0,
        lowpassHz: 450,
        volume: 0.55,
        rampSeconds: 0.12,
    },
};

/**
 * Real-time Web Audio chain applied to any media element, so the effects work
 * on whatever track the user loads:
 *
 *   source → low-shelf (bass) → high-shelf (treble) → low-pass (muffle) → gain → speakers
 */
export class DynamicAudioEngine {
    private context: AudioContext;
    private bassShelf: BiquadFilterNode;
    private trebleShelf: BiquadFilterNode;
    private muffle: BiquadFilterNode;
    private masterGain: GainNode;
    private source: MediaElementAudioSourceNode | null = null;
    private mode: DrivingMode = 'normal';

    constructor(context?: AudioContext) {
        this.context = context ?? new AudioContext();

        this.bassShelf = this.context.createBiquadFilter();
        this.bassShelf.type = 'lowshelf';
        this.bassShelf.frequency.value = 200;

        this.trebleShelf = this.context.createBiquadFilter();
        this.trebleShelf.type = 'highshelf';
        this.trebleShelf.frequency.value = 3000;

        this.muffle = this.context.createBiquadFilter();
        this.muffle.type = 'lowpass';
        this.muffle.frequency.value = OPEN_LOWPASS_HZ;

        this.masterGain = this.context.createGain();

        this.bassShelf.connect(this.trebleShelf);
        this.trebleShelf.connect(this.muffle);
        this.muffle.connect(this.masterGain);
        this.masterGain.connect(this.context.destination);
    }

    /** Route a media element through the chain. Safe to call once per element. */
    attach(element: HTMLMediaElement): void {
        if (this.source) {
            this.source.disconnect();
        }
        this.source = this.context.createMediaElementSource(element);
        this.source.connect(this.bassShelf);
    }

    /** Browsers suspend AudioContexts until a user gesture; call from a tap handler. */
    async resume(): Promise<void> {
        if (this.context.state === 'suspended') {
            await this.context.resume();
        }
    }

    getMode(): DrivingMode {
        return this.mode;
    }

    setMode(mode: DrivingMode): void {
        if (mode === this.mode) return;
        this.mode = mode;
        this.applyProfile(EFFECT_PROFILES[mode]);
    }

    applyProfile(profile: EffectProfile): void {
        const now = this.context.currentTime;
        this.bassShelf.gain.setTargetAtTime(profile.bassGainDb, now, profile.rampSeconds);
        this.trebleShelf.gain.setTargetAtTime(profile.trebleGainDb, now, profile.rampSeconds);
        this.muffle.frequency.setTargetAtTime(profile.lowpassHz, now, profile.rampSeconds);
        this.masterGain.gain.setTargetAtTime(profile.volume, now, profile.rampSeconds);
    }

    async dispose(): Promise<void> {
        this.source?.disconnect();
        this.source = null;
        if (this.context.state !== 'closed') {
            await this.context.close();
        }
    }
}
