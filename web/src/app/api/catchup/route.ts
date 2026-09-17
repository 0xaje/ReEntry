import { NextResponse } from "next/server";
import { auth } from "@/auth";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth();
    const { searchParams } = new URL(request.url);
    const requestedChannelId = searchParams.get("channelId");

    // 1. Get available guilds & channels from database
    const guilds = db.prepare("SELECT id, name, icon FROM discord_guilds ORDER BY name ASC").all() as any[];
    const channels = db.prepare("SELECT id, guild_id, name, type, topic FROM discord_channels ORDER BY name ASC").all() as any[];

    if (channels.length === 0) {
      return NextResponse.json({
        connected: false,
        guilds: [],
        channels: [],
        message: "No Discord channels indexed yet. Ensure the Discord bot is running and invited to your server.",
      });
    }

    // Select active channel (requested or first available)
    const activeChannel = channels.find((c) => c.id === requestedChannelId) || channels[0];
    const activeGuild = guilds.find((g) => g.id === activeChannel.guild_id);

    const userId = session?.user?.id || "anonymous-user";

    // 2. Determine away window from activity or default to 24h
    const activityRow = db
      .prepare("SELECT last_active_at FROM user_channel_activity WHERE user_id = ? AND channel_id = ?")
      .get(userId, activeChannel.id) as { last_active_at: string } | undefined;

    const periodStart = activityRow
      ? new Date(activityRow.last_active_at)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const periodEnd = new Date();

    // 3. Count real messages in window
    const countRow = db
      .prepare("SELECT COUNT(*) as count FROM discord_messages WHERE channel_id = ? AND timestamp >= ?")
      .get(activeChannel.id, periodStart.toISOString()) as { count: number };

    // Total messages recorded in channel
    const totalRow = db
      .prepare("SELECT COUNT(*) as count FROM discord_messages WHERE channel_id = ?")
      .get(activeChannel.id) as { count: number };

    // 4. Retrieve Layer 2 grounded conversation events
    const events = db
      .prepare(`
        SELECT event_id, type, title, description, owner, deadline, confidence, source_message_id, source_url, created_at
        FROM conversation_events
        WHERE channel_id = ? AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 10
      `)
      .all(activeChannel.id, periodStart.toISOString()) as any[];

    // 5. Retrieve recent messages for evidence preview
    const recentMessages = db
      .prepare(`
        SELECT discord_message_id, author_name, author_avatar, content, timestamp, source_url
        FROM discord_messages
        WHERE channel_id = ?
        ORDER BY timestamp DESC
        LIMIT 15
      `)
      .all(activeChannel.id) as any[];

    return NextResponse.json({
      connected: true,
      guild: activeGuild || { id: activeChannel.guild_id, name: "Discord Server", icon: null },
      channel: activeChannel,
      guilds,
      channels,
      missed_messages_count: countRow?.count || 0,
      total_messages_count: totalRow?.count || 0,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      important_events: events.map((e) => ({
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
      recent_messages: recentMessages.map((m) => ({
        id: m.discord_message_id,
        author: m.author_name,
        avatar: m.author_avatar,
        content: m.content,
        timestamp: m.timestamp,
        url: m.source_url,
      })),
    });
  } catch (err: any) {
    console.error("Catchup fetch error:", err);
    return NextResponse.json({ error: err.message || "Failed to load catch-up data" }, { status: 500 });
  }
}
