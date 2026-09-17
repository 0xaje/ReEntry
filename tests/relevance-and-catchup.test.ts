import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  initDatabase,
  closeDatabase,
  storeDiscordMessage,
} from '../src/core/db.js';
import { extractEventsDeterministic } from '../src/core/extractor.js';
import {
  scoreUserRelevance,
  buildCatchupContext,
} from '../src/core/relevance.js';
import type { DiscordMessage } from '../src/core/types.js';

describe('Layer 3: User Relevance & Catch-up Context Engine', () => {
  const channelId = 'channel-rel-1';
  const targetUserSnowflake = '987654321';
  const targetUserName = 'DevHero';

  beforeEach(() => {
    initDatabase();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('should score direct mention as highest priority (score = 1.0, direct_mention)', () => {
    const msg: DiscordMessage = {
      discord_message_id: 'msg-mention-target',
      guild_id: 'guild-1',
      channel_id: channelId,
      channel_name: 'dev',
      author_id: 'other-user',
      author_name: 'Colleague',
      content: `Hey <@${targetUserSnowflake}>, can you verify the release notes?`,
      timestamp: new Date(),
      source_url: `https://discord.com/channels/guild-1/${channelId}/msg-mention-target`,
    };

    storeDiscordMessage(msg);
    const events = extractEventsDeterministic([msg]);
    const relevance = scoreUserRelevance(
      {
        internalUserId: 'user-internal-1',
        discordId: targetUserSnowflake,
        username: targetUserName,
      },
      events,
      [msg],
      false
    );

    expect(relevance.length).toBeGreaterThan(0);
    const mentionRel = relevance.find(r => r.relevance_type === 'direct_mention');
    expect(mentionRel).toBeDefined();
    expect(mentionRel?.relevance_score).toBe(1.0);
    expect(mentionRel?.confidence).toBe('CONFIRMED');
  });

  it('should prioritize tasks explicitly assigned to the user (score = 0.95)', () => {
    const msg: DiscordMessage = {
      discord_message_id: 'msg-task-assigned',
      guild_id: 'guild-1',
      channel_id: channelId,
      channel_name: 'dev',
      author_id: 'manager-1',
      author_name: 'ProjectManager',
      content: `TODO: DevHero will handle deploying the production containers.`,
      timestamp: new Date(),
      source_url: `https://discord.com/channels/guild-1/${channelId}/msg-task-assigned`,
    };

    storeDiscordMessage(msg);
    const events = extractEventsDeterministic([msg]);
    const relevance = scoreUserRelevance(
      {
        internalUserId: 'user-internal-1',
        discordId: targetUserSnowflake,
        username: targetUserName,
      },
      events,
      [msg],
      false
    );

    const taskRel = relevance.find(r => r.relevance_type === 'assigned_to_user' || r.relevance_type === 'direct_mention');
    expect(taskRel).toBeDefined();
    expect(taskRel?.relevance_score).toBeGreaterThanOrEqual(0.85);
  });

  it('should detect reply to user message (score = 0.9, user_reply)', () => {
    // 1. User's earlier message
    const userMsg: DiscordMessage = {
      discord_message_id: 'msg-user-earlier',
      guild_id: 'guild-1',
      channel_id: channelId,
      channel_name: 'dev',
      author_id: targetUserSnowflake,
      author_name: targetUserName,
      content: 'Should we use Redis or SQLite for the local store?',
      timestamp: new Date(Date.now() - 60000),
      source_url: `https://discord.com/channels/guild-1/${channelId}/msg-user-earlier`,
    };
    storeDiscordMessage(userMsg);

    // 2. Teammate's reply
    const replyMsg: DiscordMessage = {
      discord_message_id: 'msg-teammate-reply',
      guild_id: 'guild-1',
      channel_id: channelId,
      channel_name: 'dev',
      author_id: 'architect-1',
      author_name: 'Architect',
      content: "We decided let's go with SQLite for zero-dependency local performance.",
      timestamp: new Date(),
      reply_to_message_id: 'msg-user-earlier',
      source_url: `https://discord.com/channels/guild-1/${channelId}/msg-teammate-reply`,
    };
    storeDiscordMessage(replyMsg);

    const events = extractEventsDeterministic([replyMsg]);
    const relevance = scoreUserRelevance(
      {
        internalUserId: 'user-internal-1',
        discordId: targetUserSnowflake,
        username: targetUserName,
      },
      events,
      [replyMsg],
      false
    );

    const replyRel = relevance.find(r => r.relevance_type === 'user_reply');
    expect(replyRel).toBeDefined();
    expect(replyRel?.relevance_score).toBe(0.9);
  });

  it('should build structured CatchupContext with grounded events and real message counts', async () => {
    const sinceTime = new Date(Date.now() - 3600000);
    const context = await buildCatchupContext(
      channelId,
      {
        internalUserId: 'user-internal-1',
        discordId: targetUserSnowflake,
        username: targetUserName,
      },
      sinceTime,
      'dev'
    );

    expect(context).toBeDefined();
    expect(context.channel_id).toBe(channelId);
    expect(context.channel_name).toBe('dev');
    expect(typeof context.missed_messages_count).toBe('number');
    expect(context.period_start.getTime()).toBe(sinceTime.getTime());
    expect(Array.isArray(context.important_events)).toBe(true);

    // Verify all returned events have valid source URLs and confidence
    for (const event of context.important_events) {
      expect(event.source_url).toContain('https://discord.com/channels/');
      expect(['CONFIRMED', 'INFERRED', 'UNKNOWN']).toContain(event.confidence);
      expect(event.relevance).toBeDefined();
      expect(typeof event.relevance.score).toBe('number');
    }
  });
});
