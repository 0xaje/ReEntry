import { config, validateAssemblyAIConfig } from './config.js';
import {
  getDiscordMessageBySnowflake,
  searchStoredMessages,
} from './db.js';
import { buildCatchupContext } from './relevance.js';
import type {
  SourceEvidence,
  SearchResultItem,
  CatchupContext,
} from './types.js';

export interface TokenResponse {
  token: string;
}

/**
 * Mint a temporary single-use token from the AssemblyAI Voice Agent API.
 * The permanent API key is kept secure server-side and never sent to the browser.
 */
export async function mintVoiceAgentToken(expiresInSeconds: number = 3600): Promise<TokenResponse> {
  validateAssemblyAIConfig();

  const response = await fetch(config.assemblyai.tokenUrl, {
    method: 'POST',
    headers: {
      'Authorization': config.assemblyai.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expires_in_seconds: expiresInSeconds,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`AssemblyAI token generation failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (!data?.token) {
    throw new Error('AssemblyAI token response did not contain a valid token');
  }

  return { token: data.token };
}

/**
 * Build the Voice Agent system prompt adhering to Project Re-entry principles.
 */
export function getVoiceAgentSystemPrompt(channelName: string, userName?: string): string {
  return `You are a conversation re-entry agent for Discord channel #${channelName}.
The user speaking with you is ${userName || 'the returning team member'}.
Your job is to help the user understand what happened in this Discord conversation while they were away and help them re-enter the conversation with confidence.

Do not simply summarize everything.
Prioritize:
1. What changed.
2. What matters to this user.
3. What requires the user's attention.
4. What action may be needed.

BEHAVIORAL PRINCIPLES:
- Every important factual statement must be grounded in retrieved Discord conversation evidence.
- Never invent facts.
- Never invent decisions, deadlines, tasks, people, assignments, or outcomes.
- Distinguish confirmed information from inference. If something is inferred, clearly label it as such.
- If evidence is insufficient or missing, say that you cannot verify it.
- When the user asks "why", "who", "where", or "show me the message", use the get_source or search_conversation tools.
- Keep spoken responses concise and natural (usually 2-4 sentences).
- The user may interrupt you naturally at any time. If interrupted, immediately address their question.
- When the user requests an action (like creating a task), call the create_task tool.
- Only confirm an action after the tool reports successful execution.
- If an action cannot be executed or fails, clearly tell the user that it was not completed.`;
}

/**
 * Official AssemblyAI Voice Agent Tool Definitions (JSON Schema).
 */
export function getVoiceAgentToolsDefinition() {
  return [
    {
      type: 'function',
      name: 'get_catchup_context',
      description: 'Retrieve the personalized catch-up context of what happened in the Discord channel while the user was away, including key changes, blockers, decisions, and unread counts.',
      parameters: {
        type: 'object',
        properties: {
          channel_id: {
            type: 'string',
            description: 'The Discord channel ID to get the catch-up context for.',
          },
        },
        required: ['channel_id'],
      },
    },
    {
      type: 'function',
      name: 'search_conversation',
      description: 'Search actual stored Discord messages and conversation events to find relevant messages, quotes, or discussions on a specific topic.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The keyword or topic to search for in the conversation history.',
          },
          channel_id: {
            type: 'string',
            description: 'The Discord channel ID to search within.',
          },
        },
        required: ['query', 'channel_id'],
      },
    },
    {
      type: 'function',
      name: 'get_source',
      description: 'Retrieve the original Discord message evidence for a specific message ID, including author, timestamp, full text, and Discord jump URL.',
      parameters: {
        type: 'object',
        properties: {
          message_id: {
            type: 'string',
            description: 'The Discord message snowflake ID.',
          },
        },
        required: ['message_id'],
      },
    },
    {
      type: 'function',
      name: 'create_task',
      description: 'Create a task or action item based on the conversation.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Title of the task to create.',
          },
          description: {
            type: 'string',
            description: 'Optional detailed description of the task.',
          },
          due_date: {
            type: 'string',
            description: 'Optional due date or deadline.',
          },
        },
        required: ['title'],
      },
    },
  ];
}

/**
 * Execute tools requested by the Voice Agent.
 * Strictly adheres to honesty rules: never reports fake task creation.
 */
export async function executeVoiceAgentTool(
  toolName: string,
  args: Record<string, any>,
  userContext: {
    userId: string;
    discordId?: string;
    channelId: string;
    channelName?: string;
  }
): Promise<Record<string, any>> {
  switch (toolName) {
    case 'get_catchup_context': {
      const channelId = args.channel_id || userContext.channelId;
      const context = await buildCatchupContext(
        channelId,
        {
          internalUserId: userContext.userId,
          discordId: userContext.discordId,
        },
        undefined,
        userContext.channelName || 'channel'
      );

      return {
        success: true,
        channel_id: context.channel_id,
        channel_name: context.channel_name,
        missed_messages_count: context.missed_messages_count,
        period_start: context.period_start.toISOString(),
        period_end: context.period_end.toISOString(),
        important_events: context.important_events.map(e => ({
          type: e.type,
          title: e.title,
          summary: e.summary,
          relevance: e.relevance.reason,
          confidence: e.confidence,
          source_message_id: e.source_message_id,
          source_url: e.source_url,
          author: e.author_name,
        })),
      };
    }

    case 'search_conversation': {
      const query = String(args.query || '').trim();
      const channelId = args.channel_id || userContext.channelId;

      if (!query) {
        return { success: false, error: 'Search query cannot be empty' };
      }

      const rawResults = searchStoredMessages(channelId, query, 10);
      const results: SearchResultItem[] = rawResults.map(m => ({
        message_id: m.discord_message_id,
        channel_name: m.channel_name,
        author_name: m.author_name,
        content: m.content,
        timestamp: m.timestamp,
        discord_jump_url: m.source_url,
      }));

      return {
        success: true,
        query,
        count: results.length,
        results: results.map(r => ({
          message_id: r.message_id,
          author: r.author_name,
          content: r.content,
          timestamp: r.timestamp.toISOString(),
          source_url: r.discord_jump_url,
        })),
      };
    }

    case 'get_source': {
      const messageId = String(args.message_id || '').trim();
      if (!messageId) {
        return {
          found: false,
          error: 'No message ID provided to retrieve source.',
        };
      }

      const msg = getDiscordMessageBySnowflake(messageId);
      if (!msg) {
        return {
          found: false,
          message_id: messageId,
          error: "I couldn't retrieve the original message. It may have been deleted from Discord or not yet indexed.",
        };
      }

      const evidence: SourceEvidence = {
        found: true,
        message_id: msg.discord_message_id,
        author_name: msg.author_name,
        author_id: msg.author_id,
        channel_id: msg.channel_id,
        channel_name: msg.channel_name,
        timestamp: msg.timestamp,
        content: msg.content,
        discord_jump_url: msg.source_url,
      };

      return {
        found: true,
        message_id: evidence.message_id,
        author: evidence.author_name,
        channel: evidence.channel_name,
        timestamp: evidence.timestamp?.toISOString(),
        content: evidence.content,
        source_url: evidence.discord_jump_url,
      };
    }

    case 'create_task': {
      // In accordance with specification rule 15:
      // "DO NOT IMPLEMENT create_task USING A FAKE INTERNAL TASK SYSTEM.
      // Until a real task provider/backend is selected:
      // - define the tool contract
      // - implement the architecture boundary
      // - do NOT report successful task creation"
      return {
        success: false,
        error: `Task creation is not available: an external task provider (such as Linear or GitHub Issues) has not been connected to this workspace. The task "${args.title || 'Untitled'}" was not created.`,
      };
    }

    default:
      return {
        success: false,
        error: `Unknown tool "${toolName}".`,
      };
  }
}
