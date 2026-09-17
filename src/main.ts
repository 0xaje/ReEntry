/**
 * Project Re-entry — Primary Service Entrypoint
 * Starts the Discord Ingestion Gateway and initializes the SQLite evidence database.
 */

import dns from 'dns';
import { initDatabase, closeDatabase, config } from './core/index.js';
import { startDiscord } from './discord/index.js';

// Prefer IPv4 for reliable outbound network requests
dns.setDefaultResultOrder('ipv4first');

async function main(): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║             ⚡ PROJECT RE-ENTRY                  ║');
  console.log('║   Evidence-Grounded Discord Conversation Agent   ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  // 1. Initialize persistent SQLite database
  initDatabase();
  console.log(`📦 Evidence database initialized at ${config.dbPath}`);

  // 2. Start Discord Gateway Adapter
  try {
    const client = await startDiscord();
    console.log(`🚀 Project Re-entry is live! Connected as ${client.user?.tag || 'Discord Bot'}`);
  } catch (err: any) {
    console.error('❌ Failed to start Discord Gateway adapter:', err.message || err);
    console.log('ℹ️  Ensure DISCORD_TOKEN and DISCORD_CLIENT_ID are set in your .env file.');
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n👋 Shutting down Project Re-entry...');
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('💥 Fatal error during startup:', error);
  process.exit(1);
});
