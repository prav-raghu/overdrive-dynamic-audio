import type { SpeedSource } from './SpeedSource';

/**
 * Slider-driven speed source. The UI owns a slider and pushes its value here via
 * {@link setSpeed}; the source forwards it straight to the engine. No smoothing
 * is applied — the slider is already a clean signal.
 */
export class SimulatorSpeedSource implements SpeedSource {
  private onSpeed: ((speedKmh: number) => void) | null = null;
  private lastSpeedKmh = 0;

  start(onSpeed: (speedKmh: number) => void): void {
    this.onSpeed = onSpeed;
    // Emit the current value immediately so the engine syncs on selection.
    this.onSpeed(this.lastSpeedKmh);
  }

  stop(): void {
    this.onSpeed = null;
  }

  /** Called by the UI when the slider moves. */
  setSpeed(speedKmh: number): void {
    this.lastSpeedKmh = speedKmh;
    this.onSpeed?.(speedKmh);
  }
}
