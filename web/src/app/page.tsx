import { auth } from "@/auth";
import ReentryDashboard from "@/components/ReentryDashboard";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();

  // 1. Fetch connected Discord guilds & channels
  let guilds: any[] = [];
  let channels: any[] = [];

  try {
    guilds = db.prepare("SELECT id, name, icon FROM discord_guilds ORDER BY name ASC").all();
    channels = db.prepare("SELECT id, guild_id, name, type, topic FROM discord_channels ORDER BY name ASC").all();
  } catch (e) {
    // Database tables might not be initialized yet on very first run
  }

  if (channels.length === 0) {
    return (
      <ReentryDashboard
        session={session}
        initialData={{
          connected: false,
          guilds: [],
          channels: [],
          missed_messages_count: 0,
          total_messages_count: 0,
          period_start: new Date().toISOString(),
          period_end: new Date().toISOString(),
          important_events: [],
          recent_messages: [],
          message: "No Discord channels indexed yet. Start the Discord bot to begin live message capture.",
        }}
      />
    );
  }

  const activeChannel = channels[0];
  const activeGuild = guilds.find((g) => g.id === activeChannel.guild_id);
  const userId = session?.user?.id || "anonymous-user";

  // 2. Fetch user's activity window or default to 24h
  let periodStart: Date;
  try {
    const activityRow = db
      .prepare("SELECT last_active_at FROM user_channel_activity WHERE user_id = ? AND channel_id = ?")
      .get(userId, activeChannel.id) as { last_active_at: string } | undefined;

    periodStart = activityRow
      ? new Date(activityRow.last_active_at)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
  } catch (e) {
    periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  }

  const periodEnd = new Date();

  // 3. Count messages & fetch grounded events
  let missedCount = 0;
  let totalCount = 0;
  let events: any[] = [];
  let recentMessages: any[] = [];

  try {
    const countRow = db
      .prepare("SELECT COUNT(*) as count FROM discord_messages WHERE channel_id = ? AND timestamp >= ?")
      .get(activeChannel.id, periodStart.toISOString()) as { count: number };
    missedCount = countRow?.count || 0;

    const totalRow = db
      .prepare("SELECT COUNT(*) as count FROM discord_messages WHERE channel_id = ?")
      .get(activeChannel.id) as { count: number };
    totalCount = totalRow?.count || 0;

    events = db
      .prepare(`
        SELECT event_id, type, title, description, owner, deadline, confidence, source_message_id, source_url, created_at
        FROM conversation_events
        WHERE channel_id = ? AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 10
      `)
      .all(activeChannel.id, periodStart.toISOString());

    recentMessages = db
      .prepare(`
        SELECT discord_message_id, author_name, author_avatar, content, timestamp, source_url
        FROM discord_messages
        WHERE channel_id = ?
        ORDER BY timestamp DESC
        LIMIT 15
      `)
      .all(activeChannel.id);
  } catch (e) {
    // Graceful fallback
  }

  const initialData = {
    connected: true,
    guild: activeGuild || { id: activeChannel.guild_id, name: "Discord Server", icon: null },
    channel: activeChannel,
    guilds,
    channels,
    missed_messages_count: missedCount,
    total_messages_count: totalCount,
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    important_events: events.map((e: any) => ({
      id: e.event_id,
      type: e.type,
      title: e.title,
      summary: e.description,
      owner: e.owner,
      deadline: e.deadline,
      confidence: e.confidence,
      source_message_id: e.source_message_id,
      source_url: e.source_url,
      created_at: e.created_at,
    })),
    recent_messages: recentMessages.map((m: any) => ({
      id: m.discord_message_id,
      author: m.author_name,
      avatar: m.author_avatar,
      content: m.content,
      timestamp: m.timestamp,
      url: m.source_url,
    })),
  };

  return <ReentryDashboard session={session} initialData={initialData} />;
}
