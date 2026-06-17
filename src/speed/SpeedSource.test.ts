import { describe, it, expect } from 'vitest';
import { RollingAverage } from './SpeedSource';
import { SimulatorSpeedSource } from './SimulatorSpeedSource';

describe('RollingAverage', () => {
  it('averages within the window and drops old samples', () => {
    const avg = new RollingAverage(3);
    expect(avg.push(10)).toBe(10);
    expect(avg.push(20)).toBe(15);
    expect(avg.push(30)).toBe(20);
    // Window full; oldest (10) drops.
    expect(avg.push(60)).toBeCloseTo((20 + 30 + 60) / 3);
  });

  it('rejects a window smaller than 1', () => {
    expect(() => new RollingAverage(0)).toThrow();
  });
});

describe('SimulatorSpeedSource', () => {
  it('emits the current value on start and on each setSpeed', () => {
    const source = new SimulatorSpeedSource();
    const seen: number[] = [];
    source.start((kmh) => seen.push(kmh));
    source.setSpeed(45);
    source.setSpeed(90);
    expect(seen).toEqual([0, 45, 90]);
  });

  it('stops emitting after stop()', () => {
    const source = new SimulatorSpeedSource();
    const seen: number[] = [];
    source.start((kmh) => seen.push(kmh));
    source.stop();
    source.setSpeed(50);
    expect(seen).toEqual([0]);
  });
});
