import {
  ChatInputCommandInteraction,
  GuildMember,
  VoiceBasedChannel,
  ChannelType,
} from 'discord.js';
import { VoiceManager } from '../voice/voiceManager.js';

export async function handleVoiceCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: '❌ This command can only be used inside a Discord server.',
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand(false) || 'join';

  switch (subcommand) {
    case 'join': {
      await interaction.deferReply();

      const member = interaction.member as GuildMember;
      const specifiedChannel = interaction.options.getChannel('channel') as VoiceBasedChannel | null;

      const voiceChannel =
        specifiedChannel ||
        (member.voice?.channel as VoiceBasedChannel | null);

      if (!voiceChannel) {
        await interaction.editReply(
          '❌ You need to be in a voice channel, or specify a voice channel with `/reentry-voice join channel:#name`.'
        );
        return;
      }

      if (
        voiceChannel.type !== ChannelType.GuildVoice &&
        voiceChannel.type !== ChannelType.GuildStageVoice
      ) {
        await interaction.editReply('❌ The specified channel is not a valid voice channel.');
        return;
      }

      const result = await VoiceManager.joinChannel(
        voiceChannel,
        member,
        interaction.channelId
      );

      if (result.success) {
        await interaction.editReply(
          `🎙️ **Connected to Voice!**\n${result.message}\n\n*Speak naturally into your microphone or ask "What did I miss?" to catch up. You can interrupt at any time.*`
        );
      } else {
        await interaction.editReply(`❌ Failed to join voice channel: ${result.message}`);
      }
      break;
    }

    case 'leave': {
      await interaction.deferReply();
      const result = await VoiceManager.leaveChannel(interaction.guildId);
      if (result.success) {
        await interaction.editReply(`👋 ${result.message}`);
      } else {
        await interaction.editReply(`ℹ️ ${result.message}`);
      }
      break;
    }

    case 'status': {
      const status = VoiceManager.getSessionStatus(interaction.guildId);
      if (!status) {
        await interaction.reply({
          content: 'ℹ️ Re-entry Voice Agent is not currently connected to any voice channel in this server.',
          ephemeral: true,
        });
      } else {
        const uptimeMins = Math.round((Date.now() - status.connectedAt.getTime()) / 60000);
        await interaction.reply({
          content: `🎙️ **Voice Agent Status:**\n• **Channel:** <#${status.channelId}>\n• **Status:** \`${status.status}\`\n• **Session Duration:** ${uptimeMins} min(s)\n• **Last Activity:** ${status.lastActivityAt.toLocaleTimeString()}`,
          ephemeral: true,
        });
      }
      break;
    }

    default:
      await interaction.reply({
        content: `❌ Unknown voice action: ${subcommand}`,
        ephemeral: true,
      });
  }
}
