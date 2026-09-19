import { ChatInputCommandInteraction } from 'discord.js';
import { buildDailyDigest, sendDailyDigestDM } from '../digest/dailyDigest.js';

export async function handleDigestCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const action = interaction.options.getSubcommand(false) || 'send';
  const timeframeHours = interaction.options.getInteger('hours') || 24;

  if (action === 'preview') {
    await interaction.deferReply({ ephemeral: true });

    try {
      const digest = await buildDailyDigest(
        {
          id: interaction.user.id,
          username: interaction.user.username,
          displayName: interaction.user.displayName,
        },
        timeframeHours
      );

      await interaction.editReply({
        content: `🔍 **Previewing Daily Digest** (Timeframe: last ${timeframeHours} hours)`,
        embeds: digest.embeds,
      });
    } catch (err: any) {
      console.error('[DigestCommand] Error generating digest preview:', err);
      await interaction.editReply(`❌ Failed to generate digest: ${err.message || 'Unknown error'}`);
    }
    return;
  }

  // action === 'send'
  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await sendDailyDigestDM(
      interaction.client,
      interaction.user.id,
      timeframeHours
    );

    if (result.delivered) {
      await interaction.editReply(
        `📬 **Morning Digest Sent!** Check your Discord Direct Messages for your personalized summary of decisions, blockers, and mentions.`
      );
    } else {
      await interaction.editReply(
        `⚠️ Could not send Direct Message: ${result.error || 'Please ensure your privacy settings allow DMs from server members.'}\n\nYou can also use \`/reentry-digest preview\` to view it right here.`
      );
    }
  } catch (err: any) {
    console.error('[DigestCommand] Error sending daily digest DM:', err);
    await interaction.editReply(`❌ Failed to send digest: ${err.message || 'Unknown error'}`);
  }
}
