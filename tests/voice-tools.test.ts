import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  initDatabase,
  closeDatabase,
  storeDiscordMessage,
} from '../src/core/db.js';
import {
  getVoiceAgentToolsDefinition,
  executeVoiceAgentTool,
  getVoiceAgentSystemPrompt,
} from '../src/core/assemblyai.js';
import type { DiscordMessage } from '../src/core/types.js';

describe('AssemblyAI Voice Agent Tools & System Prompt', () => {
  const channelId = 'channel-tools-test';

  beforeEach(() => {
    initDatabase();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('should define valid tool schemas for AssemblyAI session.update', () => {
    const tools = getVoiceAgentToolsDefinition();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(4);

    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('get_catchup_context');
    expect(toolNames).toContain('search_conversation');
    expect(toolNames).toContain('get_source');
    expect(toolNames).toContain('create_task');

    for (const tool of tools) {
      expect(tool.type).toBe('function');
      expect(tool.description).toBeDefined();
      expect(tool.parameters.type).toBe('object');
      expect(Array.isArray(tool.parameters.required)).toBe(true);
    }
  });

  it('should generate an evidence-first system prompt adhering to Re-entry rules', () => {
    const prompt = getVoiceAgentSystemPrompt('launch', 'Alice');
    expect(prompt).toContain('conversation re-entry agent');
    expect(prompt).toContain('Alice');
    expect(prompt).toContain('#launch');
    expect(prompt).toContain('Never invent facts');
    expect(prompt).toContain('grounded in retrieved Discord conversation evidence');
  });

  it('should execute get_source tool and return real Discord evidence', async () => {
    const msgId = 'msg-source-target-999';
    const jumpUrl = `https://discord.com/channels/guild-1/${channelId}/${msgId}`;

    const msg: DiscordMessage = {
      discord_message_id: msgId,
      guild_id: 'guild-1',
      channel_id: channelId,
      channel_name: 'launch',
      author_id: 'author-alex',
      author_name: 'Alex',
      content: 'The production SSL certificate was renewed today.',
      timestamp: new Date(),
      source_url: jumpUrl,
    };
    storeDiscordMessage(msg);

    const result = await executeVoiceAgentTool(
      'get_source',
      { message_id: msgId },
      { userId: 'user-1', channelId }
    );

    expect(result.found).toBe(true);
    expect(result.message_id).toBe(msgId);
    expect(result.author).toBe('Alex');
    expect(result.content).toBe(msg.content);
    expect(result.source_url).toBe(jumpUrl);
  });

  it('should report honest failure when get_source cannot find a message', async () => {
    const result = await executeVoiceAgentTool(
      'get_source',
      { message_id: 'non-existent-msg-id' },
      { userId: 'user-1', channelId }
    );

    expect(result.found).toBe(false);
    expect(result.error).toContain("couldn't retrieve");
  });

  it('should execute search_conversation tool over real messages', async () => {
    const msgId = 'msg-search-123';
    storeDiscordMessage({
      discord_message_id: msgId,
      guild_id: 'guild-1',
      channel_id: channelId,
      channel_name: 'launch',
      author_id: 'author-bob',
      author_name: 'Bob',
      content: 'Frontend build passes all integration tests.',
      timestamp: new Date(),
      source_url: `https://discord.com/channels/guild-1/${channelId}/${msgId}`,
    });

    const result = await executeVoiceAgentTool(
      'search_conversation',
      { query: 'frontend build', channel_id: channelId },
      { userId: 'user-1', channelId }
    );

    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.results[0].message_id).toBe(msgId);
  });

  it('should report honest failure for create_task when no external provider is configured (Rule 15)', async () => {
    const result = await executeVoiceAgentTool(
      'create_task',
      { title: 'Update documentation' },
      { userId: 'user-1', channelId }
    );

    // Rule 15: "DO NOT IMPLEMENT create_task USING A FAKE INTERNAL TASK SYSTEM.
    // Until a real task provider/backend is selected: do NOT report successful task creation."
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available: an external task provider');
  });

  it('should return honest error for unknown tool calls', async () => {
    const result = await executeVoiceAgentTool(
      'unknown_custom_tool',
      {},
      { userId: 'user-1', channelId }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });
});
