import { Geolocation, type Position } from '@capacitor/geolocation';
import { RollingAverage, type SpeedSource } from './SpeedSource';

const MS_TO_KMH = 3.6;
const EARTH_RADIUS_M = 6_371_000;

export interface GpsSpeedSourceOptions {
  pollIntervalMs: number;
  smoothingWindowSize: number;
  /** Surfaced to the UI when a permission/hardware error occurs. */
  onError?: (message: string) => void;
}

/**
 * GPS-backed speed source. Watches device position and emits smoothed speed in
 * km/h. Prefers the platform-reported `coords.speed`; when that is unavailable
 * (null), it derives speed from the distance/time between successive fixes so
 * the app still reacts on devices/browsers that don't report speed directly.
 */
export class GpsSpeedSource implements SpeedSource {
  private watchId: string | null = null;
  private readonly smoother: RollingAverage;
  private lastFix: { lat: number; lon: number; t: number } | null = null;

  constructor(private readonly options: GpsSpeedSourceOptions) {
    this.smoother = new RollingAverage(options.smoothingWindowSize);
  }

  async start(onSpeed: (speedKmh: number) => void): Promise<void> {
    try {
      const status = await Geolocation.checkPermissions();
      if (status.location !== 'granted') {
        const requested = await Geolocation.requestPermissions();
        if (requested.location !== 'granted') {
          this.options.onError?.('Location permission denied.');
          return;
        }
      }
    } catch (err) {
      // requestPermissions throws on web; fall through to watchPosition, which
      // triggers the browser's own permission prompt.
      this.options.onError?.(
        err instanceof Error ? err.message : 'Unable to check location permissions.',
      );
    }

    try {
      this.watchId = await Geolocation.watchPosition(
        {
          enableHighAccuracy: true,
          timeout: this.options.pollIntervalMs * 5,
          maximumAge: this.options.pollIntervalMs,
        },
        (position, err) => {
          if (err || !position) {
            this.options.onError?.(
              err?.message ?? 'Location unavailable.',
            );
            return;
          }
          onSpeed(this.smoother.push(this.speedFromPosition(position)));
        },
      );
    } catch (err) {
      this.options.onError?.(
        err instanceof Error ? err.message : 'Unable to start GPS.',
      );
    }
  }

  stop(): void {
    if (this.watchId !== null) {
      void Geolocation.clearWatch({ id: this.watchId });
      this.watchId = null;
    }
    this.smoother.reset();
    this.lastFix = null;
  }

  /** Speed in km/h: platform value if present, else derived from movement. */
  private speedFromPosition(position: Position): number {
    const { latitude, longitude, speed } = position.coords;
    const now = position.timestamp;

    let kmh: number;
    if (typeof speed === 'number' && Number.isFinite(speed) && speed >= 0) {
      kmh = speed * MS_TO_KMH;
    } else {
      kmh = this.deriveSpeedKmh(latitude, longitude, now);
    }

    this.lastFix = { lat: latitude, lon: longitude, t: now };
    return Math.max(0, kmh);
  }

  /** Haversine distance / elapsed time between the last two fixes. */
  private deriveSpeedKmh(lat: number, lon: number, t: number): number {
    if (!this.lastFix) return 0;
    const dtSeconds = (t - this.lastFix.t) / 1000;
    if (dtSeconds <= 0) return 0;

    const metres = haversineMetres(this.lastFix.lat, this.lastFix.lon, lat, lon);
    return (metres / dtSeconds) * MS_TO_KMH;
  }
}

function haversineMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
