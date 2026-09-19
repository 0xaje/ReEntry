/**
 * Audio conversion and DSP utilities for Discord <-> AssemblyAI voice bridging.
 *
 * Discord voice standard: 48,000 Hz, 16-bit stereo PCM (little-endian).
 * AssemblyAI voice standard: 24,000 Hz, 16-bit mono PCM (little-endian).
 */

/**
 * Downsample 48kHz 16-bit stereo PCM to 24kHz 16-bit mono PCM.
 * Reduces sample rate by 2:1 and blends stereo channels into mono.
 */
export function downsample48kStereoTo24kMono(buffer48kStereo: Buffer): Buffer {
  const bytesPerBlock = 8; // 2 samples * 2 channels * 2 bytes = 8 bytes
  const blocks = Math.floor(buffer48kStereo.length / bytesPerBlock);
  const outBuf = Buffer.allocUnsafe(blocks * 2);

  for (let i = 0; i < blocks; i++) {
    const offset = i * bytesPerBlock;
    const l0 = buffer48kStereo.readInt16LE(offset);
    const r0 = buffer48kStereo.readInt16LE(offset + 2);
    const l1 = buffer48kStereo.readInt16LE(offset + 4);
    const r1 = buffer48kStereo.readInt16LE(offset + 6);

    // Average across channels and time
    const avg = Math.max(-32768, Math.min(32767, Math.round((l0 + r0 + l1 + r1) / 4)));
    outBuf.writeInt16LE(avg, i * 2);
  }

  return outBuf;
}

/**
 * Downsample 48kHz 16-bit mono PCM to 24kHz 16-bit mono PCM.
 * Reduces sample rate by 2:1.
 */
export function downsample48kMonoTo24kMono(buffer48kMono: Buffer): Buffer {
  const bytesPerBlock = 4; // 2 samples * 2 bytes = 4 bytes
  const blocks = Math.floor(buffer48kMono.length / bytesPerBlock);
  const outBuf = Buffer.allocUnsafe(blocks * 2);

  for (let i = 0; i < blocks; i++) {
    const offset = i * bytesPerBlock;
    const s0 = buffer48kMono.readInt16LE(offset);
    const s1 = buffer48kMono.readInt16LE(offset + 2);

    const avg = Math.max(-32768, Math.min(32767, Math.round((s0 + s1) / 2)));
    outBuf.writeInt16LE(avg, i * 2);
  }

  return outBuf;
}

/**
 * Upsample 24kHz 16-bit mono PCM to 48kHz 16-bit stereo PCM.
 * 1:2 interpolation with linear sample smoothing and dual-channel replication.
 */
export function upsample24kMonoTo48kStereo(buffer24kMono: Buffer): Buffer {
  const sampleCount = Math.floor(buffer24kMono.length / 2);
  if (sampleCount === 0) return Buffer.alloc(0);

  // Each 24kHz mono sample produces two 48kHz stereo frames (4 samples total = 8 bytes)
  const outBuf = Buffer.allocUnsafe(sampleCount * 8);

  for (let i = 0; i < sampleCount; i++) {
    const s0 = buffer24kMono.readInt16LE(i * 2);
    const s1 = i + 1 < sampleCount ? buffer24kMono.readInt16LE((i + 1) * 2) : s0;
    const mid = Math.max(-32768, Math.min(32767, Math.round((s0 + s1) / 2)));

    const outOffset = i * 8;
    // Frame 1: original sample on L & R
    outBuf.writeInt16LE(s0, outOffset);
    outBuf.writeInt16LE(s0, outOffset + 2);
    // Frame 2: interpolated midpoint sample on L & R
    outBuf.writeInt16LE(mid, outOffset + 4);
    outBuf.writeInt16LE(mid, outOffset + 6);
  }

  return outBuf;
}

/**
 * Calculate Root Mean Square (RMS) volume of 16-bit PCM buffer.
 * Returns normalized value between 0.0 and 1.0.
 */
export function calculatePcmRms(pcmBuffer: Buffer): number {
  const sampleCount = Math.floor(pcmBuffer.length / 2);
  if (sampleCount === 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i++) {
    const val = pcmBuffer.readInt16LE(i * 2) / 32768;
    sumSquares += val * val;
  }

  return Math.sqrt(sumSquares / sampleCount);
}

/**
 * Encode 16-bit PCM Buffer to Base64 string for AssemblyAI WebSocket.
 */
export function pcm16ToBase64(pcmBuffer: Buffer): string {
  return pcmBuffer.toString('base64');
}

/**
 * Decode Base64 string from AssemblyAI WebSocket to 16-bit PCM Buffer.
 */
export function base64ToPcm16(base64Str: string): Buffer {
  return Buffer.from(base64Str, 'base64');
}
