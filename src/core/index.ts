export * from './types.js';
export {
  config,
  validateDiscordConfig,
  validateAssemblyAIConfig,
} from './config.js';
export {
  initDatabase,
  closeDatabase,
  getDb,
  storeDiscordMessage,
  batchStoreDiscordMessages,
  deleteDiscordMessage,
  getDiscordMessageBySnowflake,
  getRecentChannelMessages,
  getChannelMessageCountSince,
  searchStoredMessages,
  storeConversationEvent,
  getEventsForChannel,
  getEventById,
  storeUserRelevance,
  getUserRelevanceForEvents,
  setUserChannelActivity,
  getUserChannelActivity,
  upsertGuild,
  upsertChannel,
  getAllGuilds,
  getChannelsForGuild,
} from './db.js';
export {
  extractEventsFromMessages,
  extractEventsDeterministic,
} from './extractor.js';
export {
  scoreUserRelevance,
  buildCatchupContext,
  type UserIdentity,
} from './relevance.js';
export {
  mintVoiceAgentToken,
  getVoiceAgentSystemPrompt,
  getVoiceAgentToolsDefinition,
  executeVoiceAgentTool,
} from './assemblyai.js';
