import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function optional(key: string, fallback: string = ''): string {
  return process.env[key] || fallback;
}

export const config = {
  // Discord Credentials
  discord: {
    token: optional('DISCORD_TOKEN'),
    clientId: optional('DISCORD_CLIENT_ID'),
    clientSecret: optional('DISCORD_CLIENT_SECRET'),
  },

  // AssemblyAI Voice Agent
  assemblyai: {
    apiKey: optional('ASSEMBLYAI_API_KEY'),
    agentWsUrl: optional('ASSEMBLYAI_AGENT_WS_URL', 'wss://agents.assemblyai.com/v1/ws'),
    tokenUrl: optional('ASSEMBLYAI_TOKEN_URL', 'https://agents.assemblyai.com/v1/token'),
  },

  // LLM for Event Extraction & Grounding
  ai: {
    apiKey: optional('AI_API_KEY', optional('OPENAI_API_KEY', optional('MIMO_API_KEY', optional('GEMINI_API_KEY')))),
    baseUrl: optional('AI_BASE_URL', optional('OPENAI_BASE_URL', optional('MIMO_BASE_URL'))),
    model: optional('AI_MODEL', optional('OPENAI_MODEL', optional('MIMO_MODEL', 'gpt-4o-mini'))),
  },

  // Ingestion & Catch-up Settings
  summaryMaxMessages: parseInt(optional('SUMMARY_MAX_MESSAGES', '100'), 10),
  logLevel: optional('LOG_LEVEL', 'info'),

  // Storage Paths
  dataDir: path.resolve(__dirname, '../../data'),
  dbPath: path.resolve(__dirname, '../../data/reentry.db'),
} as const;

/** Validate Discord configuration */
export function validateDiscordConfig(): void {
  if (!config.discord.token) {
    throw new Error('❌ DISCORD_TOKEN is required to connect to Discord');
  }
  if (!config.discord.clientId) {
    throw new Error('❌ DISCORD_CLIENT_ID is required to identify the Discord application');
  }
}

/** Validate AssemblyAI configuration */
export function validateAssemblyAIConfig(): void {
  if (!config.assemblyai.apiKey) {
    throw new Error('❌ ASSEMBLYAI_API_KEY is required for the AssemblyAI Voice Agent');
  }
}
