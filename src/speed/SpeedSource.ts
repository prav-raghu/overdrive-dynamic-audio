/**
 * A SpeedSource emits vehicle speed readings (km/h) until stopped. The engine
 * consumes whichever source the UI has selected (simulator slider or GPS),
 * staying agnostic to where the number came from.
 */
export interface SpeedSource {
  /** Begin emitting speed readings (km/h) via `onSpeed`. */
  start(onSpeed: (speedKmh: number) => void): Promise<void> | void;
  /** Stop emitting and release any underlying resources. */
  stop(): void;
}

/**
 * Fixed-size rolling average, used to smooth jittery GPS speed readings over
 * `windowSize` samples (config.gpsSpeedSmoothingWindowSize).
 */
export class RollingAverage {
  private readonly samples: number[] = [];

  constructor(private readonly windowSize: number) {
    if (windowSize < 1) {
      throw new Error(`RollingAverage windowSize must be >= 1, got ${windowSize}`);
    }
  }

  /** Push a new sample and return the current average over the window. */
  push(value: number): number {
    this.samples.push(value);
    if (this.samples.length > this.windowSize) {
      this.samples.shift();
    }
    const sum = this.samples.reduce((a, b) => a + b, 0);
    return sum / this.samples.length;
  }

  reset(): void {
    this.samples.length = 0;
  }
}
