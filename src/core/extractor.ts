import OpenAI from 'openai';
import crypto from 'crypto';
import { config } from './config.js';
import { storeConversationEvent } from './db.js';
import type {
  DiscordMessage,
  ConversationEvent,
  EventType,
  ConfidenceLevel,
} from './types.js';

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!config.ai.apiKey) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.ai.apiKey,
      baseURL: config.ai.baseUrl || undefined,
    });
  }
  return openaiClient;
}

/**
 * Extract meaningful conversation events (Layer 2) from real Discord messages.
 * Every event is strictly mapped to an authentic message ID and source URL.
 */
export async function extractEventsFromMessages(
  messages: DiscordMessage[],
  persist: boolean = true
): Promise<ConversationEvent[]> {
  if (!messages || messages.length === 0) return [];

  // Build a lookup map of real messages by snowflake
  const messageMap = new Map<string, DiscordMessage>();
  for (const msg of messages) {
    messageMap.set(msg.discord_message_id, msg);
  }

  const events: ConversationEvent[] = [];
  const client = getOpenAIClient();

  if (client) {
    try {
      const llmEvents = await extractEventsWithLLM(client, messages, messageMap);
      events.push(...llmEvents);
    } catch (err) {
      console.warn('⚠️ LLM event extraction failed, falling back to deterministic extractor:', err);
      const fallbackEvents = extractEventsDeterministic(messages);
      events.push(...fallbackEvents);
    }
  } else {
    // Deterministic rule-based extraction from real messages
    const fallbackEvents = extractEventsDeterministic(messages);
    events.push(...fallbackEvents);
  }

  // Deduplicate and validate evidence
  const validatedEvents: ConversationEvent[] = [];
  const seenKeys = new Set<string>();

  for (const event of events) {
    const key = `${event.source_message_id}:${event.type}:${event.title.toLowerCase().trim()}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    // Verify evidence exists
    const sourceMsg = messageMap.get(event.source_message_id);
    if (!sourceMsg) {
      // Never allow an event without real backing message evidence
      continue;
    }

    event.source_url = sourceMsg.source_url;
    event.guild_id = sourceMsg.guild_id;
    event.channel_id = sourceMsg.channel_id;

    if (persist) {
      storeConversationEvent(event);
    }
    validatedEvents.push(event);
  }

  return validatedEvents;
}

/**
 * Extract events using an LLM structured prompt.
 * Strictly forces the LLM to ground each event in a real message ID from the transcript.
 */
async function extractEventsWithLLM(
  client: OpenAI,
  messages: DiscordMessage[],
  messageMap: Map<string, DiscordMessage>
): Promise<ConversationEvent[]> {
  const transcriptLines = messages.map(m => {
    return `[MSG_ID: ${m.discord_message_id}] [${m.timestamp.toISOString()}] ${m.author_name}: ${m.content}`;
  });

  const systemPrompt = `You are an expert conversation intelligence parser for Project Re-entry.
Your job is to analyze real Discord conversation transcripts and extract meaningful, high-value conversation events.

Supported event types:
- decision: An agreement, consensus, or direction agreed upon by participants.
- task: An action item or task assigned to someone or self-assigned.
- deadline: A specific date/time mentioned for a deliverable.
- blocker: An impediment, bug, or issue preventing progress.
- question: An unanswered, important inquiry directed at someone or the group.
- mention: A direct callout or reference to a specific person requiring their attention.
- important_update: A significant announcement or progress change (e.g. launch date moved, deploy succeeded/failed).

RULES:
1. Every event MUST be directly traceable to an exact MSG_ID from the transcript.
2. If an event is not backed by a specific message, DO NOT include it.
3. Label confidence as:
   - "CONFIRMED" if explicitly and unambiguously stated in the message.
   - "INFERRED" if logically deduced from conversation context across messages.
4. Return ONLY valid JSON adhering to the schema:
   [
     {
       "type": "decision" | "task" | "deadline" | "blocker" | "question" | "mention" | "important_update",
       "title": "Short 3-7 word summary",
       "description": "Clear 1-2 sentence explanation of what happened",
       "owner": "Name of person responsible/involved or null",
       "deadline": "Deadline string or null",
       "confidence": "CONFIRMED" | "INFERRED",
       "source_message_id": "Exact MSG_ID string from transcript"
     }
   ]`;

  const response = await client.chat.completions.create({
    model: config.ai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Extract meaningful events from this transcript:\n\n${transcriptLines.join('\n')}` },
    ],
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content?.trim() || '[]';
  // Strip markdown code fences if returned
  const cleanJson = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleanJson);
    if (!Array.isArray(parsed)) {
      parsed = (parsed as any).events || [];
    }
  } catch (e) {
    console.warn('⚠️ Failed to parse LLM event extraction JSON:', e);
    return [];
  }

  const results: ConversationEvent[] = [];

  for (const item of parsed) {
    if (!item.source_message_id || !messageMap.has(item.source_message_id)) {
      // Reject any item whose source message id is not in the real messages
      continue;
    }

    const sourceMsg = messageMap.get(item.source_message_id)!;
    const type: EventType = [
      'decision',
      'task',
      'deadline',
      'blocker',
      'question',
      'mention',
      'important_update',
    ].includes(item.type)
      ? item.type
      : 'important_update';

    const confidence: ConfidenceLevel =
      item.confidence === 'CONFIRMED' || item.confidence === 'INFERRED'
        ? item.confidence
        : 'INFERRED';

    results.push({
      event_id: crypto.randomUUID(),
      guild_id: sourceMsg.guild_id,
      channel_id: sourceMsg.channel_id,
      type,
      title: String(item.title || 'Conversation Update').slice(0, 100),
      description: String(item.description || sourceMsg.content),
      owner: item.owner ? String(item.owner) : null,
      deadline: item.deadline ? String(item.deadline) : null,
      confidence,
      source_message_id: sourceMsg.discord_message_id,
      source_url: sourceMsg.source_url,
      created_at: sourceMsg.timestamp,
    });
  }

  return results;
}

