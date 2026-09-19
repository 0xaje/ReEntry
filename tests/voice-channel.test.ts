import { describe, it, expect } from 'vitest';
import {
  downsample48kStereoTo24kMono,
  downsample48kMonoTo24kMono,
  upsample24kMonoTo48kStereo,
  calculatePcmRms,
  pcm16ToBase64,
  base64ToPcm16,
} from '../src/discord/voice/audioUtils.js';

describe('Discord Voice Audio Utils', () => {
  it('converts 48kHz stereo to 24kHz mono accurately', () => {
    // 8 bytes in 48kHz stereo = [L0, R0, L1, R1]
    // Let's create a buffer of 8 bytes with values 1000, 2000, 3000, 4000
    // Average = (1000 + 2000 + 3000 + 4000) / 4 = 2500
    const stereoBuf = Buffer.alloc(8);
    stereoBuf.writeInt16LE(1000, 0);
    stereoBuf.writeInt16LE(2000, 2);
    stereoBuf.writeInt16LE(3000, 4);
    stereoBuf.writeInt16LE(4000, 6);

    const monoBuf = downsample48kStereoTo24kMono(stereoBuf);
    expect(monoBuf.length).toBe(2);
    expect(monoBuf.readInt16LE(0)).toBe(2500);
  });

  it('converts 48kHz mono to 24kHz mono accurately', () => {
    // 4 bytes in 48kHz mono = [S0, S1]
    const mono48k = Buffer.alloc(4);
    mono48k.writeInt16LE(1000, 0);
    mono48k.writeInt16LE(3000, 2);

    const mono24k = downsample48kMonoTo24kMono(mono48k);
    expect(mono24k.length).toBe(2);
    expect(mono24k.readInt16LE(0)).toBe(2000);
  });

  it('upsamples 24kHz mono to 48kHz stereo with interpolation', () => {
    // 2 samples at 24kHz mono: 1000, 3000
    const monoBuf = Buffer.alloc(4);
    monoBuf.writeInt16LE(1000, 0);
    monoBuf.writeInt16LE(3000, 2);

    const stereoBuf = upsample24kMonoTo48kStereo(monoBuf);
    // 2 samples in 24k -> 2 * 8 = 16 bytes in 48k stereo
    expect(stereoBuf.length).toBe(16);

    // First frame (sample 0, L & R): 1000, 1000
    expect(stereoBuf.readInt16LE(0)).toBe(1000);
    expect(stereoBuf.readInt16LE(2)).toBe(1000);
    // Second frame (interpolated between 1000 and 3000 = 2000): 2000, 2000
    expect(stereoBuf.readInt16LE(4)).toBe(2000);
    expect(stereoBuf.readInt16LE(6)).toBe(2000);
    // Third frame (sample 1, L & R): 3000, 3000
    expect(stereoBuf.readInt16LE(8)).toBe(3000);
    expect(stereoBuf.readInt16LE(10)).toBe(3000);
  });

  it('computes RMS audio level correctly', () => {
    // Silence
    const silence = Buffer.alloc(100);
    expect(calculatePcmRms(silence)).toBe(0);

    // Full scale square wave (alternating +32767, -32768)
    const squareWave = Buffer.alloc(4);
    squareWave.writeInt16LE(32767, 0);
    squareWave.writeInt16LE(-32768, 2);
    const rms = calculatePcmRms(squareWave);
    expect(rms).toBeGreaterThan(0.95);
    expect(rms).toBeLessThanOrEqual(1.0);
  });

  it('round-trips PCM16 base64 encoding and decoding', () => {
    const original = Buffer.alloc(10);
    for (let i = 0; i < 5; i++) {
      original.writeInt16LE((i - 2) * 5000, i * 2);
    }

    const b64 = pcm16ToBase64(original);
    const decoded = base64ToPcm16(b64);

    expect(decoded.equals(original)).toBe(true);
  });
});

describe('VoiceManager & Slash Command', () => {
  it('reports null status when no active voice session in guild', async () => {
    const { VoiceManager } = await import('../src/discord/voice/voiceManager.js');
    const status = VoiceManager.getSessionStatus('non-existent-guild');
    expect(status).toBeNull();
  });

  it('safely handles leaveChannel when not in a voice channel', async () => {
    const { VoiceManager } = await import('../src/discord/voice/voiceManager.js');
    const res = await VoiceManager.leaveChannel('non-existent-guild');
    expect(res.success).toBe(false);
    expect(res.message).toContain('not currently in a voice channel');
  });

  it('rejects /reentry-voice when run outside of a guild', async () => {
    const { handleVoiceCommand } = await import('../src/discord/commands/voice.js');
    let repliedMsg: any = null;
    const fakeInteraction = {
      guildId: null,
      guild: null,
      options: {
        getSubcommand: () => 'join',
      },
      reply: async (msg: any) => {
        repliedMsg = msg;
      },
    } as any;

    await handleVoiceCommand(fakeInteraction);
    expect(repliedMsg.content).toContain('only be used inside a Discord server');
  });

  it('rejects /reentry-voice join when member is not in a voice channel and none specified', async () => {
    const { handleVoiceCommand } = await import('../src/discord/commands/voice.js');
    let repliedMsg: any = null;
    let deferred = false;

    const fakeInteraction = {
      guildId: 'guild-123',
      guild: { id: 'guild-123' },
      channelId: 'channel-text-123',
      member: {
        user: { id: 'user-1', username: 'alice' },
        voice: { channel: null },
      },
      options: {
        getSubcommand: () => 'join',
        getChannel: () => null,
      },
      deferReply: async () => {
        deferred = true;
      },
      editReply: async (msg: any) => {
        repliedMsg = msg;
      },
    } as any;

    await handleVoiceCommand(fakeInteraction);
    expect(deferred).toBe(true);
    expect(repliedMsg).toContain('You need to be in a voice channel');
  });
});

