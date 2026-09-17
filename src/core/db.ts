import Database from 'better-sqlite3';
import fs from 'fs';
import { config } from './config.js';
import type {
  DiscordMessage,
  ConversationEvent,
  UserRelevance,
  EventType,
  ConfidenceLevel,
  RelevanceType,
} from './types.js';

// Ensure data directory exists
fs.mkdirSync(config.dataDir, { recursive: true });

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = new Database(config.dbPath);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('busy_timeout = 5000');
  }
  return dbInstance;
}

/** Initialize the Project Re-entry database schema */
export function initDatabase(): void {
  const db = getDb();

  db.exec(`
    -- Authenticated Application Users
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      discord_id TEXT UNIQUE,
      username TEXT,
      display_name TEXT,
      avatar TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Connected Discord Guilds
    CREATE TABLE IF NOT EXISTS discord_guilds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT,
      owner_id TEXT,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Connected Discord Channels
    CREATE TABLE IF NOT EXISTS discord_channels (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type INTEGER NOT NULL DEFAULT 0,
      topic TEXT,
      last_synced_at DATETIME,
      FOREIGN KEY (guild_id) REFERENCES discord_guilds(id)
    );

    -- Layer 1: Real Discord Messages
    CREATE TABLE IF NOT EXISTS discord_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_message_id TEXT UNIQUE NOT NULL,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      channel_name TEXT,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_avatar TEXT,
      content TEXT,
      timestamp DATETIME NOT NULL,
      reply_to_message_id TEXT,
      thread_id TEXT,
      attachments_json TEXT,
      source_url TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_discord_messages_channel_time 
      ON discord_messages(channel_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_discord_messages_snowflake 
      ON discord_messages(discord_message_id);
    CREATE INDEX IF NOT EXISTS idx_discord_messages_guild 
      ON discord_messages(guild_id);
    CREATE INDEX IF NOT EXISTS idx_discord_messages_author 
      ON discord_messages(author_id);

    -- Layer 2: Extracted Conversation Events
    CREATE TABLE IF NOT EXISTS conversation_events (
      event_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      owner TEXT,
      deadline TEXT,
      confidence TEXT NOT NULL,
      source_message_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_events_channel_time 
      ON conversation_events(channel_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_source_msg 
      ON conversation_events(source_message_id);

    -- Layer 3: User Relevance Mapping
    CREATE TABLE IF NOT EXISTS user_relevance (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      relevance_type TEXT NOT NULL,
      relevance_score REAL NOT NULL,
      reason TEXT NOT NULL,
      confidence TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, event_id)
    );

    CREATE INDEX IF NOT EXISTS idx_relevance_user_event 
      ON user_relevance(user_id, event_id);

    -- User Activity Tracking (for Catch-up Away Window)
    CREATE TABLE IF NOT EXISTS user_channel_activity (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      last_active_at DATETIME NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    );

    -- Real Tasks Storage (Schema ready for future external task provider integration)
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      source_message_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/** Close the database connection */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// ----------------------------------------------------
// LAYER 1: DISCORD MESSAGE PERSISTENCE
// ----------------------------------------------------

export function storeDiscordMessage(msg: DiscordMessage): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO discord_messages (
      discord_message_id, guild_id, channel_id, channel_name,
      author_id, author_name, author_avatar, content, timestamp,
      reply_to_message_id, thread_id, attachments_json, source_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_message_id) DO UPDATE SET
      content = excluded.content,
      attachments_json = excluded.attachments_json,
      updated_at = CURRENT_TIMESTAMP
  `);

  stmt.run(
    msg.discord_message_id,
    msg.guild_id,
    msg.channel_id,
    msg.channel_name,
    msg.author_id,
    msg.author_name,
    msg.author_avatar || null,
    msg.content,
    msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp,
    msg.reply_to_message_id || null,
    msg.thread_id || null,
    msg.attachments_json || null,
    msg.source_url
  );
}

export function batchStoreDiscordMessages(messages: DiscordMessage[]): number {
  if (messages.length === 0) return 0;
  const db = getDb();
  let count = 0;

  const insertMany = db.transaction((msgs: DiscordMessage[]) => {
    const stmt = db.prepare(`
      INSERT INTO discord_messages (
        discord_message_id, guild_id, channel_id, channel_name,
        author_id, author_name, author_avatar, content, timestamp,
        reply_to_message_id, thread_id, attachments_json, source_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(discord_message_id) DO UPDATE SET
        content = excluded.content,
        attachments_json = excluded.attachments_json,
        updated_at = CURRENT_TIMESTAMP
    `);

    for (const msg of msgs) {
      stmt.run(
        msg.discord_message_id,
        msg.guild_id,
        msg.channel_id,
        msg.channel_name,
        msg.author_id,
        msg.author_name,
        msg.author_avatar || null,
        msg.content,
        msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp,
        msg.reply_to_message_id || null,
        msg.thread_id || null,
        msg.attachments_json || null,
        msg.source_url
      );
      count++;
    }
  });

  insertMany(messages);
  return count;
}

