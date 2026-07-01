import { describe, expect, it } from 'vitest';
import type { Position } from '@capacitor/geolocation';
import { mpsToKmh, speedFromPositions } from './useDrivingSpeed';

function fix(lat: number, lon: number, timestamp: number, speed: number | null = null): Position {
    return {
        timestamp,
        coords: {
            latitude: lat,
            longitude: lon,
            accuracy: 5,
            altitudeAccuracy: null,
            altitude: null,
            speed,
            heading: null,
        },
    };
}

describe('speedFromPositions', () => {
    it('prefers the GPS receiver speed when present', () => {
        const current = fix(0, 0, 1000, 27.78); // ~100 km/h in m/s
        expect(speedFromPositions(current, null)).toBeCloseTo(100, 0);
    });

    it('derives speed from consecutive fixes when the receiver reports none', () => {
        // ~0.001° of longitude at the equator is ~111 m; covered in 4 s → ~100 km/h.
        const previous = fix(0, 0, 0);
        const current = fix(0, 0.001, 4000);
        const kmh = speedFromPositions(current, previous);
        expect(kmh).not.toBeNull();
        expect(kmh!).toBeGreaterThan(90);
        expect(kmh!).toBeLessThan(110);
    });

    it('returns null without a previous fix or receiver speed', () => {
        expect(speedFromPositions(fix(0, 0, 1000), null)).toBeNull();
    });

    it('returns null for non-increasing timestamps', () => {
        const previous = fix(0, 0, 2000);
        const current = fix(0, 0.001, 2000);
        expect(speedFromPositions(current, previous)).toBeNull();
    });
});

describe('mpsToKmh', () => {
    it('converts metres per second to km/h', () => {
        expect(mpsToKmh(10)).toBeCloseTo(36);
    });
});
