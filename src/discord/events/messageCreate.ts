import type { Client, Message } from 'discord.js';
import {
  storeDiscordMessage,
  extractEventsFromMessages,
  upsertChannel,
  upsertGuild,
} from '../../core/index.js';
import type { DiscordMessage } from '../../core/types.js';

export function handleMessageCreate(client: Client): void {
  client.on('messageCreate', async (message: Message) => {
    // Ignore bot messages to avoid self-referencing loops
    if (message.author.bot) return;

    try {
      const guildId = message.guildId || 'direct-messages';
      const channelId = message.channelId;
      const channelName = 'name' in message.channel ? (message.channel as any).name : 'direct-messages';
      const jumpUrl = `https://discord.com/channels/${message.guildId || '@me'}/${channelId}/${message.id}`;

      // Serialize attachments metadata (URL, name, contentType)
      const attachmentsMeta = Array.from(message.attachments.values()).map(att => ({
        id: att.id,
        name: att.name,
        url: att.url,
        contentType: att.contentType,
        size: att.size,
      }));

      const discordMsg: DiscordMessage = {
        discord_message_id: message.id,
        guild_id: guildId,
        channel_id: channelId,
        channel_name: channelName,
        author_id: message.author.id,
        author_name: message.author.displayName || message.author.username,
        author_avatar: message.author.displayAvatarURL(),
        content: message.content || (attachmentsMeta.length > 0 ? `[Attached: ${attachmentsMeta.map(a => a.name).join(', ')}]` : ''),
        timestamp: message.createdAt,
        reply_to_message_id: message.reference?.messageId || null,
        thread_id: message.thread?.id || null,
        attachments_json: attachmentsMeta.length > 0 ? JSON.stringify(attachmentsMeta) : null,
        source_url: jumpUrl,
      };

      // 1. Layer 1 Persistence
      storeDiscordMessage(discordMsg);

      // 2. Layer 2 Event Extraction (real-time processing)
      if (discordMsg.content.trim().length > 0) {
        await extractEventsFromMessages([discordMsg], true);
      }

      // 3. Keep guild and channel index up to date
      if (message.guild) {
        upsertGuild({
          id: message.guild.id,
          name: message.guild.name,
          icon: message.guild.iconURL(),
          owner_id: message.guild.ownerId,
        });

        upsertChannel({
          id: channelId,
          guild_id: guildId,
          name: channelName,
          type: message.channel.type,
          topic: 'topic' in message.channel ? (message.channel as any).topic : null,
        });
      }
    } catch (err) {
      console.error(`❌ Failed to process Discord message ${message.id}:`, err);
    }
  });
}
