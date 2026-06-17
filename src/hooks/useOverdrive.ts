import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioEngine, type EngineStatus } from '../audio/AudioEngine';
import { createEngineLoopUrl } from '../audio/engineLoop';
import {
  defaultOverdriveConfig,
  type EffectId,
} from '../config/OverdriveConfig';
import { GpsSpeedSource } from '../speed/GpsSpeedSource';
import { SimulatorSpeedSource } from '../speed/SimulatorSpeedSource';
import type { SpeedSource } from '../speed/SpeedSource';

export type SpeedMode = 'simulator' | 'gps';

export interface UseOverdrive {
  status: EngineStatus | null;
  isPlaying: boolean;
  speedMode: SpeedMode;
  /** Per-effect remaining disable time in ms (0 = enabled). */
  effectCooldownMs: Record<EffectId, number>;
  gpsError: string | null;
  attach: (el: HTMLAudioElement | null) => void;
  togglePlay: () => Promise<void>;
  setSpeedMode: (mode: SpeedMode) => void;
  setSimulatorSpeed: (kmh: number) => void;
  triggerEffect: (id: EffectId) => void;
  loadUserFile: (file: File) => void;
}

const config = defaultOverdriveConfig;

/**
 * Owns the AudioEngine + active SpeedSource lifecycle and exposes a flat API for
 * the Simulator UI. The engine is created once; speed sources are swapped when
 * the mode changes.
 */
export function useOverdrive(): UseOverdrive {
  // Lazy state initializer constructs the engine exactly once.
  const [engine] = useState(() => new AudioEngine(config));
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const simSourceRef = useRef<SimulatorSpeedSource>(new SimulatorSpeedSource());
  const activeSourceRef = useRef<SpeedSource | null>(null);
  const loopUrlRef = useRef<string | null>(null);
  const userUrlRef = useRef<string | null>(null);
  const cooldownTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedMode, setSpeedModeState] = useState<SpeedMode>('simulator');
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [effectCooldownMs, setEffectCooldownMs] = useState<Record<EffectId, number>>({
    nitrous: 0,
    crash: 0,
  });

  const startSource = useCallback(
    (source: SpeedSource) => {
      activeSourceRef.current?.stop();
      activeSourceRef.current = source;
      void source.start((kmh) => engine.setSpeed(kmh));
    },
    [engine],
  );

  const attach = useCallback(
    (el: HTMLAudioElement | null) => {
      if (!el || audioElRef.current === el) return;
      audioElRef.current = el;
      if (!loopUrlRef.current) {
        loopUrlRef.current = createEngineLoopUrl();
      }
      el.src = loopUrlRef.current;
      el.loop = true;
      void engine.init(el).then(() => {
        engine.onStatus(setStatus);
        startSource(simSourceRef.current);
      });
    },
    [engine, startSource],
  );

  const togglePlay = useCallback(async () => {
    const el = audioElRef.current;
    if (!el) return;
    await engine.resume();
    if (el.paused) {
      await el.play();
      setIsPlaying(true);
    } else {
      el.pause();
      setIsPlaying(false);
    }
  }, [engine]);

  const setSpeedMode = useCallback(
    (mode: SpeedMode) => {
      setSpeedModeState(mode);
      setGpsError(null);
      if (mode === 'simulator') {
        startSource(simSourceRef.current);
      } else {
        const gps = new GpsSpeedSource({
          pollIntervalMs: config.gpsPollIntervalMs,
          smoothingWindowSize: config.gpsSpeedSmoothingWindowSize,
          onError: setGpsError,
        });
        startSource(gps);
      }
    },
    [startSource],
  );

  const setSimulatorSpeed = useCallback((kmh: number) => {
    simSourceRef.current.setSpeed(kmh);
  }, []);

  const triggerEffect = useCallback(
    (id: EffectId) => {
      if (effectCooldownMs[id] > 0) return;
      engine.triggerEffect(id);

      // Drive a visible countdown for the button's disabled window.
      const total = engine.effectDurationMs(id);
      const startedAt = Date.now();
      setEffectCooldownMs((prev) => ({ ...prev, [id]: total }));
      clearInterval(cooldownTimers.current[id]);
      cooldownTimers.current[id] = setInterval(() => {
        const remaining = Math.max(0, total - (Date.now() - startedAt));
        setEffectCooldownMs((prev) => ({ ...prev, [id]: remaining }));
        if (remaining <= 0) clearInterval(cooldownTimers.current[id]);
      }, 100);
    },
    [engine, effectCooldownMs],
  );

  const loadUserFile = useCallback(
    (file: File) => {
      const el = audioElRef.current;
      if (!el) return;
      if (userUrlRef.current) URL.revokeObjectURL(userUrlRef.current);
      userUrlRef.current = URL.createObjectURL(file);
      el.src = userUrlRef.current;
      el.loop = true;
      if (isPlaying) void el.play();
    },
    [isPlaying],
  );

  // Teardown on unmount.
  useEffect(() => {
    const timers = cooldownTimers.current;
    return () => {
      activeSourceRef.current?.stop();
      void engine.dispose();
      Object.values(timers).forEach(clearInterval);
      if (loopUrlRef.current) URL.revokeObjectURL(loopUrlRef.current);
      if (userUrlRef.current) URL.revokeObjectURL(userUrlRef.current);
    };
  }, [engine]);

  return useMemo(
    () => ({
      status,
      isPlaying,
      speedMode,
      effectCooldownMs,
      gpsError,
      attach,
      togglePlay,
      setSpeedMode,
      setSimulatorSpeed,
      triggerEffect,
      loadUserFile,
    }),
    [
      status,
      isPlaying,
      speedMode,
      effectCooldownMs,
      gpsError,
      attach,
      togglePlay,
      setSpeedMode,
      setSimulatorSpeed,
      triggerEffect,
      loadUserFile,
    ],
  );
}
