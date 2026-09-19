import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config, validateDiscordConfig } from '../core/config.js';

const commands = [
  new SlashCommandBuilder()
    .setName('catchup')
    .setDescription('Get a personalized, evidence-grounded briefing of what happened while away')
    .addStringOption(option =>
      option.setName('timeframe')
        .setDescription('Time window to catch up on (e.g. "30m", "2h", "1d")')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('scope')
        .setDescription('Catch-up scope: this channel or the entire server')
        .addChoices(
          { name: 'This Channel', value: 'channel' },
          { name: 'Entire Server (All Channels)', value: 'server' }
        )
        .setRequired(false))
    .addStringOption(option =>
      option.setName('delivery')
        .setDescription('Where to deliver the briefing')
        .addChoices(
          { name: 'Public (in channel)', value: 'public' },
          { name: 'Private (ephemeral)', value: 'private' }
        )
        .setRequired(false)),
  new SlashCommandBuilder()
    .setName('reentry-voice')
    .setDescription('Interact directly with Project Re-entry voice agent in a voice channel')
    .addSubcommand(sub =>
      sub.setName('join')
        .setDescription('Join your current voice channel or a specified voice channel')
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('Voice channel to join (defaults to your current voice channel)')
            .setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('leave')
        .setDescription('Leave the voice channel'))
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('Check current voice agent session status')),
  new SlashCommandBuilder()
    .setName('reentry-digest')
    .setDescription('Get your personalized morning digest of unread decisions, blockers, and mentions')
    .addSubcommand(sub =>
      sub.setName('send')
        .setDescription('Deliver your morning digest straight to your Discord Direct Messages')
        .addIntegerOption(opt =>
          opt.setName('hours')
            .setDescription('Time window in hours (default: 24)')
            .setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('preview')
        .setDescription('Preview your morning digest right here in channel (ephemeral)')
        .addIntegerOption(opt =>
          opt.setName('hours')
            .setDescription('Time window in hours (default: 24)')
            .setRequired(false))),
].map(command => command.toJSON());

async function deployCommands() {
  validateDiscordConfig();
  const rest = new REST({ version: '10' }).setToken(config.discord.token);

  try {
    console.log('🚀 Registering Discord slash commands for Project Re-entry...');

    const data = await rest.put(
      Routes.applicationCommands(config.discord.clientId),
      { body: commands },
    ) as unknown[];

    console.log(`✅ Successfully registered ${data.length} global command(s).`);
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
    process.exit(1);
  }
}

deployCommands();
