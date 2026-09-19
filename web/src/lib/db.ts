import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const globalForDb = globalThis as unknown as { db: Database.Database | undefined };

function createDb(): Database.Database {
  const dataDir = process.cwd().endsWith("web")
    ? path.resolve(process.cwd(), "../data")
    : path.resolve(process.cwd(), "data");

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = process.env.DB_PATH || path.join(dataDir, "reentry.db");
  const db = new Database(dbPath, { timeout: 10000 });

  try {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 10000");
  } catch (e) {
    // Non-fatal if WAL pragma already active
  }

  // Ensure tables exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      discord_id TEXT UNIQUE,
      email TEXT,
      name TEXT,
      image TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      provider TEXT NOT NULL,
      providerAccountId TEXT NOT NULL,
      access_token TEXT,
      UNIQUE(provider, providerAccountId)
    );

    CREATE TABLE IF NOT EXISTS discord_guilds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT,
      owner_id TEXT,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS discord_channels (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type INTEGER NOT NULL DEFAULT 0,
      topic TEXT,
      last_synced_at DATETIME
    );

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

    CREATE TABLE IF NOT EXISTS user_channel_activity (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      last_active_at DATETIME NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'github',
      external_id TEXT,
      external_url TEXT,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      source_message_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try { db.exec(`ALTER TABLE tasks ADD COLUMN provider TEXT NOT NULL DEFAULT 'github';`); } catch {}
  try { db.exec(`ALTER TABLE tasks ADD COLUMN external_id TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE tasks ADD COLUMN external_url TEXT;`); } catch {}

  return db;
}

export const db = globalForDb.db ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.db = db;

export default db;
