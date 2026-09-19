import {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
  EndBehaviorType,
  AudioPlayer,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
} from '@discordjs/voice';
import { Client, GuildMember, VoiceBasedChannel, ChannelType } from 'discord.js';
import prism from 'prism-media';
import { PassThrough } from 'stream';
import { WebSocket } from 'ws';
import { config, validateAssemblyAIConfig } from '../../core/config.js';
import {
  mintVoiceAgentToken,
  getVoiceAgentSystemPrompt,
  getVoiceAgentToolsDefinition,
  executeVoiceAgentTool,
} from '../../core/assemblyai.js';
import {
  downsample48kStereoTo24kMono,
  upsample24kMonoTo48kStereo,
  pcm16ToBase64,
  base64ToPcm16,
  calculatePcmRms,
} from './audioUtils.js';

export interface VoiceSessionState {
  guildId: string;
  channelId: string;
  channelName: string;
  textChannelId?: string;
  connectedAt: Date;
  status: 'connecting' | 'ready' | 'speaking' | 'listening' | 'disconnected';
  lastActivityAt: Date;
}

interface ActiveSession {
  connection: VoiceConnection;
  player: AudioPlayer;
  ws: WebSocket | null;
  currentOutputStream: PassThrough | null;
  state: VoiceSessionState;
  activeUsers: Set<string>;
  idleTimeout?: NodeJS.Timeout;
}

/**
 * Manages Discord Voice Channel sessions and bidirectional streaming
 * to/from AssemblyAI Voice Agent.
 */
export class VoiceManager {
  private static sessions = new Map<string, ActiveSession>(); // key: guildId

