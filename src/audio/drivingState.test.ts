import { describe, expect, it } from 'vitest';
import {
    clampHighSpeedThreshold,
    DEFAULT_DRIVING_CONFIG,
    DrivingStateTracker,
} from './drivingState';

function trackerWith(overrides: Partial<typeof DEFAULT_DRIVING_CONFIG> = {}) {
    return new DrivingStateTracker({ ...DEFAULT_DRIVING_CONFIG, ...overrides });
}

describe('DrivingStateTracker', () => {
    it('stays normal at everyday speeds', () => {
        const tracker = trackerWith();
        expect(tracker.update(0, 0)).toBe('normal');
        expect(tracker.update(60, 1000)).toBe('normal');
        expect(tracker.update(99, 2000)).toBe('normal');
    });

    it('enters high speed at the threshold and exits with hysteresis', () => {
        const tracker = trackerWith();
        expect(tracker.update(100, 0)).toBe('highSpeed');
        // Small dips below the threshold do not flap the mix back.
        expect(tracker.update(97, 1000)).toBe('highSpeed');
        expect(tracker.update(94, 2000)).toBe('normal');
    });

    it('respects a configurable threshold', () => {
        const tracker = trackerWith({ highSpeedThresholdKmh: 60 });
        expect(tracker.update(59, 0)).toBe('normal');
        expect(tracker.update(60, 1000)).toBe('highSpeed');
    });

    it('detects a crash as a hard stop from speed', () => {
        const tracker = trackerWith();
        tracker.update(80, 0);
        expect(tracker.update(0, 1500)).toBe('crashed');
    });

    it('does not treat a gradual stop as a crash', () => {
        const tracker = trackerWith();
        let time = 0;
        // Brake smoothly from 60 to 0 over 12 seconds, like at a red light.
        for (let speed = 60; speed >= 0; speed -= 5) {
            tracker.update(speed, time);
            time += 1000;
        }
        expect(tracker.getMode()).toBe('normal');
    });

    it('recovers from a crash once moving again', () => {
        const tracker = trackerWith();
        tracker.update(90, 0);
        tracker.update(0, 1000);
        expect(tracker.getMode()).toBe('crashed');
        // Still stopped: stays muffled.
        expect(tracker.update(0, 5000)).toBe('crashed');
        expect(tracker.update(3, 8000)).toBe('crashed');
        // Rolling again: back to normal.
        expect(tracker.update(15, 10000)).toBe('normal');
    });

    it('does not crash-loop after recovering at low speed', () => {
        const tracker = trackerWith();
        tracker.update(90, 0);
        tracker.update(0, 1000);
        tracker.update(15, 3000);
        expect(tracker.getMode()).toBe('normal');
        // The old 90 km/h sample is outside the window, so stopping again is fine.
        expect(tracker.update(0, 10000)).toBe('normal');
    });

    it('goes straight from high speed to crashed on a hard stop', () => {
        const tracker = trackerWith();
        expect(tracker.update(120, 0)).toBe('highSpeed');
        expect(tracker.update(0, 2000)).toBe('crashed');
    });
});

describe('clampHighSpeedThreshold', () => {
    it('keeps values inside the allowed range', () => {
        expect(clampHighSpeedThreshold(100)).toBe(100);
        expect(clampHighSpeedThreshold(10)).toBe(30);
        expect(clampHighSpeedThreshold(500)).toBe(200);
        expect(clampHighSpeedThreshold(Number.NaN)).toBe(100);
    });
});
