/**
 * Generates a seamless looping "engine drone" as a WAV Blob URL at runtime.
 *
 * Like the impulse response, this keeps the project free of any bundled audio
 * asset (no licensing questions) while still giving the engine a real, musical
 * source to process. Users can replace it at runtime by loading their own file.
 *
 * The drone is a small stack of detuned sawtooth-ish partials with a slow
 * amplitude wobble, rendered for a whole number of fundamental cycles so the
 * end of the buffer joins its start without a click when looped.
 */

const SAMPLE_RATE = 44100;
const FUNDAMENTAL_HZ = 70; // low engine rumble
const LOOP_CYCLES = 140; // whole cycles -> seamless loop (~2s)
const PARTIALS = [1, 2, 3, 4.01, 6.02]; // slight detune on upper partials
const PARTIAL_GAINS = [1.0, 0.6, 0.4, 0.25, 0.15];
const WOBBLE_HZ = 6; // amplitude modulation for "idle" character
const WOBBLE_DEPTH = 0.15;
const MASTER_GAIN = 0.25;

/** Builds the looping engine drone and returns an object URL for an <audio> src. */
export function createEngineLoopUrl(): string {
  const periodSeconds = LOOP_CYCLES / FUNDAMENTAL_HZ;
  const length = Math.round(periodSeconds * SAMPLE_RATE);
  const samples = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    let value = 0;
    for (let p = 0; p < PARTIALS.length; p++) {
      value += PARTIAL_GAINS[p] * Math.sin(2 * Math.PI * FUNDAMENTAL_HZ * PARTIALS[p] * t);
    }
    const wobble = 1 + WOBBLE_DEPTH * Math.sin(2 * Math.PI * WOBBLE_HZ * t);
    samples[i] = value * wobble;
  }

  // Normalize to avoid clipping, then apply master gain.
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const scale = (peak > 0 ? MASTER_GAIN / peak : MASTER_GAIN) * 1;
  for (let i = 0; i < length; i++) samples[i] *= scale;

  const wav = encodeWavMono(samples, SAMPLE_RATE);
  return URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
}

/** Encodes a mono Float32 sample array as a 16-bit PCM WAV ArrayBuffer. */
function encodeWavMono(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }
  return buffer;
}
