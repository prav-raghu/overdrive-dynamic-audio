import { useEffect, useRef, useState } from 'react';
import { Geolocation, type Position } from '@capacitor/geolocation';

const EARTH_RADIUS_M = 6371000;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function mpsToKmh(mps: number): number {
    return mps * 3.6;
}

/**
 * Derive km/h from a GPS fix. Prefers the receiver's own speed reading and
 * falls back to distance-over-time between consecutive fixes, since many
 * devices report `coords.speed` as null.
 */
export function speedFromPositions(current: Position, previous: Position | null): number | null {
    if (typeof current.coords.speed === 'number' && current.coords.speed >= 0) {
        return mpsToKmh(current.coords.speed);
    }
    if (!previous) return null;
    const dtSeconds = (current.timestamp - previous.timestamp) / 1000;
    if (dtSeconds <= 0) return null;
    const meters = haversineMeters(
        previous.coords.latitude,
        previous.coords.longitude,
        current.coords.latitude,
        current.coords.longitude,
    );
    return mpsToKmh(meters / dtSeconds);
}

export interface DrivingSpeed {
    /** Current speed in km/h, or null until the first usable fix arrives. */
    speedKmh: number | null;
    gpsError: string | null;
}

/**
 * Watches real GPS speed. When demo mode is on, the GPS watcher is torn down
 * and the simulated speed is reported instead, so effects can be tested
 * without driving.
 */
export function useDrivingSpeed(demoMode: boolean, demoSpeedKmh: number): DrivingSpeed {
    const [speedKmh, setSpeedKmh] = useState<number | null>(null);
    const [gpsError, setGpsError] = useState<string | null>(null);
    const previousFix = useRef<Position | null>(null);

    useEffect(() => {
        if (demoMode) return;

        let cancelled = false;
        let watchId: string | null = null;
        previousFix.current = null;

        Geolocation.watchPosition(
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 },
            (position, err) => {
                if (cancelled) return;
                if (err || !position) {
                    setGpsError(err?.message ?? 'No GPS fix available');
                    return;
                }
                setGpsError(null);
                const kmh = speedFromPositions(position, previousFix.current);
                previousFix.current = position;
                if (kmh !== null) {
                    setSpeedKmh(kmh);
                }
            },
        )
            .then(id => {
                if (cancelled) {
                    Geolocation.clearWatch({ id });
                } else {
                    watchId = id;
                }
            })
            .catch(err => {
                if (!cancelled) {
                    setGpsError(err instanceof Error ? err.message : 'Location permission denied');
                }
            });

        return () => {
            cancelled = true;
            if (watchId) {
                Geolocation.clearWatch({ id: watchId });
            }
        };
    }, [demoMode]);

    if (demoMode) {
        return { speedKmh: demoSpeedKmh, gpsError: null };
    }
    return { speedKmh, gpsError };
}
