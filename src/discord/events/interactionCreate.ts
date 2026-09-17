import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { handleCatchup } from '../commands/catchup.js';

export function handleInteractionCreate(client: Client): void {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      switch (interaction.commandName) {
        case 'catchup':
          await handleCatchup(interaction as ChatInputCommandInteraction);
          break;
        default:
          console.warn(`⚠️ Unknown command: ${interaction.commandName}`);
      }
    } catch (error) {
      console.error(`❌ Command error (${interaction.commandName}):`, error);

      const errorMessage = '❌ An error occurred while processing your request.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorMessage).catch(console.error);
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true }).catch(console.error);
      }
    }
  });
}
