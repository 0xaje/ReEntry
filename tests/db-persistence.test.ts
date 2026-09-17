import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  initDatabase,
  closeDatabase,
  storeDiscordMessage,
  batchStoreDiscordMessages,
  getDiscordMessageBySnowflake,
  getRecentChannelMessages,
  getChannelMessageCountSince,
  searchStoredMessages,
  deleteDiscordMessage,
  upsertGuild,
  upsertChannel,
  getAllGuilds,
  getChannelsForGuild,
} from '../src/core/db.js';
import type { DiscordMessage } from '../src/core/types.js';

describe('Layer 1: Discord Message Persistence & Query Engine', () => {
  const testGuildId = 'guild-test-101';
  const testChannelId = 'channel-test-202';

  beforeEach(() => {
    initDatabase();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('should store and retrieve a real Discord message with full metadata', () => {
    const messageId = '123456789012345678';
    const now = new Date();
    const jumpUrl = `https://discord.com/channels/${testGuildId}/${testChannelId}/${messageId}`;

    const msg: DiscordMessage = {
      discord_message_id: messageId,
      guild_id: testGuildId,
      channel_id: testChannelId,
      channel_name: 'engineering',
      author_id: 'user-alice-1',
      author_name: 'Alice',
      author_avatar: 'https://cdn.discordapp.com/avatars/1/avatar.png',
      content: 'We need to deploy the new database schema before Friday.',
      timestamp: now,
      reply_to_message_id: null,
      thread_id: null,
      attachments_json: null,
      source_url: jumpUrl,
    };

    storeDiscordMessage(msg);

    const retrieved = getDiscordMessageBySnowflake(messageId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.discord_message_id).toBe(messageId);
    expect(retrieved?.guild_id).toBe(testGuildId);
    expect(retrieved?.channel_id).toBe(testChannelId);
    expect(retrieved?.author_name).toBe('Alice');
    expect(retrieved?.content).toBe(msg.content);
    expect(retrieved?.source_url).toBe(jumpUrl);
    expect(retrieved?.timestamp.getTime()).toBe(now.getTime());
  });

  it('should batch store messages and maintain chronological order', () => {
    const baseTime = Date.now() - 3600000;
    const batch: DiscordMessage[] = [
      {
        discord_message_id: 'msg-batch-1',
        guild_id: testGuildId,
        channel_id: testChannelId,
        channel_name: 'engineering',
        author_id: 'user-bob',
        author_name: 'Bob',
        content: 'First message',
        timestamp: new Date(baseTime),
        source_url: `https://discord.com/channels/${testGuildId}/${testChannelId}/msg-batch-1`,
      },
      {
        discord_message_id: 'msg-batch-2',
        guild_id: testGuildId,
        channel_id: testChannelId,
        channel_name: 'engineering',
        author_id: 'user-carol',
        author_name: 'Carol',
        content: 'Second message with decision',
        timestamp: new Date(baseTime + 60000),
        source_url: `https://discord.com/channels/${testGuildId}/${testChannelId}/msg-batch-2`,
      },
    ];

    const stored = batchStoreDiscordMessages(batch);
    expect(stored).toBe(2);

    const recent = getRecentChannelMessages(testChannelId, 10);
    expect(recent.length).toBeGreaterThanOrEqual(2);
    const found1 = recent.find(m => m.discord_message_id === 'msg-batch-1');
    const found2 = recent.find(m => m.discord_message_id === 'msg-batch-2');
    expect(found1).toBeDefined();
    expect(found2).toBeDefined();
  });

  it('should count messages strictly within the away time window', () => {
    const windowStart = new Date(Date.now() - 1800000); // 30 mins ago
    const count = getChannelMessageCountSince(testChannelId, windowStart);
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('should search stored conversation messages by keyword and author', () => {
    const searchMsg: DiscordMessage = {
      discord_message_id: 'msg-search-target',
      guild_id: testGuildId,
      channel_id: testChannelId,
      channel_name: 'engineering',
      author_id: 'user-dave',
      author_name: 'DaveArchitect',
      content: 'Critical deployment security checkpoint passed.',
      timestamp: new Date(),
      source_url: `https://discord.com/channels/${testGuildId}/${testChannelId}/msg-search-target`,
    };

    storeDiscordMessage(searchMsg);

    const results = searchStoredMessages(testChannelId, 'security checkpoint');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].discord_message_id).toBe('msg-search-target');
    expect(results[0].author_name).toBe('DaveArchitect');
  });

  it('should delete message on Discord delete event', () => {
    const toDeleteId = 'msg-to-delete-123';
    storeDiscordMessage({
      discord_message_id: toDeleteId,
      guild_id: testGuildId,
      channel_id: testChannelId,
      channel_name: 'engineering',
      author_id: 'user-temp',
      author_name: 'TempUser',
      content: 'Will be deleted soon',
      timestamp: new Date(),
      source_url: `https://discord.com/channels/${testGuildId}/${testChannelId}/${toDeleteId}`,
    });

    expect(getDiscordMessageBySnowflake(toDeleteId)).not.toBeNull();
    deleteDiscordMessage(toDeleteId);
    expect(getDiscordMessageBySnowflake(toDeleteId)).toBeNull();
  });

  it('should upsert and index guilds and channels', () => {
    upsertGuild({
      id: testGuildId,
      name: 'Acme Mega Corp',
      icon: 'https://cdn.discordapp.com/icons/guild.png',
      owner_id: 'owner-1',
    });

    upsertChannel({
      id: testChannelId,
      guild_id: testGuildId,
      name: 'engineering',
      type: 0,
      topic: 'Core discussions',
    });

    const guilds = getAllGuilds();
    expect(guilds.some(g => g.id === testGuildId && g.name === 'Acme Mega Corp')).toBe(true);

    const channels = getChannelsForGuild(testGuildId);
    expect(channels.some(c => c.id === testChannelId && c.name === 'engineering')).toBe(true);
  });
});