export function deleteDiscordMessage(discordMessageId: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM discord_messages WHERE discord_message_id = ?`).run(discordMessageId);
}

export function getDiscordMessageBySnowflake(discordMessageId: string): DiscordMessage | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM discord_messages WHERE discord_message_id = ? LIMIT 1
  `).get(discordMessageId) as any;

  if (!row) return null;

  return {
    id: row.id,
    discord_message_id: row.discord_message_id,
    guild_id: row.guild_id,
    channel_id: row.channel_id,
    channel_name: row.channel_name,
    author_id: row.author_id,
    author_name: row.author_name,
    author_avatar: row.author_avatar,
    content: row.content,
    timestamp: new Date(row.timestamp),
    reply_to_message_id: row.reply_to_message_id,
    thread_id: row.thread_id,
    attachments_json: row.attachments_json,
    source_url: row.source_url,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

export function getRecentChannelMessages(
  channelId: string,
  limit: number = 100,
  since?: Date
): DiscordMessage[] {
  const db = getDb();
  let rows: any[];

  if (since) {
    rows = db.prepare(`
      SELECT * FROM discord_messages
      WHERE channel_id = ? AND timestamp >= ?
      ORDER BY timestamp ASC
      LIMIT ?
    `).all(channelId, since.toISOString(), limit);
  } else {
    rows = db.prepare(`
      SELECT * FROM discord_messages
      WHERE channel_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(channelId, limit);
    rows.reverse(); // Return in chronological order
  }

  return rows.map(row => ({
    id: row.id,
    discord_message_id: row.discord_message_id,
    guild_id: row.guild_id,
    channel_id: row.channel_id,
    channel_name: row.channel_name,
    author_id: row.author_id,
    author_name: row.author_name,
    author_avatar: row.author_avatar,
    content: row.content,
    timestamp: new Date(row.timestamp),
    reply_to_message_id: row.reply_to_message_id,
    thread_id: row.thread_id,
    attachments_json: row.attachments_json,
    source_url: row.source_url,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  }));
}

export function getChannelMessageCountSince(channelId: string, since: Date): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM discord_messages
    WHERE channel_id = ? AND timestamp >= ?
  `).get(channelId, since.toISOString()) as any;
  return row?.count || 0;
}

export function searchStoredMessages(
  channelId: string,
  query: string,
  limit: number = 20
): DiscordMessage[] {
  const db = getDb();
  const pattern = `%${query}%`;
  const rows = db.prepare(`
    SELECT * FROM discord_messages
    WHERE channel_id = ? AND (content LIKE ? OR author_name LIKE ?)
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(channelId, pattern, pattern, limit) as any[];

  return rows.map(row => ({
    id: row.id,
    discord_message_id: row.discord_message_id,
    guild_id: row.guild_id,
    channel_id: row.channel_id,
    channel_name: row.channel_name,
    author_id: row.author_id,
    author_name: row.author_name,
    author_avatar: row.author_avatar,
    content: row.content,
    timestamp: new Date(row.timestamp),
    reply_to_message_id: row.reply_to_message_id,
    thread_id: row.thread_id,
    attachments_json: row.attachments_json,
    source_url: row.source_url,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  }));
}

// ----------------------------------------------------
// LAYER 2: CONVERSATION EVENTS
// ----------------------------------------------------

export function storeConversationEvent(event: ConversationEvent): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO conversation_events (
      event_id, guild_id, channel_id, type, title, description,
      owner, deadline, confidence, source_message_id, source_url, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      confidence = excluded.confidence
  `).run(
    event.event_id,
    event.guild_id,
    event.channel_id,
    event.type,
    event.title,
    event.description,
    event.owner || null,
    event.deadline || null,
    event.confidence,
    event.source_message_id,
    event.source_url,
    event.created_at instanceof Date ? event.created_at.toISOString() : event.created_at
  );
}

export function getEventsForChannel(
  channelId: string,
  since?: Date,
  limit: number = 50
): ConversationEvent[] {
  const db = getDb();
  let rows: any[];

  if (since) {
    rows = db.prepare(`
      SELECT * FROM conversation_events
      WHERE channel_id = ? AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(channelId, since.toISOString(), limit);
  } else {
    rows = db.prepare(`
      SELECT * FROM conversation_events
      WHERE channel_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(channelId, limit);
  }

  return rows.map(row => ({
    event_id: row.event_id,
    guild_id: row.guild_id,
    channel_id: row.channel_id,
    type: row.type as EventType,
    title: row.title,
    description: row.description,
    owner: row.owner,
    deadline: row.deadline,
    confidence: row.confidence as ConfidenceLevel,
    source_message_id: row.source_message_id,
    source_url: row.source_url,
    created_at: new Date(row.created_at),
  }));
}

export function getEventById(eventId: string): ConversationEvent | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM conversation_events WHERE event_id = ? LIMIT 1
  `).get(eventId) as any;

  if (!row) return null;

  return {
    event_id: row.event_id,
    guild_id: row.guild_id,
    channel_id: row.channel_id,
    type: row.type as EventType,
    title: row.title,
    description: row.description,
    owner: row.owner,
    deadline: row.deadline,
    confidence: row.confidence as ConfidenceLevel,
    source_message_id: row.source_message_id,
    source_url: row.source_url,
    created_at: new Date(row.created_at),
  };
}

// ----------------------------------------------------
// LAYER 3: USER RELEVANCE MAPPING
// ----------------------------------------------------

export function storeUserRelevance(rel: UserRelevance): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO user_relevance (
      id, user_id, event_id, relevance_type, relevance_score, reason, confidence, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, event_id) DO UPDATE SET
      relevance_type = excluded.relevance_type,
      relevance_score = excluded.relevance_score,
      reason = excluded.reason,
      confidence = excluded.confidence
  `).run(
    rel.id,
    rel.user_id,
    rel.event_id,
    rel.relevance_type,
    rel.relevance_score,
    rel.reason,
    rel.confidence,
    rel.created_at instanceof Date ? rel.created_at.toISOString() : rel.created_at
  );
}

export function getUserRelevanceForEvents(
  userId: string,
  eventIds: string[]
): UserRelevance[] {
  if (eventIds.length === 0) return [];
  const db = getDb();
  const placeholders = eventIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT * FROM user_relevance
    WHERE user_id = ? AND event_id IN (${placeholders})
  `).all(userId, ...eventIds) as any[];

  return rows.map(row => ({
    id: row.id,
    user_id: row.user_id,
    event_id: row.event_id,
    relevance_type: row.relevance_type as RelevanceType,
    relevance_score: row.relevance_score,
    reason: row.reason,
    confidence: row.confidence as ConfidenceLevel,
    created_at: new Date(row.created_at),
  }));
}

// ----------------------------------------------------
// USER ACTIVITY & AWAY WINDOW
// ----------------------------------------------------

export function setUserChannelActivity(
  userId: string,
  channelId: string,
  timestamp: Date = new Date()
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO user_channel_activity (user_id, channel_id, last_active_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, channel_id) DO UPDATE SET
      last_active_at = excluded.last_active_at
  `).run(userId, channelId, timestamp.toISOString());
}

