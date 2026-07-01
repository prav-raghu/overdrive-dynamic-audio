import { useEffect, useMemo, useRef, useState } from 'react';
import {
    IonBadge,
    IonButton,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardSubtitle,
    IonCardTitle,
    IonContent,
    IonHeader,
    IonIcon,
    IonItem,
    IonLabel,
    IonNote,
    IonPage,
    IonRange,
    IonTitle,
    IonToggle,
    IonToolbar,
} from '@ionic/react';
import { musicalNotes, pause, play, speedometer } from 'ionicons/icons';
import { DynamicAudioEngine } from '../audio/audioEngine';
import {
    DEFAULT_DRIVING_CONFIG,
    DrivingStateTracker,
    MAX_HIGH_SPEED_THRESHOLD_KMH,
    MIN_HIGH_SPEED_THRESHOLD_KMH,
    type DrivingMode,
} from '../audio/drivingState';
import { useDrivingSpeed } from '../hooks/useDrivingSpeed';
import { useSettings } from '../hooks/useSettings';
import './Home.css';

const MODE_LABELS: Record<DrivingMode, string> = {
    normal: 'Cruising',
    highSpeed: 'High speed',
    crashed: 'Crashed',
};

const MODE_COLORS: Record<DrivingMode, string> = {
    normal: 'success',
    highSpeed: 'warning',
    crashed: 'danger',
};

const MODE_HINTS: Record<DrivingMode, string> = {
    normal: 'Music playing as usual',
    highSpeed: 'Treble up, bass dropped',
    crashed: 'Muffled — get moving to recover',
};

const Home: React.FC = () => {
    const [settings, updateSettings] = useSettings();
    const [demoMode, setDemoMode] = useState(false);
    const [demoSpeedKmh, setDemoSpeedKmh] = useState(0);
    const [mode, setMode] = useState<DrivingMode>('normal');
    const [trackName, setTrackName] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const engineRef = useRef<DynamicAudioEngine | null>(null);
    const objectUrlRef = useRef<string | null>(null);
    const trackerRef = useRef(new DrivingStateTracker());

    const { speedKmh, gpsError } = useDrivingSpeed(demoMode, demoSpeedKmh);

    const drivingConfig = useMemo(
        () => ({ ...DEFAULT_DRIVING_CONFIG, highSpeedThresholdKmh: settings.highSpeedThresholdKmh }),
        [settings.highSpeedThresholdKmh],
    );

    useEffect(() => {
        trackerRef.current.setConfig(drivingConfig);
    }, [drivingConfig]);

    useEffect(() => {
        if (speedKmh === null) return;
        const nextMode = trackerRef.current.update(speedKmh);
        setMode(nextMode);
        engineRef.current?.setMode(nextMode);
    }, [speedKmh]);

    useEffect(() => {
        return () => {
            engineRef.current?.dispose();
            engineRef.current = null;
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
            }
        };
    }, []);

    const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        const audio = audioRef.current;
        if (!file || !audio) return;

        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
        }
        objectUrlRef.current = URL.createObjectURL(file);
        audio.src = objectUrlRef.current;
        setTrackName(file.name);
        setIsPlaying(false);

        if (!engineRef.current) {
            engineRef.current = new DynamicAudioEngine();
            engineRef.current.attach(audio);
        }
        engineRef.current.setMode(trackerRef.current.getMode());
    };

    const togglePlayback = async () => {
        const audio = audioRef.current;
        const engine = engineRef.current;
        if (!audio || !engine) return;

        await engine.resume();
        if (audio.paused) {
            await audio.play();
            setIsPlaying(true);
        } else {
            audio.pause();
            setIsPlaying(false);
        }
    };

    const displaySpeed = speedKmh === null ? '—' : Math.round(speedKmh).toString();

    return (
        <IonPage>
            <IonHeader>
                <IonToolbar>
                    <IonTitle>Overdrive</IonTitle>
                </IonToolbar>
            </IonHeader>
            <IonContent fullscreen>
                <div className="speed-dial">
                    <IonIcon icon={speedometer} className="speed-dial__icon" />
                    <div className="speed-dial__value" data-testid="speed-value">
                        {displaySpeed}
                    </div>
                    <div className="speed-dial__unit">km/h</div>
                    <IonBadge color={MODE_COLORS[mode]} className="speed-dial__mode" data-testid="mode-badge">
                        {MODE_LABELS[mode]}
                    </IonBadge>
                    <IonNote className="speed-dial__hint">{MODE_HINTS[mode]}</IonNote>
                    {gpsError && !demoMode && (
                        <IonNote color="danger" className="speed-dial__hint">
                            GPS: {gpsError}
                        </IonNote>
                    )}
                </div>

                <IonCard>
                    <IonCardHeader>
                        <IonCardSubtitle>Now playing</IonCardSubtitle>
                        <IonCardTitle className="track-title">
                            {trackName ?? 'No track loaded'}
                        </IonCardTitle>
                    </IonCardHeader>
                    <IonCardContent className="track-controls">
                        <IonButton fill="outline" onClick={() => document.getElementById('track-input')?.click()}>
                            <IonIcon slot="start" icon={musicalNotes} />
                            Choose track
                        </IonButton>
                        <IonButton onClick={togglePlayback} disabled={!trackName}>
                            <IonIcon slot="start" icon={isPlaying ? pause : play} />
                            {isPlaying ? 'Pause' : 'Play'}
                        </IonButton>
                        <input
                            id="track-input"
                            type="file"
                            accept="audio/*"
                            hidden
                            onChange={handleFileSelected}
                        />
                        {/* Hidden element: audio is routed through the Web Audio chain */}
                        <audio ref={audioRef} loop />
                    </IonCardContent>
                </IonCard>

                <IonCard>
                    <IonCardHeader>
                        <IonCardSubtitle>Settings</IonCardSubtitle>
                    </IonCardHeader>
                    <IonCardContent>
                        <IonItem lines="none">
                            <IonRange
                                label={`High-speed mix at ${settings.highSpeedThresholdKmh} km/h`}
                                labelPlacement="stacked"
                                min={MIN_HIGH_SPEED_THRESHOLD_KMH}
                                max={MAX_HIGH_SPEED_THRESHOLD_KMH}
                                step={5}
                                snaps
                                value={settings.highSpeedThresholdKmh}
                                onIonChange={e =>
                                    updateSettings({ highSpeedThresholdKmh: Number(e.detail.value) })
                                }
                            />
                        </IonItem>
                        <IonNote className="settings-note">
                            Set this to your local speed limit — the high-speed mix is a reward for
                            pace, not an invitation to speed.
                        </IonNote>
                    </IonCardContent>
                </IonCard>

                <IonCard>
                    <IonCardHeader>
                        <IonCardSubtitle>Demo mode</IonCardSubtitle>
                    </IonCardHeader>
                    <IonCardContent>
                        <IonItem lines="none">
                            <IonToggle
                                checked={demoMode}
                                onIonChange={e => setDemoMode(e.detail.checked)}
                            >
                                Simulate speed instead of GPS
                            </IonToggle>
                        </IonItem>
                        {demoMode && (
                            <IonItem lines="none">
                                <IonLabel position="stacked">
                                    Simulated speed: {demoSpeedKmh} km/h
                                </IonLabel>
                                <IonRange
                                    min={0}
                                    max={200}
                                    step={1}
                                    value={demoSpeedKmh}
                                    onIonInput={e => setDemoSpeedKmh(Number(e.detail.value))}
                                />
                            </IonItem>
                        )}
                    </IonCardContent>
                </IonCard>
            </IonContent>
        </IonPage>
    );
};

export default Home;
