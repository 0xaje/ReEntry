import type { Client } from 'discord.js';
import { upsertGuild, upsertChannel } from '../../core/index.js';

export function handleReady(client: Client): void {
  client.once('ready', async (readyClient) => {
    console.log('━'.repeat(60));
    console.log('⚡ PROJECT RE-ENTRY — Discord Adapter');
    console.log(`✅ Logged in as ${readyClient.user.tag}`);
    console.log(`📡 Connected to ${readyClient.guilds.cache.size} server(s)`);
    console.log(`🔗 Invite URL: https://discord.com/api/oauth2/authorize?client_id=${readyClient.user.id}&permissions=274877991936&scope=bot%20applications.commands`);
    console.log('━'.repeat(60));

    // Index all accessible guilds and text channels
    try {
      for (const [, guild] of readyClient.guilds.cache) {
        upsertGuild({
          id: guild.id,
          name: guild.name,
          icon: guild.iconURL(),
          owner_id: guild.ownerId,
        });

        const channels = await guild.channels.fetch().catch(() => null);
        if (channels) {
          for (const [, ch] of channels) {
            if (ch && ch.isTextBased()) {
              upsertChannel({
                id: ch.id,
                guild_id: guild.id,
                name: ch.name,
                type: ch.type,
                topic: 'topic' in ch ? (ch as any).topic : null,
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ Non-fatal error indexing guilds/channels on ready:', e);
    }
  });
}
