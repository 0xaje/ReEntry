/**
 * Project Re-entry — Domain Types
 * Defines the 3-Layer Evidence Grounding Architecture:
 * Layer 1: Raw Discord Messages
 * Layer 2: Extracted Conversation Events
 * Layer 3: User Relevance & Catch-up Context
 */

/** Layer 1: Real Discord Message Representation */
export interface DiscordMessage {
  id?: number;
  discord_message_id: string;
  guild_id: string;
  channel_id: string;
  channel_name: string;
  author_id: string;
  author_name: string;
  author_avatar?: string | null;
  content: string;
  timestamp: Date;
  reply_to_message_id?: string | null;
  thread_id?: string | null;
  attachments_json?: string | null;
  source_url: string;
  created_at?: Date;
  updated_at?: Date;
}

/** Layer 2: Meaningful Event Types */
export type EventType =
  | 'decision'
  | 'task'
  | 'deadline'
  | 'blocker'
  | 'question'
  | 'mention'
  | 'important_update';

/** Layer 2: Confidence Levels */
export type ConfidenceLevel = 'CONFIRMED' | 'INFERRED' | 'UNKNOWN';

/** Layer 2: Grounded Conversation Event */
export interface ConversationEvent {
  event_id: string;
  guild_id: string;
  channel_id: string;
  type: EventType;
  title: string;
  description: string;
  owner?: string | null;
  deadline?: string | null;
  confidence: ConfidenceLevel;
  source_message_id: string;
  source_url: string;
  created_at: Date;
}

/** Layer 3: Relevance Types */
export type RelevanceType =
  | 'direct_mention'
  | 'assigned_to_user'
  | 'user_reply'
  | 'user_ownership'
  | 'role_relevance'
  | 'contextual_relevance';

/** Layer 3: User Relevance Evidence */
export interface UserRelevance {
  id: string;
  user_id: string;
  event_id: string;
  relevance_type: RelevanceType;
  relevance_score: number;
  reason: string;
  confidence: ConfidenceLevel;
  created_at: Date;
}

/** User Channel Activity for Away Window Calculation */
export interface UserChannelActivity {
  user_id: string;
  channel_id: string;
  last_active_at: Date;
}

/** Fully Grounded Event Item for Catch-up Briefing */
export interface GroundedEventItem {
  event_id: string;
  type: EventType;
  title: string;
  summary: string;
  owner?: string | null;
  deadline?: string | null;
  relevance: {
    type: RelevanceType;
    reason: string;
    score: number;
  };
  confidence: ConfidenceLevel;
  source_message_id: string;
  source_url: string;
  author_name?: string;
  timestamp?: Date;
}

/** Structured Catch-up Context Output */
export interface CatchupContext {
  guild_id: string;
  channel_id: string;
  channel_name: string;
  missed_messages_count: number;
  period_start: Date;
  period_end: Date;
  important_events: GroundedEventItem[];
}

/** Real Source Message Verification */
export interface SourceEvidence {
  found: boolean;
  message_id: string;
  author_name?: string;
  author_id?: string;
  channel_id?: string;
  channel_name?: string;
  timestamp?: Date;
  content?: string;
  discord_jump_url?: string;
  error?: string;
}

/** Search Result Item */
export interface SearchResultItem {
  message_id: string;
  channel_name: string;
  author_name: string;
  content: string;
  timestamp: Date;
  discord_jump_url: string;
  matched_event?: {
    type: EventType;
    title: string;
    confidence: ConfidenceLevel;
  };
}

/** AssemblyAI Voice Agent Tool Definitions */
export interface VoiceToolCall {
  call_id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface VoiceToolResult {
  type: 'tool.result';
  call_id: string;
  result: string; // JSON string
}