/**
 * Deterministic rule-based event extraction for offline or non-LLM operation.
 * Grounds every event directly in real message content and keywords.
 */
export function extractEventsDeterministic(messages: DiscordMessage[]): ConversationEvent[] {
  const events: ConversationEvent[] = [];

  for (const msg of messages) {
    const text = msg.content || '';
    const lower = text.toLowerCase();

    // 1. Decisions
    if (
      lower.includes('decided') ||
      lower.includes('agreed on') ||
      lower.includes("let's go with") ||
      lower.includes('we will use') ||
      lower.includes('decision:')
    ) {
      events.push({
        event_id: crypto.randomUUID(),
        guild_id: msg.guild_id,
        channel_id: msg.channel_id,
        type: 'decision',
        title: `Decision by ${msg.author_name}`,
        description: text.slice(0, 300),
        owner: msg.author_name,
        confidence: 'CONFIRMED',
        source_message_id: msg.discord_message_id,
        source_url: msg.source_url,
        created_at: msg.timestamp,
      });
    }

    // 2. Blockers
    if (
      lower.includes('blocker') ||
      lower.includes('blocking') ||
      lower.includes('stuck on') ||
      lower.includes('cannot proceed') ||
      lower.includes('critical bug')
    ) {
      events.push({
        event_id: crypto.randomUUID(),
        guild_id: msg.guild_id,
        channel_id: msg.channel_id,
        type: 'blocker',
        title: `Blocker raised by ${msg.author_name}`,
        description: text.slice(0, 300),
        owner: msg.author_name,
        confidence: 'CONFIRMED',
        source_message_id: msg.discord_message_id,
        source_url: msg.source_url,
        created_at: msg.timestamp,
      });
    }

    // 3. Deadlines
    const deadlineMatch = text.match(/\b(by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|eod|noon|\d{1,2}(?::\d{2})?\s*(?:am|pm)?))\b/i);
    if (deadlineMatch || lower.includes('deadline') || lower.includes('due date')) {
      events.push({
        event_id: crypto.randomUUID(),
        guild_id: msg.guild_id,
        channel_id: msg.channel_id,
        type: 'deadline',
        title: `Deadline mentioned by ${msg.author_name}`,
        description: text.slice(0, 300),
        deadline: deadlineMatch ? deadlineMatch[1] : null,
        owner: msg.author_name,
        confidence: deadlineMatch ? 'CONFIRMED' : 'INFERRED',
        source_message_id: msg.discord_message_id,
        source_url: msg.source_url,
        created_at: msg.timestamp,
      });
    }

    // 4. Tasks
    if (
      lower.includes('todo') ||
      lower.includes('action item') ||
      lower.includes('i will') ||
      lower.includes('please handle') ||
      lower.includes('assigned') ||
      lower.includes('can you take')
    ) {
      events.push({
        event_id: crypto.randomUUID(),
        guild_id: msg.guild_id,
        channel_id: msg.channel_id,
        type: 'task',
        title: `Task item: ${text.slice(0, 50)}...`,
        description: text.slice(0, 300),
        owner: msg.author_name,
        confidence: 'CONFIRMED',
        source_message_id: msg.discord_message_id,
        source_url: msg.source_url,
        created_at: msg.timestamp,
      });
    }

    // 5. Direct Discord Mentions (<@123456789>)
    const mentionMatches = text.match(/<@!?(\d+)>/g);
    if (mentionMatches && mentionMatches.length > 0) {
      events.push({
        event_id: crypto.randomUUID(),
        guild_id: msg.guild_id,
        channel_id: msg.channel_id,
        type: 'mention',
        title: `Direct callout from ${msg.author_name}`,
        description: text.slice(0, 300),
        owner: msg.author_name,
        confidence: 'CONFIRMED',
        source_message_id: msg.discord_message_id,
        source_url: msg.source_url,
        created_at: msg.timestamp,
      });
    }

    // 6. Important Updates
    if (
      text.includes('IMPORTANT') ||
      lower.includes('announcement') ||
      lower.includes('heads up') ||
      lower.includes('update:')
    ) {
      events.push({
        event_id: crypto.randomUUID(),
        guild_id: msg.guild_id,
        channel_id: msg.channel_id,
        type: 'important_update',
        title: `Important update from ${msg.author_name}`,
        description: text.slice(0, 300),
        owner: msg.author_name,
        confidence: 'CONFIRMED',
        source_message_id: msg.discord_message_id,
        source_url: msg.source_url,
        created_at: msg.timestamp,
      });
    }

    // 7. Questions
    if (text.includes('?') && text.trim().length > 10) {
      events.push({
        event_id: crypto.randomUUID(),
        guild_id: msg.guild_id,
        channel_id: msg.channel_id,
        type: 'question',
        title: `Question asked by ${msg.author_name}`,
        description: text.slice(0, 300),
        owner: msg.author_name,
        confidence: 'CONFIRMED',
        source_message_id: msg.discord_message_id,
        source_url: msg.source_url,
        created_at: msg.timestamp,
      });
    }
  }

  return events;
}
