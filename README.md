# Overdrive — dynamic driving audio

An Ionic React app that plays any audio track and alters how it sounds in real
time based on how you're driving, in the style of Need for Speed / Burnout
Paradise:

| Driving state | Trigger | Effect on the music |
| --- | --- | --- |
| **Cruising** | Everyday speeds | Plays as usual (flat pass-through) |
| **High speed** | At/above the configurable threshold (default **100 km/h**) | Treble boosted, bass dropped |
| **Crashed** | A *hard* stop — speed collapses from ≥40 km/h to 0 within ~2.5 s | Muffled (low-pass at 450 Hz) and quieter until you move again |

A gradual stop (traffic light, parking) never triggers the crash muffle — only
a sudden drop to 0 km/h does.

Because the effects are a real-time Web Audio filter chain
(`source → bass shelf → treble shelf → low-pass → gain → speakers`), they work
on **any** track the user loads — nothing is pre-processed.

## How speed is measured

Real GPS via `@capacitor/geolocation`. The receiver's own speed reading is
used when available; otherwise speed is derived from the distance between
consecutive fixes. A **demo mode** toggle in the app substitutes a slider for
GPS so the effects can be tested without driving.

## Configuration

The high-speed threshold is adjustable in-app (30–200 km/h, persisted in
`localStorage`). Set it to your local speed limit — the high-speed mix is a
reward for pace, not an invitation to speed. Crash-detection tuning lives in
`DEFAULT_DRIVING_CONFIG` in `src/audio/drivingState.ts`.

## Project layout

- `src/audio/drivingState.ts` — state machine turning GPS speed samples into
  `normal | highSpeed | crashed`, with hysteresis and hard-stop detection
- `src/audio/audioEngine.ts` — Web Audio effect chain and the per-state mix
  profiles, with smooth parameter ramps between states
- `src/hooks/useDrivingSpeed.ts` — GPS watcher (plus demo-mode override)
- `src/hooks/useSettings.ts` — persisted settings
- `src/pages/Home.tsx` — UI: track picker, playback, speed dial, settings

## Running

```bash
npm install --legacy-peer-deps
npm run dev        # web dev server
npm run test.unit  # vitest unit tests
npm run typecheck
npm run build
```

## Native platform notes

When adding native platforms (`npx cap add android` / `npx cap add ios`), the
geolocation plugin needs the usual permissions:

- **Android** (`AndroidManifest.xml`):
  `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, and
  `<uses-feature android:name="android.hardware.location.gps" />`
- **iOS** (`Info.plist`): `NSLocationWhenInUseUsageDescription`

Audio starts from a user tap (browser/webview autoplay policy), after which
the driving state modulates it hands-free.
