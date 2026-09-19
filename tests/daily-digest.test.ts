import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initDatabase,
  storeConversationEvent,
  storeDiscordMessage,
  setUserChannelActivity,
} from '../src/core/index.js';
import { buildDailyDigest, sendDailyDigestDM } from '../src/discord/digest/dailyDigest.js';
import { handleDigestCommand } from '../src/discord/commands/digest.js';

describe('Daily Digest Webhook & Morning DM', () => {
  beforeEach(() => {
    initDatabase();
  });

  it('builds a personalized morning digest with blockers and decisions', async () => {
    const testChannelId = 'ch_digest_test_1';
    const testGuildId = 'guild_digest_1';
    const testUser = {
      id: 'user_alice_99',
      username: 'alice',
      displayName: 'Alice Dev',
    };

    setUserChannelActivity(testUser.id, testChannelId, new Date());

    // 1. Store a real Discord message
    storeDiscordMessage({
      discord_message_id: 'msg_blocker_1',
      guild_id: testGuildId,
      channel_id: testChannelId,
      channel_name: 'backend',
      author_id: 'user_bob',
      author_name: 'Bob',
      content: 'We are blocked on the Stripe billing webhook credentials.',
      timestamp: new Date(),
      source_url: 'https://discord.com/channels/1/2/3',
    });

    // 2. Store Layer 2 events
    storeConversationEvent({
      event_id: 'ev_blocker_1',
      guild_id: testGuildId,
      channel_id: testChannelId,
      type: 'blocker',
      title: 'Stripe Billing Webhook Blocked',
      description: 'Waiting on production Stripe API keys before deploying.',
      confidence: 'CONFIRMED',
      source_message_id: 'msg_blocker_1',
      source_url: 'https://discord.com/channels/1/2/3',
      created_at: new Date(),
    });

    storeConversationEvent({
      event_id: 'ev_decision_1',
      guild_id: testGuildId,
      channel_id: testChannelId,
      type: 'decision',
      title: 'Migrate to Node 22 LTS',
      description: 'Team agreed to use Node 22 LTS for production Docker image.',
      confidence: 'CONFIRMED',
      source_message_id: 'msg_blocker_1',
      source_url: 'https://discord.com/channels/1/2/3',
      created_at: new Date(),
    });

    const digest = await buildDailyDigest(testUser, 24);

    expect(digest.userId).toBe(testUser.id);
    expect(digest.blockers.length).toBeGreaterThanOrEqual(1);
    expect(digest.decisions.length).toBeGreaterThanOrEqual(1);
    expect(digest.embeds.length).toBe(1);

    const embedData = digest.embeds[0].data;
    expect(embedData.title).toContain('Morning Re-entry Digest');

    const fieldNames = embedData.fields?.map(f => f.name) || [];
    expect(fieldNames).toContain('🛑 Blockers & Impediments');
    expect(fieldNames).toContain('⚖️ Key Decisions Made');
  });

  it('handles empty timeframe with clear skies message', async () => {
    const testUser = {
      id: 'user_charlie_clear',
      username: 'charlie',
    };

    // Query for 0 hours so no events match
    const digest = await buildDailyDigest(testUser, 0.0001);

    expect(digest.embeds.length).toBe(1);
    const embedData = digest.embeds[0].data;
    const clearSkiesField = embedData.fields?.find(f => f.name.includes('Clear Skies'));
    expect(clearSkiesField).toBeDefined();
  });

  it('handles sendDailyDigestDM with simulated Discord client', async () => {
    let sentPayload: any = null;
    const mockUser = {
      id: 'user_dm_test',
      username: 'testuser',
      send: async (payload: any) => {
        sentPayload = payload;
        return payload;
      },
    };

    const mockClient = {
      users: {
        fetch: async (id: string) => (id === 'user_dm_test' ? mockUser : null),
      },
    } as any;

    const result = await sendDailyDigestDM(mockClient, 'user_dm_test', 24);
    expect(result.success).toBe(true);
    expect(result.delivered).toBe(true);
    expect(sentPayload).toBeDefined();
    expect(sentPayload.embeds).toBeDefined();
  });

  it('handles blocked DMs gracefully without crashing', async () => {
    const mockBlockedUser = {
      id: 'user_blocked_dm',
      username: 'blocked_user',
      send: async () => {
        throw new Error('Cannot send messages to this user');
      },
    };

    const mockClient = {
      users: {
        fetch: async () => mockBlockedUser,
      },
    } as any;

    const result = await sendDailyDigestDM(mockClient, 'user_blocked_dm', 24);
    expect(result.success).toBe(false);
    expect(result.delivered).toBe(false);
    expect(result.error).toContain('Cannot send messages to this user');
  });

  it('executes handleDigestCommand preview and send actions', async () => {
    let previewReply: any = null;
    const fakePreviewInteraction = {
      user: { id: 'user_test_preview', username: 'preview_user' },
      options: {
        getSubcommand: () => 'preview',
        getInteger: () => 24,
      },
      deferReply: async () => {},
      editReply: async (msg: any) => {
        previewReply = msg;
      },
    } as any;

    await handleDigestCommand(fakePreviewInteraction);
    expect(previewReply).toBeDefined();
    expect(previewReply.content).toContain('Previewing Daily Digest');
    expect(previewReply.embeds).toBeDefined();
  });
});
