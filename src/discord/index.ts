import {
  Client,
  GatewayIntentBits,
  Partials,
  type TextChannel,
  type NewsChannel,
  type ThreadChannel,
  type Message,
} from 'discord.js';
import {
  config,
  validateDiscordConfig,
  initDatabase,
  deleteDiscordMessage,
  batchStoreDiscordMessages,
  extractEventsFromMessages,
  upsertGuild,
  upsertChannel,
} from '../core/index.js';
import type { DiscordMessage } from '../core/types.js';
import { handleReady } from './events/ready.js';
import { handleMessageCreate } from './events/messageCreate.js';
import { handleInteractionCreate } from './events/interactionCreate.js';

/** The Discord client instance, available after startDiscord() resolves */
export let client: Client | null = null;

/** Start the Discord adapter */
export async function startDiscord(): Promise<Client> {
  validateDiscordConfig();
  initDatabase();

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Channel],
  });

  // Register event handlers
  handleReady(client);
  handleMessageCreate(client);
  handleInteractionCreate(client);

  // Handle deleted messages to ensure local representation matches Discord
  client.on('messageDelete', (message) => {
    deleteDiscordMessage(message.id);
  });
  client.on('messageDeleteBulk', (messages) => {
    messages.forEach(message => deleteDiscordMessage(message.id));
  });

  await client.login(config.discord.token);
  return client;
}

/**
 * Backfill historical messages from a Discord channel into Layer 1 storage.
 * Handles permission errors honestly without fabricating data.
 */
export async function backfillChannelHistory(
  discordClient: Client,
  channelId: string,
  limit: number = 100,
  beforeId?: string,
  afterId?: string
): Promise<{ count: number; messages: DiscordMessage[] }> {
  try {
    const channel = await discordClient.channels.fetch(channelId);

    if (!channel) {
      throw new Error(`Channel ${channelId} was not found on Discord.`);
    }

    if (!channel.isTextBased()) {
      throw new Error(`Channel ${channelId} is not a text-based channel.`);
    }

    const textChannel = channel as TextChannel | NewsChannel | ThreadChannel;

    // Fetch live messages from Discord API
    const fetchOptions: any = { limit: Math.min(limit, 100) };
    if (beforeId) fetchOptions.before = beforeId;
    if (afterId) fetchOptions.after = afterId;

    const fetchedMessages = await textChannel.messages.fetch(fetchOptions);
    const messageList: Message[] = 'values' in fetchedMessages
      ? Array.from((fetchedMessages as any).values())
      : [fetchedMessages as Message];
    const convertedMessages: DiscordMessage[] = [];

    const guildId = textChannel.guild?.id || 'direct-messages';
    const channelName = textChannel.name || 'channel';

    for (const msg of messageList) {
      if (msg.author.bot) continue;

      const jumpUrl = `https://discord.com/channels/${msg.guildId || '@me'}/${channelId}/${msg.id}`;
      const attachmentsMeta = Array.from(msg.attachments.values()).map((att: any) => ({
        id: att.id,
        name: att.name,
        url: att.url,
        contentType: att.contentType,
        size: att.size,
      }));

      convertedMessages.push({
        discord_message_id: msg.id,
        guild_id: guildId,
        channel_id: channelId,
        channel_name: channelName,
        author_id: msg.author.id,
        author_name: msg.author.displayName || msg.author.username,
        author_avatar: msg.author.displayAvatarURL(),
        content: msg.content || (attachmentsMeta.length > 0 ? `[Attached: ${attachmentsMeta.map(a => a.name).join(', ')}]` : ''),
        timestamp: msg.createdAt,
        reply_to_message_id: msg.reference?.messageId || null,
        thread_id: msg.thread?.id || null,
        attachments_json: attachmentsMeta.length > 0 ? JSON.stringify(attachmentsMeta) : null,
        source_url: jumpUrl,
      });
    }

    // Sort chronologically
    convertedMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // 1. Batch store in Layer 1
    const storedCount = batchStoreDiscordMessages(convertedMessages);

    // 2. Extract Layer 2 events from the backfilled messages
    if (convertedMessages.length > 0) {
      await extractEventsFromMessages(convertedMessages, true);
    }

    // 3. Keep channel info updated
    if (textChannel.guild) {
      upsertGuild({
        id: textChannel.guild.id,
        name: textChannel.guild.name,
        icon: textChannel.guild.iconURL(),
        owner_id: textChannel.guild.ownerId,
      });

      upsertChannel({
        id: channelId,
        guild_id: guildId,
        name: channelName,
        type: textChannel.type,
        topic: 'topic' in textChannel ? (textChannel as any).topic : null,
      });
    }

    return { count: storedCount, messages: convertedMessages };
  } catch (err: any) {
    if (err.code === 50001 || err.code === 50013 || err.message?.includes('Missing Access') || err.message?.includes('Missing Permissions')) {
      throw new Error(`Discord permission failure: The application does not have permission to read message history in channel ${channelId}.`);
    }
    throw err;
  }
}

// If run directly
const isDirectRun = process.argv[1]?.includes('discord');
if (isDirectRun) {
  startDiscord().catch((error) => {
    console.error('❌ Failed to start Discord adapter:', error);
    process.exit(1);
  });
}
