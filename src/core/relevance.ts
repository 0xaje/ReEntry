import crypto from 'crypto';
import {
  getRecentChannelMessages,
  getChannelMessageCountSince,
  getEventsForChannel,
  getUserChannelActivity,
  storeUserRelevance,
  getDiscordMessageBySnowflake,
} from './db.js';
import { extractEventsFromMessages } from './extractor.js';
import type {
  ConversationEvent,
  UserRelevance,
  CatchupContext,
  GroundedEventItem,
  RelevanceType,
  ConfidenceLevel,
  DiscordMessage,
} from './types.js';

export interface UserIdentity {
  internalUserId: string;
  discordId?: string;
  username?: string;
  displayName?: string;
}

/**
 * Score and map conversation events to a specific user's relevance.
 * Grounded in actual mentions, assigned tasks, and reply chains.
 */
export function scoreUserRelevance(
  user: UserIdentity,
  events: ConversationEvent[],
  messages: DiscordMessage[],
  persist: boolean = true
): UserRelevance[] {
  const relevanceList: UserRelevance[] = [];
  const messageMap = new Map<string, DiscordMessage>();
  for (const m of messages) {
    messageMap.set(m.discord_message_id, m);
  }

  const userDiscordId = user.discordId || '';
  const userNames = [
    user.username?.toLowerCase(),
    user.displayName?.toLowerCase(),
  ].filter(Boolean) as string[];

  for (const event of events) {
    const sourceMsg = messageMap.get(event.source_message_id) || getDiscordMessageBySnowflake(event.source_message_id);
    const content = sourceMsg?.content || '';
    const contentLower = content.toLowerCase();

    let relType: RelevanceType = 'contextual_relevance';
    let score = 0.5;
    let reason = 'General channel conversation update';
    let confidence: ConfidenceLevel = event.confidence;

    // 1. Direct Discord Mention (<@123456789>)
    if (userDiscordId && (content.includes(`<@${userDiscordId}>`) || content.includes(`<@!${userDiscordId}>`))) {
      relType = 'direct_mention';
      score = 1.0;
      reason = 'You were directly mentioned in this message';
      confidence = 'CONFIRMED';
    }
    // 2. Assigned Task
    else if (
      event.type === 'task' &&
      event.owner &&
      userNames.some(name => event.owner!.toLowerCase().includes(name))
    ) {
      relType = 'assigned_to_user';
      score = 0.95;
      reason = `Task explicitly associated with you (${event.owner})`;
      confidence = 'CONFIRMED';
    }
    // 3. Reply to User's message
    else if (sourceMsg?.reply_to_message_id && userDiscordId) {
      const repliedMsg = getDiscordMessageBySnowflake(sourceMsg.reply_to_message_id);
      if (repliedMsg && repliedMsg.author_id === userDiscordId) {
        relType = 'user_reply';
        score = 0.9;
        reason = `Direct reply to your earlier message: "${repliedMsg.content.slice(0, 50)}..."`;
        confidence = 'CONFIRMED';
      }
    }
    // 4. Mention by name/handle in text
    else if (userNames.length > 0 && userNames.some(name => contentLower.includes(name))) {
      relType = 'direct_mention';
      score = 0.85;
      reason = 'Your name or handle was cited in this message';
      confidence = 'CONFIRMED';
    }
    // 5. Blockers & Decisions
    else if (event.type === 'blocker') {
      relType = 'contextual_relevance';
      score = 0.8;
      reason = 'Critical blocker raised that affects team progress';
    } else if (event.type === 'decision') {
      relType = 'contextual_relevance';
      score = 0.75;
      reason = 'Team decision finalized in the channel';
    } else if (event.type === 'deadline') {
      relType = 'contextual_relevance';
      score = 0.7;
      reason = `Project deadline established (${event.deadline || 'upcoming'})`;
    } else if (event.type === 'question') {
      relType = 'contextual_relevance';
      score = 0.65;
      reason = 'Open question requiring channel input';
    }

    const relevance: UserRelevance = {
      id: crypto.randomUUID(),
      user_id: user.internalUserId,
      event_id: event.event_id,
      relevance_type: relType,
      relevance_score: score,
      reason,
      confidence,
      created_at: new Date(),
    };

    if (persist) {
      storeUserRelevance(relevance);
    }
    relevanceList.push(relevance);
  }

  return relevanceList;
}

/**
 * Build the complete, personalized Catch-up Context for a user in a channel.
 * Gathers real messages, real events, and computes real away window.
 */
export async function buildCatchupContext(
  channelId: string,
  user: UserIdentity,
  customSince?: Date,
  channelName: string = 'channel'
): Promise<CatchupContext> {
  // 1. Determine real away window
  let periodStart: Date;
  if (customSince) {
    periodStart = customSince;
  } else {
    const lastActive = getUserChannelActivity(user.internalUserId, channelId);
    if (lastActive) {
      periodStart = lastActive;
    } else {
      // Default away window: past 24 hours
      periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    }
  }

  const periodEnd = new Date();

  // 2. Fetch real messages in window
  const missedMessages = getRecentChannelMessages(channelId, 500, periodStart);
  const missedCount = missedMessages.length > 0
    ? missedMessages.length
    : getChannelMessageCountSince(channelId, periodStart);

  // 3. Extract or fetch Layer 2 events
  let events = getEventsForChannel(channelId, periodStart, 50);
  if (events.length === 0 && missedMessages.length > 0) {
    events = await extractEventsFromMessages(missedMessages, true);
  }

  // 4. Score Layer 3 User Relevance
  const relevanceItems = scoreUserRelevance(user, events, missedMessages, true);
  const relevanceMap = new Map<string, UserRelevance>();
  for (const rel of relevanceItems) {
    relevanceMap.set(rel.event_id, rel);
  }

  // 5. Assemble Grounded Event Items
  const groundedEvents: GroundedEventItem[] = [];

  for (const event of events) {
    const rel = relevanceMap.get(event.event_id) || {
      id: '',
      user_id: user.internalUserId,
      event_id: event.event_id,
      relevance_type: 'contextual_relevance' as RelevanceType,
      relevance_score: 0.5,
      reason: 'Channel activity update',
      confidence: event.confidence,
      created_at: new Date(),
    };

    const sourceMsg = getDiscordMessageBySnowflake(event.source_message_id);

    groundedEvents.push({
      event_id: event.event_id,
      type: event.type,
      title: event.title,
      summary: event.description,
      owner: event.owner,
      deadline: event.deadline,
      relevance: {
        type: rel.relevance_type,
        reason: rel.reason,
        score: rel.relevance_score,
      },
      confidence: event.confidence,
      source_message_id: event.source_message_id,
      source_url: event.source_url,
      author_name: sourceMsg?.author_name,
      timestamp: sourceMsg?.timestamp || event.created_at,
    });
  }

  // Sort: highest relevance score first, then newest
  groundedEvents.sort((a, b) => {
    if (b.relevance.score !== a.relevance.score) {
      return b.relevance.score - a.relevance.score;
    }
    return (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0);
  });

  const guildId = missedMessages[0]?.guild_id || '';

  return {
    guild_id: guildId,
    channel_id: channelId,
    channel_name: missedMessages[0]?.channel_name || channelName,
    missed_messages_count: missedCount,
    period_start: periodStart,
    period_end: periodEnd,
    important_events: groundedEvents,
  };
}
