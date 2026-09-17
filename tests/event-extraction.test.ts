import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  initDatabase,
  closeDatabase,
  storeDiscordMessage,
} from '../src/core/db.js';
import {
  extractEventsFromMessages,
  extractEventsDeterministic,
} from '../src/core/extractor.js';
import type { DiscordMessage } from '../src/core/types.js';

describe('Layer 2: Conversation Event Extraction Engine', () => {
  beforeEach(() => {
    initDatabase();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('should extract decisions with CONFIRMED confidence and link to source URL', async () => {
    const msg: DiscordMessage = {
      discord_message_id: 'msg-decide-1',
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      channel_name: 'launch',
      author_id: 'lead-1',
      author_name: 'LeadArchitect',
      content: "We decided to move the launch to Friday at 3 PM.",
      timestamp: new Date(),
      source_url: 'https://discord.com/channels/guild-1/channel-1/msg-decide-1',
    };

    storeDiscordMessage(msg);
    const events = await extractEventsFromMessages([msg], false);

    expect(events.length).toBeGreaterThanOrEqual(1);
    const decisionEvent = events.find(e => e.type === 'decision');
    expect(decisionEvent).toBeDefined();
    expect(decisionEvent?.source_message_id).toBe('msg-decide-1');
    expect(decisionEvent?.source_url).toBe(msg.source_url);
    expect(decisionEvent?.confidence).toBe('CONFIRMED');
    expect(decisionEvent?.owner).toBe('LeadArchitect');
  });

  it('should extract blockers and associate them with the reporter', async () => {
    const msg: DiscordMessage = {
      discord_message_id: 'msg-blocker-1',
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      channel_name: 'dev',
      author_id: 'dev-1',
      author_name: 'BackendDev',
      content: "CRITICAL BLOCKER: The database migration script is failing on the staging cluster.",
      timestamp: new Date(),
      source_url: 'https://discord.com/channels/guild-1/channel-1/msg-blocker-1',
    };

    storeDiscordMessage(msg);
    const events = extractEventsDeterministic([msg]);

    expect(events.length).toBeGreaterThanOrEqual(1);
    const blockerEvent = events.find(e => e.type === 'blocker');
    expect(blockerEvent).toBeDefined();
    expect(blockerEvent?.source_message_id).toBe('msg-blocker-1');
    expect(blockerEvent?.owner).toBe('BackendDev');
    expect(blockerEvent?.confidence).toBe('CONFIRMED');
  });

  it('should extract deadlines with target timeframe', async () => {
    const msg: DiscordMessage = {
      discord_message_id: 'msg-deadline-1',
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      channel_name: 'general',
      author_id: 'pm-1',
      author_name: 'ProductManager',
      content: "All QA sign-offs must be submitted by Friday.",
      timestamp: new Date(),
      source_url: 'https://discord.com/channels/guild-1/channel-1/msg-deadline-1',
    };

    storeDiscordMessage(msg);
    const events = extractEventsDeterministic([msg]);

    const deadlineEvent = events.find(e => e.type === 'deadline');
    expect(deadlineEvent).toBeDefined();
    expect(deadlineEvent?.deadline).toBeDefined();
    expect(deadlineEvent?.source_message_id).toBe('msg-deadline-1');
  });

  it('should extract direct Discord mentions (<@123456789>)', async () => {
    const msg: DiscordMessage = {
      discord_message_id: 'msg-mention-1',
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      channel_name: 'general',
      author_id: 'teammate-1',
      author_name: 'Teammate',
      content: "Hey <@9876543210>, can you review the pull request for the API routes?",
      timestamp: new Date(),
      source_url: 'https://discord.com/channels/guild-1/channel-1/msg-mention-1',
    };

    storeDiscordMessage(msg);
    const events = extractEventsDeterministic([msg]);

    const mentionEvent = events.find(e => e.type === 'mention');
    expect(mentionEvent).toBeDefined();
    expect(mentionEvent?.source_message_id).toBe('msg-mention-1');
  });

  it('should never invent events or produce events without a backing message', async () => {
    const emptyMessages: DiscordMessage[] = [];
    const events = await extractEventsFromMessages(emptyMessages, false);
    expect(events).toEqual([]);
  });
});
