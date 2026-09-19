import { Client, EmbedBuilder, User } from 'discord.js';
import {
  getDb,
  getDiscordMessageBySnowflake,
  type ConversationEvent,
  type GroundedEventItem,
} from '../../core/index.js';

export interface DailyDigestResult {
  userId: string;
  discordId: string;
  totalEvents: number;
  blockers: GroundedEventItem[];
  decisions: GroundedEventItem[];
  actionItems: GroundedEventItem[];
  embeds: EmbedBuilder[];
  summaryText: string;
}

/**
 * Builds a personalized morning digest containing unread decisions and blockers.
 */
export async function buildDailyDigest(
  discordUser: { id: string; username: string; displayName?: string },
  timeframeHours: number = 24
): Promise<DailyDigestResult> {
  const db = getDb();
  const sinceDate = new Date(Date.now() - timeframeHours * 60 * 60 * 1000);
  const sinceIso = sinceDate.toISOString();

  // Find channels the user has been active in, or all tracked channels if no specific history
  const activeChannelRows = db
    .prepare(
      `SELECT channel_id FROM user_channel_activity WHERE user_id = ?`
    )
    .all(discordUser.id) as { channel_id: string }[];

  let targetChannelIds: string[] = activeChannelRows.map(r => r.channel_id);

  // If no user-specific channels recorded, fetch all channels from tracked guilds
  if (targetChannelIds.length === 0) {
    const allChannels = db.prepare(`SELECT id FROM discord_channels LIMIT 20`).all() as { id: string }[];
    targetChannelIds = allChannels.map(c => c.id);
  }

  // Retrieve Layer 2 events from these channels in the timeframe
  const rawEvents: any[] = [];
  if (targetChannelIds.length > 0) {
    const placeholders = targetChannelIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT * FROM conversation_events
         WHERE channel_id IN (${placeholders}) AND created_at >= ?
         ORDER BY created_at DESC LIMIT 50`
      )
      .all(...targetChannelIds, sinceIso) as any[];

    rawEvents.push(...rows);
  }

  const groundedItems: GroundedEventItem[] = rawEvents.map(r => {
    const sourceMsg = getDiscordMessageBySnowflake(r.source_message_id);
    return {
      event_id: r.event_id,
      type: r.type,
      title: r.title,
      summary: r.description,
      owner: r.owner,
      deadline: r.deadline,
      confidence: r.confidence,
      source_message_id: r.source_message_id,
      source_url: r.source_url,
      author_name: sourceMsg?.author_name,
      timestamp: new Date(r.created_at),
      relevance: {
        type: 'contextual_relevance',
        reason: 'Channel activity update',
        score: r.type === 'blocker' ? 0.9 : r.type === 'decision' ? 0.8 : 0.6,
      },
    };
  });

  const blockers = groundedItems.filter(e => e.type === 'blocker');
  const decisions = groundedItems.filter(e => e.type === 'decision');
  const actionItems = groundedItems.filter(e => e.type === 'task' || e.type === 'mention');

  // Build rich Discord Embed
  const embed = new EmbedBuilder()
    .setColor(blockers.length > 0 ? 0xff4d4f : 0x5865f2)
    .setTitle(`🌅 Morning Re-entry Digest — ${discordUser.displayName || discordUser.username}`)
    .setDescription(
      `Here is what changed while you were away in the last **${timeframeHours} hours**.\n` +
      `📊 **${blockers.length}** blocker(s) • **${decisions.length}** decision(s) • **${actionItems.length}** action item(s)`
    )
    .setTimestamp();

  if (blockers.length > 0) {
    const blockerText = blockers
      .slice(0, 4)
      .map((b, idx) => `**${idx + 1}. ${b.title}**\n> ${b.summary}\n> 🔗 [Jump to Message](${b.source_url}) • Confidence: \`${b.confidence}\``)
      .join('\n\n');
    embed.addFields({ name: '🛑 Blockers & Impediments', value: blockerText });
  }

  if (decisions.length > 0) {
    const decisionText = decisions
      .slice(0, 4)
      .map((d, idx) => `**${idx + 1}. ${d.title}**\n> ${d.summary}\n> 🔗 [Jump to Message](${d.source_url}) • Confidence: \`${d.confidence}\``)
      .join('\n\n');
    embed.addFields({ name: '⚖️ Key Decisions Made', value: decisionText });
  }

  if (actionItems.length > 0) {
    const actionText = actionItems
      .slice(0, 4)
      .map((a, idx) => `**${idx + 1}. ${a.title}**\n> ${a.summary}\n> 🔗 [Jump to Message](${a.source_url})`)
      .join('\n\n');
    embed.addFields({ name: '🎯 Action Items & Mentions', value: actionText });
  }

  if (blockers.length === 0 && decisions.length === 0 && actionItems.length === 0) {
    embed.addFields({
      name: '✅ Clear Skies',
      value: 'No outstanding blockers or major decisions were detected in your channels during this window. You are up to date!',
    });
  }

  embed.setFooter({
    text: 'Project Re-entry • Talk live with /reentry-voice or review channels with /catchup',
  });

  const summaryText = `Project Re-entry Morning Digest: ${blockers.length} blocker(s), ${decisions.length} decision(s), ${actionItems.length} action item(s).`;

  return {
    userId: discordUser.id,
    discordId: discordUser.id,
    totalEvents: groundedItems.length,
    blockers,
    decisions,
    actionItems,
    embeds: [embed],
    summaryText,
  };
}

/**
 * Sends a personalized morning DM to a Discord user.
 * Gracefully handles blocked DMs or permission issues without throwing.
 */
export async function sendDailyDigestDM(
  client: Client,
  discordUserId: string,
  timeframeHours: number = 24
): Promise<{ success: boolean; delivered: boolean; error?: string; totalEvents: number }> {
  try {
    const user: User = await client.users.fetch(discordUserId);
    if (!user) {
      return { success: false, delivered: false, error: 'User not found', totalEvents: 0 };
    }

    const digest = await buildDailyDigest(
      {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
      },
      timeframeHours
    );

    // Send DM
    await user.send({
      content: `☀️ **Good morning!** Here is your personalized daily catch-up:`,
      embeds: digest.embeds,
    });

    return {
      success: true,
      delivered: true,
      totalEvents: digest.totalEvents,
    };
  } catch (err: any) {
    console.warn(`[DailyDigest] Could not deliver DM to user ${discordUserId}:`, err.message);
    return {
      success: false,
      delivered: false,
      error: err.message || 'Failed to send DM (user may have DMs disabled from server members)',
      totalEvents: 0,
    };
  }
}

/**
 * Broadcast daily morning DM digests to all tracked users with activity.
 */
export async function dispatchDailyDigestToAllUsers(
  client: Client,
  timeframeHours: number = 24
): Promise<{ attempted: number; delivered: number; failed: number }> {
  const db = getDb();
  const userRows = db
    .prepare(`SELECT DISTINCT user_id FROM user_channel_activity`)
    .all() as { user_id: string }[];

  let attempted = 0;
  let delivered = 0;
  let failed = 0;

  for (const row of userRows) {
    attempted++;
    const result = await sendDailyDigestDM(client, row.user_id, timeframeHours);
    if (result.delivered) {
      delivered++;
    } else {
      failed++;
    }
  }

  return { attempted, delivered, failed };
}
