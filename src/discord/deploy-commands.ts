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
      option.setName('delivery')
        .setDescription('Where to deliver the briefing')
        .addChoices(
          { name: 'Public (in channel)', value: 'public' },
          { name: 'Private (ephemeral)', value: 'private' }
        )
        .setRequired(false)),
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