  /**
   * Join a voice channel, connect to AssemblyAI Voice Agent WebSocket,
   * and start bidirectional real-time audio streaming.
   */
  static async joinChannel(
    voiceChannel: VoiceBasedChannel,
    invokingMember: GuildMember,
    textChannelId?: string
  ): Promise<{ success: boolean; message: string }> {
    const guildId = voiceChannel.guild.id;

    // Leave any existing connection in this guild first
    await this.leaveChannel(guildId);

    validateAssemblyAIConfig();

    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });

      // Wait until connection is ready
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

      const player = createAudioPlayer();
      connection.subscribe(player);

      const session: ActiveSession = {
        connection,
        player,
        ws: null,
        currentOutputStream: null,
        activeUsers: new Set<string>(),
        state: {
          guildId,
          channelId: voiceChannel.id,
          channelName: voiceChannel.name,
          textChannelId,
          connectedAt: new Date(),
          status: 'connecting',
          lastActivityAt: new Date(),
        },
      };

      this.sessions.set(guildId, session);

      // Handle voice connection state changes & disconnects
      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
          // Seems to be reconnecting to a new voice server - do not leave
        } catch {
          // Connection has truly been severed
          await this.leaveChannel(guildId);
        }
      });

      // Handle player state
      player.on(AudioPlayerStatus.Idle, () => {
        if (session.state.status === 'speaking') {
          session.state.status = 'listening';
        }
        if (session.currentOutputStream) {
          session.currentOutputStream = null;
        }
      });

      player.on('error', (err) => {
        console.error(`[VoiceManager] AudioPlayer error in guild ${guildId}:`, err);
        session.currentOutputStream = null;
      });

      // Initialize AssemblyAI Voice Agent session
      await this.initAssemblyAISession(session, voiceChannel, invokingMember);

      // Listen for incoming audio from Discord users in the voice channel
      this.setupUserAudioReceiver(session);

      // Setup idle timeout (disconnect after 10 mins of no activity)
      this.resetIdleTimer(guildId);

      return {
        success: true,
        message: `Joined voice channel **${voiceChannel.name}**. I am listening and ready to catch you up!`,
      };
    } catch (err: any) {
      console.error(`[VoiceManager] Failed to join voice channel ${voiceChannel.id}:`, err);
      await this.leaveChannel(guildId);
      return {
        success: false,
        message: `Failed to connect to voice channel: ${err.message || 'Unknown error'}`,
      };
    }
  }

  /**
   * Disconnect from voice channel and clean up all resources.
   */
  static async leaveChannel(guildId: string): Promise<{ success: boolean; message: string }> {
    const session = this.sessions.get(guildId);
    if (!session) {
      // Check if there is an orphaned connection
      const orphanConn = getVoiceConnection(guildId);
      if (orphanConn) {
        orphanConn.destroy();
      }
      return { success: false, message: 'Bot is not currently in a voice channel in this server.' };
    }

    if (session.idleTimeout) {
      clearTimeout(session.idleTimeout);
    }

    if (session.currentOutputStream) {
      try {
        session.currentOutputStream.destroy();
      } catch {}
      session.currentOutputStream = null;
    }

    try {
      session.player.stop();
    } catch {}

    if (session.ws) {
      try {
        session.ws.close();
      } catch {}
      session.ws = null;
    }

    try {
      session.connection.destroy();
    } catch {}

    const channelName = session.state.channelName;
    this.sessions.delete(guildId);

    return {
      success: true,
      message: `Disconnected from voice channel **${channelName}**.`,
    };
  }

  /**
   * Get current voice session status for a guild.
   */
  static getSessionStatus(guildId: string): VoiceSessionState | null {
    const session = this.sessions.get(guildId);
    return session ? { ...session.state } : null;
  }

  /**
   * Setup AssemblyAI WebSocket session
   */
  private static async initAssemblyAISession(
    session: ActiveSession,
    voiceChannel: VoiceBasedChannel,
    member: GuildMember
  ): Promise<void> {
    const tokenRes = await mintVoiceAgentToken(3600);
    const wsUrl = `${config.assemblyai.agentWsUrl}?token=${tokenRes.token}`;
    const ws = new WebSocket(wsUrl);
    session.ws = ws;

    ws.on('open', () => {
      console.log(`[VoiceManager] Connected to AssemblyAI WebSocket for guild ${voiceChannel.guild.id}`);

      const sessionUpdate = {
        type: 'session.update',
        session: {
          system_prompt: getVoiceAgentSystemPrompt(
            voiceChannel.name,
            member.displayName || member.user.username,
            voiceChannel.guild.name
          ),
          greeting: `Hello ${member.displayName || member.user.username}! I am Project Re-entry for ${voiceChannel.guild.name}. I monitor all channels across this server. Ask me what happened in any channel or what happened across the whole server today.`,
          output: {
            voice: 'ivy',
          },
          tools: getVoiceAgentToolsDefinition(),
        },
      };

      ws.send(JSON.stringify(sessionUpdate));
    });

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case 'session.ready':
            session.state.status = 'ready';
            console.log(`[VoiceManager] AssemblyAI session ready for guild ${session.state.guildId}`);
            break;

          case 'reply.audio':
            if (msg.data) {
              this.handleIncomingAudioReply(session, msg.data);
            }
            break;

          case 'reply.done':
            if (msg.status === 'interrupted') {
              // User barged in: stop audio playback immediately
              if (session.player) {
                session.player.stop(true);
              }
              if (session.currentOutputStream) {
                session.currentOutputStream.destroy();
                session.currentOutputStream = null;
              }
              session.state.status = 'listening';
            } else {
              // Natural end of agent utterance
              if (session.currentOutputStream) {
                session.currentOutputStream.end();
              }
              session.state.status = 'listening';
            }
            break;

          case 'tool.call': {
            const toolName = msg.name;
            const callId = msg.call_id;
            let args = msg.arguments || {};
            if (typeof args === 'string') {
              try {
                args = JSON.parse(args);
              } catch {
                args = {};
              }
            }

            console.log(`[VoiceManager] Executing tool call: ${toolName}`, args);

            // Execute the tool with real evidence and database
            const result = await executeVoiceAgentTool(toolName, args, {
              userId: member.user.id,
              discordId: member.user.id,
              channelId: voiceChannel.id,
              channelName: voiceChannel.name,
              guildId: voiceChannel.guild.id,
              guildName: voiceChannel.guild.name,
            });

            // Send tool.result back to AssemblyAI
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'tool.result',
                  call_id: callId,
                  result: JSON.stringify(result),
                })
              );
            }
            break;
          }

          case 'error':
            console.error(`[VoiceManager] AssemblyAI error in guild ${session.state.guildId}:`, msg);
            break;
        }
      } catch (err) {
        console.error('[VoiceManager] Failed to handle WebSocket message:', err);
      }
    });

    ws.on('error', (err) => {
      console.error(`[VoiceManager] AssemblyAI WebSocket error:`, err);
    });

    ws.on('close', (code, reason) => {
      console.log(`[VoiceManager] AssemblyAI WebSocket closed (${code}): ${reason}`);
      if (session.state.status !== 'disconnected') {
        session.state.status = 'disconnected';
      }
    });
  }

  /**
   * Handle audio reply chunks received from AssemblyAI (24kHz Mono Base64)
   * and stream them out to the Discord voice channel (48kHz Stereo PCM).
   */
  private static handleIncomingAudioReply(session: ActiveSession, base64Pcm24k: string): void {
    session.state.status = 'speaking';
    session.state.lastActivityAt = new Date();
    this.resetIdleTimer(session.state.guildId);

    // Decode 24k mono PCM and upsample to 48k stereo PCM
    const pcm24k = base64ToPcm16(base64Pcm24k);
    const pcm48kStereo = upsample24kMonoTo48kStereo(pcm24k);

    // If an output stream doesn't exist, create one and play it
    if (!session.currentOutputStream || session.currentOutputStream.destroyed) {
      session.currentOutputStream = new PassThrough();

      const resource = createAudioResource(session.currentOutputStream, {
        inputType: StreamType.Raw,
        inlineVolume: true,
      });

      session.player.play(resource);
    }

    session.currentOutputStream.write(pcm48kStereo);
  }

  /**
   * Listen to speaking events from members in the Discord voice channel,
   * decode Opus packets to PCM, downsample, and stream to AssemblyAI.
   */
  private static setupUserAudioReceiver(session: ActiveSession): void {
    const receiver = session.connection.receiver;

    receiver.speaking.on('start', (userId) => {
      // Don't listen to bot's own voice
      if (userId === session.connection.joinConfig.channelId) return;

      session.activeUsers.add(userId);
      session.state.lastActivityAt = new Date();
      this.resetIdleTimer(session.state.guildId);

      // If user starts speaking while bot is talking, handle barge-in:
      if (session.state.status === 'speaking') {
        session.player.stop(true);
        if (session.currentOutputStream) {
          session.currentOutputStream.destroy();
          session.currentOutputStream = null;
        }
        session.state.status = 'listening';
      }

      const opusStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1000,
        },
      });

      const opusDecoder = new prism.opus.Decoder({
        frameSize: 960,
        channels: 2,
        rate: 48000,
      });

      opusStream.pipe(opusDecoder);

      opusDecoder.on('data', (chunk: Buffer) => {
        // Only stream if WebSocket is open
        if (!session.ws || session.ws.readyState !== WebSocket.OPEN) return;

        // Skip absolute silence / zero energy to save bandwidth
        const rms = calculatePcmRms(chunk);
        if (rms < 0.005) return; // Background noise threshold

        // Convert 48k stereo PCM to 24k mono PCM
        const pcm24kMono = downsample48kStereoTo24kMono(chunk);
        const base64Audio = pcm16ToBase64(pcm24kMono);

        session.ws.send(
          JSON.stringify({
            type: 'input.audio',
            audio: base64Audio,
          })
        );
      });

      opusStream.on('error', (err) => {
        console.error(`[VoiceManager] Error in user audio stream (${userId}):`, err);
      });

      opusDecoder.on('error', (err) => {
        console.error(`[VoiceManager] Error in opus decoder (${userId}):`, err);
      });
    });

    receiver.speaking.on('end', (userId) => {
      session.activeUsers.delete(userId);
    });
  }

  private static resetIdleTimer(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (!session) return;

    if (session.idleTimeout) {
      clearTimeout(session.idleTimeout);
    }

    // Disconnect after 10 minutes of complete inactivity
    session.idleTimeout = setTimeout(async () => {
      console.log(`[VoiceManager] Inactivity timeout reached for guild ${guildId}, leaving voice channel.`);
      await this.leaveChannel(guildId);
    }, 10 * 60 * 1000);
  }
}
