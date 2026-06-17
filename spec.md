# overdrive-dynamic-audio — Phase 1 Addendum: Configurable Thresholds & Detailed Effect Behavior

This addendum extends `PHASE_1_SPEC.md`. It exists because speed thresholds, volume behavior, and effect curves must be **fully configurable** (no hardcoded magic numbers), and the exact trigger conditions for every audio change need to be unambiguous before Claude Code starts building.

## 1. Configuration Object (single source of truth)

All tunable values live in one typed config object. Nothing in the audio engine, UI, or speed logic should hardcode a number that appears here. This is the file a user (or future you) edits to retune the whole experience without touching engine code.

```typescript
// config/OverdriveConfig.ts

interface SpeedBandConfig {
  id: 'stopped' | 'cruising' | 'driving';
  minSpeedKmh: number;          // inclusive lower bound
  maxSpeedKmh: number | null;   // inclusive upper bound, null = no upper limit
  highPassFrequencyHz: number;
  lowPassFrequencyHz: number;
  trebleGainDb: number;
  bassGainDb: number;
  volumeMultiplier: number;     // 1.0 = unchanged, 0.0–2.0 range
  transitionRampMs: number;
}

interface EffectConfig {
  id: 'nitrous' | 'crash';
  highPassFrequencyHz: number | null;  // null = not modified by this effect
  lowPassFrequencyHz: number | null;
  trebleGainDb: number | null;
  bassGainDb: number | null;
  volumeMultiplier: number | null;
  convolverWetMix: number | null;       // 0.0–1.0, only used by crash
  pitchShiftSemitones: number | null;   // only used by nitrous
  attackMs: number;       // time to reach full effect
  holdMs: number;          // time to stay at full effect before reverting
  releaseMs: number;       // time to ramp back to the underlying speed band's state
}

interface OverdriveConfig {
  speedBands: SpeedBandConfig[];
  effects: EffectConfig[];
  bandChangeDebounceMs: number;    // min time a new speed must persist before band switches
  gpsPollIntervalMs: number;        // how often GpsSpeedSource samples position
  gpsSpeedSmoothingWindowSize: number; // rolling average sample count to reduce GPS jitter
}
```

## 2. Default Config Values (the actual numbers, fully populated)

This is the literal starting config Claude Code should ship as the default export. Every number here is what was previously described loosely in prose — now it's exhaustive and exact.

```typescript
export const defaultOverdriveConfig: OverdriveConfig = {
  speedBands: [
    {
      id: 'stopped',
      minSpeedKmh: 0,
      maxSpeedKmh: 19,
      highPassFrequencyHz: 20,      // effectively no high-pass
      lowPassFrequencyHz: 20000,    // effectively no low-pass
      trebleGainDb: 0,
      bassGainDb: 0,
      volumeMultiplier: 1.0,
      transitionRampMs: 200,
    },
    {
      id: 'cruising',
      minSpeedKmh: 20,
      maxSpeedKmh: 59,
      highPassFrequencyHz: 80,
      lowPassFrequencyHz: 20000,
      trebleGainDb: 1.5,
      bassGainDb: 0,
      volumeMultiplier: 1.05,        // barely-there lift, not loudness-war territory
      transitionRampMs: 250,
    },
    {
      id: 'driving',
      minSpeedKmh: 60,
      maxSpeedKmh: null,
      highPassFrequencyHz: 150,
      lowPassFrequencyHz: 20000,
      trebleGainDb: 3,
      bassGainDb: -1,
      volumeMultiplier: 1.1,
      transitionRampMs: 250,
    },
  ],
  effects: [
    {
      id: 'nitrous',
      highPassFrequencyHz: 400,      // sweeps from current band's value up to this
      lowPassFrequencyHz: null,       // unaffected
      trebleGainDb: 4,
      bassGainDb: -4,
      volumeMultiplier: 1.15,
      convolverWetMix: null,
      pitchShiftSemitones: 2,
      attackMs: 300,
      holdMs: 700,
      releaseMs: 2000,
    },
    {
      id: 'crash',
      highPassFrequencyHz: null,      // unaffected
      lowPassFrequencyHz: 500,        // slams down to this
      trebleGainDb: -6,
      bassGainDb: -2,
      volumeMultiplier: 0.6,           // crash genuinely lowers volume, simulating impact/shock
      convolverWetMix: 0.7,
      pitchShiftSemitones: null,
      attackMs: 80,           // crash hits FAST, almost instant
      holdMs: 400,
      releaseMs: 2500,         // slow recovery, "ears ringing back to normal"
    },
  ],
  bandChangeDebounceMs: 1000,
  gpsPollIntervalMs: 1000,
  gpsSpeedSmoothingWindowSize: 3,
};
```

## 3. Exact Trigger Logic — When Each Thing Happens

This section removes all ambiguity about *when* volume goes up, down, or muffles.

### 3.1 Speed band transitions (volume/EQ changes from driving)
- On every speed reading (from simulator slider or GPS), look up which `SpeedBandConfig` the speed falls into using `minSpeedKmh`/`maxSpeedKmh` (inclusive bounds, bands must never overlap or gap — validate this at config load time and throw a clear error if they do).
- If the matched band differs from the currently active band, start a debounce timer for `bandChangeDebounceMs`.
- If the speed is still in the new band when the timer fires, transition: ramp `highPassFrequencyHz`, `lowPassFrequencyHz`, `trebleGainDb`, `bassGainDb`, and `volumeMultiplier` from current values to the new band's values using `linearRampToValueAtTime` over `transitionRampMs`.
- If speed changes bands again before the debounce timer fires, cancel the pending transition and restart debounce against the newest band (prevents flicker).
- **Volume goes up**: moving from `stopped` → `cruising` → `driving` (volumeMultiplier 1.0 → 1.05 → 1.1).
- **Volume goes down**: reverse direction, same ramp logic, same durations.

