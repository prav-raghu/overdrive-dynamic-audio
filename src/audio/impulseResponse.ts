/**
 * Generates the "muffled cup" impulse response for the crash effect's
 * ConvolverNode entirely at runtime — no external audio asset, so the project
 * stays self-contained and free of licensing questions (spec §4).
 *
 * Approach:
 *   1. Render ~0.4s of white noise that decays exponentially.
 *   2. Bake in the "muffled" character by running the noise through a low-pass
 *      filter while rendering offline.
 *   3. Return the rendered buffer for use as ConvolverNode.buffer.
 */

const IMPULSE_DURATION_SECONDS = 0.4;
const IMPULSE_LOWPASS_HZ = 800; // muffled character
const DECAY_EXPONENT = 2; // amplitude * (1 - i/length)^2

/**
 * Renders the muffled-cup impulse response. `sampleRate` should match the live
 * AudioContext so the convolution sounds consistent.
 */
export async function createMuffledImpulseResponse(
  sampleRate: number,
): Promise<AudioBuffer> {
  const length = Math.floor(sampleRate * IMPULSE_DURATION_SECONDS);
  const offline = new OfflineAudioContext(1, length, sampleRate);

  // Source buffer: exponentially-decaying white noise.
  const noiseBuffer = offline.createBuffer(1, length, sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const envelope = Math.pow(1 - i / length, DECAY_EXPONENT);
    data[i] = (Math.random() * 2 - 1) * envelope;
  }

  const source = offline.createBufferSource();
  source.buffer = noiseBuffer;

  // Low-pass to bake in the muffled tone before convolution uses it.
  const lowpass = offline.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = IMPULSE_LOWPASS_HZ;

  source.connect(lowpass);
  lowpass.connect(offline.destination);
  source.start();

  return offline.startRendering();
}
