import { useRef } from 'react';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonRange,
  IonSegment,
  IonSegmentButton,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { useOverdrive, type SpeedMode } from '../hooks/useOverdrive';
import { defaultOverdriveConfig } from '../config/OverdriveConfig';
import './Simulator.css';

const MAX_SLIDER_KMH = 160;

const Simulator: React.FC = () => {
  const od = useOverdrive();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const status = od.status;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Overdrive</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="ion-padding">
        {/* Hidden media element the engine processes. */}
        <audio
          ref={(el) => {
            audioRef.current = el;
            od.attach(el);
          }}
          hidden
        />

        <IonList inset>
          <IonItem>
            <IonLabel>Source</IonLabel>
            <IonSegment
              value={od.speedMode}
              onIonChange={(e) =>
                od.setSpeedMode((e.detail.value as SpeedMode) ?? 'simulator')
              }
            >
              <IonSegmentButton value="simulator">
                <IonLabel>Simulator</IonLabel>
              </IonSegmentButton>
              <IonSegmentButton value="gps">
                <IonLabel>GPS</IonLabel>
              </IonSegmentButton>
            </IonSegment>
          </IonItem>

          {od.speedMode === 'simulator' && (
            <IonItem>
              <IonRange
                aria-label="Speed"
                min={0}
                max={MAX_SLIDER_KMH}
                pin
                pinFormatter={(v) => `${v} km/h`}
                onIonInput={(e) => od.setSimulatorSpeed(e.detail.value as number)}
              >
                <IonLabel slot="start">0</IonLabel>
                <IonLabel slot="end">{MAX_SLIDER_KMH}</IonLabel>
              </IonRange>
            </IonItem>
          )}

          {od.speedMode === 'gps' && od.gpsError && (
            <IonItem color="warning">
              <IonLabel className="ion-text-wrap">{od.gpsError}</IonLabel>
            </IonItem>
          )}
        </IonList>

        <div className="controls">
          <IonButton expand="block" onClick={() => void od.togglePlay()}>
            {od.isPlaying ? 'Pause' : 'Play'}
          </IonButton>

          <IonButton
            expand="block"
            color="success"
            disabled={od.effectCooldownMs.nitrous > 0}
            onClick={() => od.triggerEffect('nitrous')}
          >
            Nitrous{cooldownLabel(od.effectCooldownMs.nitrous)}
          </IonButton>

          <IonButton
            expand="block"
            color="danger"
            disabled={od.effectCooldownMs.crash > 0}
            onClick={() => od.triggerEffect('crash')}
          >
            Crash{cooldownLabel(od.effectCooldownMs.crash)}
          </IonButton>

          <IonButton
            expand="block"
            fill="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            Load audio file…
          </IonButton>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) od.loadUserFile(file);
            }}
          />
        </div>

        {/* Debug readout (spec §6): live applied values for tuning by ear. */}
        <div className="debug-readout">
          <IonText color="medium">
            <h2>Debug readout</h2>
          </IonText>
          {status ? (
            <IonList inset>
              <IonItem>
                <IonLabel>Active band</IonLabel>
                <IonNote slot="end">{status.activeBandId}</IonNote>
              </IonItem>
              <IonItem>
                <IonLabel>Speed</IonLabel>
                <IonNote slot="end">{status.speedKmh.toFixed(1)} km/h</IonNote>
              </IonItem>
              <IonItem>
                <IonLabel>Volume ×</IonLabel>
                <IonNote slot="end">{status.appliedVolumeMultiplier.toFixed(3)}</IonNote>
              </IonItem>
              <IonItem>
                <IonLabel>Treble</IonLabel>
                <IonNote slot="end">{status.appliedTrebleGainDb.toFixed(1)} dB</IonNote>
              </IonItem>
              <IonItem>
                <IonLabel>Bass</IonLabel>
                <IonNote slot="end">{status.appliedBassGainDb.toFixed(1)} dB</IonNote>
              </IonItem>
              <IonItem>
                <IonLabel>High-pass</IonLabel>
                <IonNote slot="end">{status.appliedHighPassHz.toFixed(0)} Hz</IonNote>
              </IonItem>
              <IonItem>
                <IonLabel>Low-pass</IonLabel>
                <IonNote slot="end">{status.appliedLowPassHz.toFixed(0)} Hz</IonNote>
              </IonItem>
              <IonItem>
                <IonLabel>Active effect</IonLabel>
                <IonNote slot="end">{status.activeEffectId ?? '—'}</IonNote>
              </IonItem>
            </IonList>
          ) : (
            <IonNote>Press Play to start the engine.</IonNote>
          )}
        </div>

        <IonText color="medium">
          <p className="config-hint">
            Bands: {defaultOverdriveConfig.speedBands.map((b) => b.id).join(' · ')}
          </p>
        </IonText>
      </IonContent>
    </IonPage>
  );
};

function cooldownLabel(ms: number): string {
  return ms > 0 ? ` (${(ms / 1000).toFixed(1)}s)` : '';
}

export default Simulator;