### 3.2 Nitrous trigger (manual button)
- On button press: immediately begin `attackMs` ramp from current state's filter/volume values toward the `nitrous` effect's values (only the non-null fields override; null fields stay at whatever the current speed band has them at).
- Hold at full nitrous state for `holdMs`.
- Then ramp over `releaseMs` back to **whatever the current speed band's values are at that moment** (not necessarily what they were when the button was pressed — if the car has changed speed bands mid-effect, release into the new correct band state).
- Pitch shift: implement via `playbackRate` adjustment on the audio source combined with a compensating tempo correction if available, OR simplest Phase 1 approach — skip true pitch-shift-without-tempo-change complexity and just note in code comments that `pitchShiftSemitones` is reserved for a future granular pitch-shift implementation; Phase 1 may implement it as a brief, slight `playbackRate` bump (which will alter tempo too) since true independent pitch-shifting requires a phase vocoder or library beyond Phase 1 scope. Acceptable simplification — flag to user in PR description, don't silently skip it.
- Button is debounced/disabled for the duration of `attackMs + holdMs + releaseMs` to prevent re-trigger spam.

### 3.3 Crash trigger (manual button, Phase 1)
- On button press: immediately (within `attackMs`, which is intentionally fast at 80ms) ramp toward crash effect values — this is the one effect that should feel sudden, not smooth-creeping.
- Engage `ConvolverNode` wet mix per `convolverWetMix` (a simple impulse response buffer needs to be generated or sourced — see Section 4 below for how to create this without external assets).
- **Volume goes down** sharply (`volumeMultiplier: 0.6`) — this is the "shock/impact" feel.
- Hold for `holdMs`, then `releaseMs` ramp back to current speed band's actual values (same "release into current reality" rule as nitrous).
- Same re-trigger debounce as nitrous: disabled for `attackMs + holdMs + releaseMs`.

### 3.4 What happens if Nitrous and Crash are triggered close together
- Phase 1 rule: **last trigger wins**. If Crash is pressed while Nitrous is still in its hold/release phase, immediately cancel Nitrous's remaining ramps and start Crash's attack phase from whatever the current (mid-transition) values are. Do not queue effects.

## 4. Generating the "Muffled Cup" Impulse Response Without External Audio Assets

To avoid needing to source/license an impulse response file, generate one programmatically at runtime using Web Audio API's offline buffer generation:

```typescript
// pseudo-approach, agent should implement properly in TS:
// 1. Create an AudioBuffer of ~0.3-0.5 seconds
// 2. Fill it with white noise that decays exponentially (envelope: amplitude * Math.pow(1 - i/length, 2))
// 3. Run it through a low-pass filter (~800Hz) when generating, to bake in the "muffled" character
// 4. Use this buffer as the ConvolverNode's .buffer
```

This keeps the project dependency-free for audio assets and fully self-contained — important for an open source repo where you don't want licensing questions about a downloaded impulse response file.

## 5. Config Validation Rules (must be enforced at startup, fail loudly if violated)

- Speed bands must cover 0 to infinity with no gaps and no overlaps (sorted by `minSpeedKmh`, each band's `maxSpeedKmh + 1 === nextBand.minSpeedKmh`, last band's `maxSpeedKmh` must be `null`)
- All `volumeMultiplier` values must be between 0.0 and 2.0
- All frequency values must be between 20 and 20000 (valid audible/filter range)
- `convolverWetMix` and any 0–1 ranged value must be validated as such
- Throw a descriptive `OverdriveConfigError` on any violation — do not silently clamp or ignore, since this is a tuning tool and silent clamping would hide mistakes during development

## 6. UI Requirements Tied to Config (so it's not just an internal data structure)

- Simulator screen should display the **currently active band's name and its live volumeMultiplier/EQ values** in a small debug readout, so when tuning by ear you can see exactly which numbers are currently applied
- Consider (optional, not required for Phase 1 acceptance) a simple settings screen that lets you edit `defaultOverdriveConfig` values at runtime and see/hear changes immediately — this turns the app into its own tuning tool. If time permits, build it; if not, editing the TS file and hot-reloading is an acceptable Phase 1 workflow.

## 7. Updated Acceptance Criteria (additions to original spec)

- [ ] All speed thresholds, volume multipliers, and filter values live in `OverdriveConfig.ts` — zero magic numbers in `AudioEngine.ts` or anywhere else
- [ ] Config validation runs at startup and throws clear errors on invalid configs (test this with at least one deliberately broken config in Jest)
- [ ] Volume changes are audible and directionally correct: speeding up increases volumeMultiplier, crash sharply decreases it, release ramps return to the correct current-band state
- [ ] Impulse response for "muffled cup" effect is generated programmatically at runtime, no external audio file dependency
- [ ] Nitrous and Crash buttons are disabled/debounced for their full effect duration to prevent spam-triggering
- [ ] Triggering Crash while Nitrous is active correctly cancels Nitrous and starts Crash immediately (last-trigger-wins behavior verified)
