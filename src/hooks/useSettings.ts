import { useState } from 'react';
import { clampHighSpeedThreshold, DEFAULT_DRIVING_CONFIG } from '../audio/drivingState';

const STORAGE_KEY = 'overdrive-settings';

export interface Settings {
    highSpeedThresholdKmh: number;
}

const DEFAULT_SETTINGS: Settings = {
    highSpeedThresholdKmh: DEFAULT_DRIVING_CONFIG.highSpeedThresholdKmh,
};

function loadSettings(): Settings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_SETTINGS;
        const parsed = JSON.parse(raw) as Partial<Settings>;
        return {
            highSpeedThresholdKmh: clampHighSpeedThreshold(
                Number(parsed.highSpeedThresholdKmh ?? DEFAULT_SETTINGS.highSpeedThresholdKmh),
            ),
        };
    } catch {
        return DEFAULT_SETTINGS;
    }
}

export function useSettings(): [Settings, (update: Partial<Settings>) => void] {
    const [settings, setSettings] = useState<Settings>(loadSettings);

    const updateSettings = (update: Partial<Settings>) => {
        setSettings(current => {
            const next = { ...current, ...update };
            next.highSpeedThresholdKmh = clampHighSpeedThreshold(next.highSpeedThresholdKmh);
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch {
                // Persistence is best-effort; the in-memory value still applies.
            }
            return next;
        });
    };

    return [settings, updateSettings];
}