export function getUserChannelActivity(
  userId: string,
  channelId: string
): Date | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT last_active_at FROM user_channel_activity
    WHERE user_id = ? AND channel_id = ?
    LIMIT 1
  `).get(userId, channelId) as any;

  return row ? new Date(row.last_active_at) : null;
}

// ----------------------------------------------------
// DISCORD GUILDS & CHANNELS
// ----------------------------------------------------

export function upsertGuild(guild: {
  id: string;
  name: string;
  icon?: string | null;
  owner_id?: string | null;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO discord_guilds (id, name, icon, owner_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      icon = excluded.icon,
      owner_id = excluded.owner_id
  `).run(guild.id, guild.name, guild.icon || null, guild.owner_id || null);
}

export function upsertChannel(channel: {
  id: string;
  guild_id: string;
  name: string;
  type?: number;
  topic?: string | null;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO discord_channels (id, guild_id, name, type, topic, last_synced_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      topic = excluded.topic,
      last_synced_at = CURRENT_TIMESTAMP
  `).run(
    channel.id,
    channel.guild_id,
    channel.name,
    channel.type || 0,
    channel.topic || null
  );
}

export function getAllGuilds(): { id: string; name: string; icon: string | null }[] {
  const db = getDb();
  return db.prepare(`SELECT id, name, icon FROM discord_guilds ORDER BY name ASC`).all() as any[];
}

export function getChannelsForGuild(guildId: string): {
  id: string;
  guild_id: string;
  name: string;
  type: number;
  topic: string | null;
}[] {
  const db = getDb();
  return db.prepare(`
    SELECT id, guild_id, name, type, topic FROM discord_channels
    WHERE guild_id = ? ORDER BY name ASC
  `).all(guildId) as any[];
}
