import type { ChatInputCommandInteraction } from 'discord.js';
import { buildCatchupContext } from '../../core/index.js';

function parseTimeframeToDate(timeStr: string): Date | null {
  const match = timeStr.match(/^(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours|d|day|days)$/i);
  if (!match) return null;
  const val = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  let ms = 0;
  if (unit.startsWith('m')) ms = val * 60 * 1000;
  else if (unit.startsWith('h')) ms = val * 60 * 60 * 1000;
  else if (unit.startsWith('d')) ms = val * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

export async function handleCatchup(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: interaction.options.getString('delivery') === 'private' });

  const channelId = interaction.channelId;
  const channelName = 'name' in (interaction.channel || {}) ? (interaction.channel as any).name : 'channel';
  const timeframeStr = interaction.options.getString('timeframe');
  const sinceDate = timeframeStr ? parseTimeframeToDate(timeframeStr) || undefined : undefined;

  try {
    const context = await buildCatchupContext(
      channelId,
      {
        internalUserId: interaction.user.id,
        discordId: interaction.user.id,
        username: interaction.user.username,
        displayName: interaction.user.displayName,
      },
      sinceDate,
      channelName
    );

    if (context.missed_messages_count === 0 && context.important_events.length === 0) {
      await interaction.editReply('✅ You are all caught up! No recent messages were found in this time window.');
      return;
    }

    const timeStart = context.period_start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const timeEnd = context.period_end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let responseText = `⚡ **PROJECT RE-ENTRY — Catch-up Briefing**\n`;
    responseText += `Channel: **#${context.channel_name}**\n`;
    responseText += `📊 **${context.missed_messages_count} real messages** analyzed (${timeStart} → ${timeEnd})\n\n`;

    if (context.important_events.length === 0) {
      responseText += `*No major decisions, blockers, or direct mentions were detected in these messages.*\n`;
    } else {
      responseText += `**${context.important_events.length} things matter to you:**\n\n`;

      for (let i = 0; i < Math.min(context.important_events.length, 5); i++) {
        const ev = context.important_events[i];
        const num = String(i + 1).padStart(2, '0');
        const badge = ev.type.toUpperCase().replace('_', ' ');

        responseText += `**${num} — [${badge}] ${ev.title}**\n`;
        responseText += `> ${ev.summary}\n`;
        responseText += `> *Source:* [View Discord message](${ev.source_url}) • *Confidence:* \`${ev.confidence}\`\n\n`;
      }
    }

    responseText += `🎙️ *To speak with the re-entry agent and ask follow-up questions in real-time, launch the Re-entry web app.*`;

    await interaction.editReply(responseText);
  } catch (err: any) {
    console.error('❌ Error handling Discord catchup command:', err);
    await interaction.editReply(
      `❌ Failed to generate catch-up: ${err.message || 'Unknown error occurred.'}`
    );
  }
}
