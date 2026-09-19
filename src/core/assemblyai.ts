import { config, validateAssemblyAIConfig } from './config.js';
import {
  getDiscordMessageBySnowflake,
  searchStoredMessages,
  searchStoredMessagesInGuild,
  getChannelsForGuild,
} from './db.js';
import { buildCatchupContext, buildServerCatchupContext } from './relevance.js';
import { executeCreateTask } from './tasks/index.js';
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
 * Gives the agent full awareness of the entire Discord server and all channels.
 */
export function getVoiceAgentSystemPrompt(
  channelOrServerName: string,
  userName?: string,
  serverName?: string
): string {
  const scopeDescription = serverName
    ? `the Discord server "${serverName}" (currently stationed in #${channelOrServerName})`
    : `Discord server and channel #${channelOrServerName}`;

  return `You are a conversation re-entry agent for ${scopeDescription}.
The user speaking with you is ${userName || 'the returning team member'}.
You have full awareness of the entire Discord server and all its channels.
Your job is to help the user understand what happened while they were away and help them re-enter conversations with confidence.

You can answer questions about:
- What happened across the ENTIRE server/group today (all channels).
- What happened in specific channels (e.g. #general, #announcements, #backend, etc.).
- Search for topics, decisions, blockers, or people across the entire server.
- List which channels exist and where the latest discussions are happening.

Do not simply summarize everything.
Prioritize:
1. What changed.
2. What matters to this user.
3. What requires the user's attention (blockers, decisions, deadlines, mentions).
4. What action may be needed.

BEHAVIORAL PRINCIPLES:
- Every important factual statement must be grounded in retrieved Discord conversation evidence.
- Never invent facts. Never invent decisions, deadlines, tasks, people, assignments, or outcomes.
- Distinguish confirmed information from inference. If something is inferred, clearly label it as such.
- If evidence is insufficient or missing, say that you cannot verify it.
- When the user asks about the whole server/group, what happened today, or general updates, use get_catchup_context with channel_id="all" (or omit channel_id).
- When the user asks "why", "who", "where", or "show me the message", use the get_source or search_conversation tools.
- Keep spoken responses concise and natural (usually 2-4 sentences).
- The user may interrupt you naturally at any time. If interrupted, immediately address their question.
- When the user requests an action (like creating a task), call the create_task tool.
- Only confirm an action after the tool reports successful execution.`;
}

/**
 * Official AssemblyAI Voice Agent Tool Definitions (JSON Schema).
 */
export function getVoiceAgentToolsDefinition() {
  return [
    {
      type: 'function',
      name: 'get_catchup_context',
      description: 'Retrieve the personalized catch-up context of what happened while the user was away. Supports single channel or entire server (all channels).',
      parameters: {
        type: 'object',
        properties: {
          channel_id: {
            type: 'string',
            description: 'The Discord channel ID, or "all" to get a server-wide catch-up across all channels in the server.',
          },
        },
      },
    },
    {
      type: 'function',
      name: 'search_conversation',
      description: 'Search actual stored Discord messages and conversation events across the entire server or within a specific channel.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The keyword, topic, or person to search for in conversation history.',
          },
          channel_id: {
            type: 'string',
            description: 'Optional Discord channel ID. If omitted or "all", searches across ALL channels in the server.',
          },
        },
        required: ['query'],
      },
    },
    {
      type: 'function',
      name: 'get_server_overview',
      description: 'Get an overview of all channels in this Discord server, including active channels, topics, and message counts.',
      parameters: {
        type: 'object',
        properties: {},
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
    guildId?: string;
    guildName?: string;
  }
): Promise<Record<string, any>> {
  switch (toolName) {
    case 'get_catchup_context': {
      const channelId = args.channel_id;

      // If requested "all" or omitted while in a server, perform server-wide briefing across all channels
      if (channelId === 'all' || (!channelId && userContext.guildId)) {
        const guildId = userContext.guildId || '';
        const context = await buildServerCatchupContext(
          guildId,
          {
            internalUserId: userContext.userId,
            discordId: userContext.discordId,
          },
          undefined,
          userContext.guildName || 'Server'
        );

        return {
          success: true,
          scope: 'server',
          server_name: userContext.guildName || 'Server',
          channels_active: context.channels_count,
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

      const targetChannelId = channelId || userContext.channelId;
      const context = await buildCatchupContext(
        targetChannelId,
        {
          internalUserId: userContext.userId,
          discordId: userContext.discordId,
        },
        undefined,
        userContext.channelName || 'channel'
      );

      return {
        success: true,
        scope: 'channel',
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
      const channelId = args.channel_id;

      if (!query) {
        return { success: false, error: 'Search query cannot be empty' };
      }

      // If channel_id is not specified or 'all', search across entire guild!
      const isServerWide = (!channelId || channelId === 'all') && Boolean(userContext.guildId);
      const rawResults = isServerWide
        ? searchStoredMessagesInGuild(userContext.guildId!, query, 10)
        : searchStoredMessages(channelId || userContext.channelId, query, 10);

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
        scope: isServerWide ? 'server' : 'channel',
        query,
        count: results.length,
        results: results.map(r => ({
          message_id: r.message_id,
          channel: r.channel_name,
          author: r.author_name,
          content: r.content,
          timestamp: r.timestamp.toISOString(),
          source_url: r.discord_jump_url,
        })),
      };
    }

    case 'get_server_overview': {
      const guildId = userContext.guildId;
      if (!guildId) {
        return { success: false, error: 'Server information is not available in this session.' };
      }

      const channels = getChannelsForGuild(guildId);
      return {
        success: true,
        server_name: userContext.guildName || 'Server',
        total_channels: channels.length,
        channels: channels.map(c => ({
          id: c.id,
          name: c.name,
          topic: c.topic || 'General conversation',
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
      const result = await executeCreateTask(
        {
          title: args.title || 'Untitled Task',
          description: args.description,
          dueDate: args.due_date,
          sourceMessageId: args.source_message_id,
          sourceUrl: args.source_url,
          channelName: userContext.channelName,
        },
        userContext.userId
      );

      if (result.success && result.task) {
        return {
          success: true,
          task_id: result.task.id,
          provider: result.task.provider,
          external_id: result.task.externalId,
          task_url: result.task.externalUrl,
          title: result.task.title,
          message: `Successfully created ${result.task.provider === 'github' ? 'GitHub Issue' : 'Linear Issue'} #${result.task.externalId}: "${result.task.title}". Link: ${result.task.externalUrl}`,
        };
      } else {
        return {
          success: false,
          error: result.error || 'Failed to create task in external provider.',
        };
      }
    }

    default:
      return {
        success: false,
        error: `Unknown tool "${toolName}".`,
      };
  }
}
