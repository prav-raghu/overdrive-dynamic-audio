export type DrivingMode = 'normal' | 'highSpeed' | 'crashed';

export interface DrivingConfig {
    /** Speed at which the high-speed mix kicks in (treble up, bass down). */
    highSpeedThresholdKmh: number;
    /** Hysteresis below the threshold before dropping back to the normal mix. */
    highSpeedExitHysteresisKmh: number;
    /** Minimum speed you must have been doing recently for a stop to count as a crash. */
    crashFromSpeedKmh: number;
    /** How recently (ms) that speed must have been observed. Dropping from
     * crashFromSpeedKmh to a standstill inside this window is a "hard stop". */
    crashWindowMs: number;
    /** At or below this speed the vehicle counts as stopped. */
    stopSpeedKmh: number;
    /** Once crashed, moving above this speed recovers the normal mix. */
    crashRecoveryKmh: number;
}

export const DEFAULT_DRIVING_CONFIG: DrivingConfig = {
    highSpeedThresholdKmh: 100,
    highSpeedExitHysteresisKmh: 5,
    crashFromSpeedKmh: 40,
    crashWindowMs: 2500,
    stopSpeedKmh: 2,
    crashRecoveryKmh: 6,
};

export const MIN_HIGH_SPEED_THRESHOLD_KMH = 30;
export const MAX_HIGH_SPEED_THRESHOLD_KMH = 200;

export function clampHighSpeedThreshold(value: number): number {
    if (Number.isNaN(value)) return DEFAULT_DRIVING_CONFIG.highSpeedThresholdKmh;
    return Math.min(MAX_HIGH_SPEED_THRESHOLD_KMH, Math.max(MIN_HIGH_SPEED_THRESHOLD_KMH, value));
}

interface SpeedSample {
    speedKmh: number;
    timestampMs: number;
}

/**
 * Turns a stream of GPS speed samples into a driving mode.
 *
 * A crash is a *hard* stop: the speed collapses from at least
 * `crashFromSpeedKmh` to a standstill within `crashWindowMs`. A gradual stop
 * (traffic light, parking) never triggers the crash muffle because by the
 * time the vehicle reaches 0 km/h there is no recent high-speed sample left
 * inside the window.
 */
export class DrivingStateTracker {
    private samples: SpeedSample[] = [];
    private mode: DrivingMode = 'normal';

    constructor(private config: DrivingConfig = DEFAULT_DRIVING_CONFIG) {}

    setConfig(config: DrivingConfig): void {
        this.config = config;
    }

    getMode(): DrivingMode {
        return this.mode;
    }

    reset(): void {
        this.samples = [];
        this.mode = 'normal';
    }

    update(speedKmh: number, timestampMs: number = Date.now()): DrivingMode {
        const { config } = this;
        this.samples.push({ speedKmh, timestampMs });
        this.samples = this.samples.filter(s => timestampMs - s.timestampMs <= config.crashWindowMs);

        if (this.mode === 'crashed') {
            if (speedKmh > config.crashRecoveryKmh) {
                this.mode = 'normal';
            }
            return this.mode;
        }

        const stopped = speedKmh <= config.stopSpeedKmh;
        const wasRecentlyFast = this.samples.some(s => s.speedKmh >= config.crashFromSpeedKmh);
        if (stopped && wasRecentlyFast) {
            this.mode = 'crashed';
            return this.mode;
        }

        if (this.mode === 'highSpeed') {
            if (speedKmh < config.highSpeedThresholdKmh - config.highSpeedExitHysteresisKmh) {
                this.mode = 'normal';
            }
        } else if (speedKmh >= config.highSpeedThresholdKmh) {
            this.mode = 'highSpeed';
        }

        return this.mode;
    }
}
