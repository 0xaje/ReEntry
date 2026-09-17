import { NextResponse } from "next/server";
import { auth } from "@/auth";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();
    const body = await request.json();
    const { toolName, args, channelId, channelName } = body;

    const userId = session?.user?.id || "anonymous-user";
    const discordId = (session?.user as any)?.discordId || "";

    switch (toolName) {
      case "get_catchup_context": {
        const targetChannelId = args?.channel_id || channelId;
        if (!targetChannelId) {
          return NextResponse.json({ error: "Missing channel_id" }, { status: 400 });
        }

        // 1. Get user last active time or default to 24h ago
        const activityRow = db
          .prepare("SELECT last_active_at FROM user_channel_activity WHERE user_id = ? AND channel_id = ?")
          .get(userId, targetChannelId) as { last_active_at: string } | undefined;

        const periodStart = activityRow
          ? new Date(activityRow.last_active_at)
          : new Date(Date.now() - 24 * 60 * 60 * 1000);
        const periodEnd = new Date();

        // 2. Count real messages in window
        const countRow = db
          .prepare("SELECT COUNT(*) as count FROM discord_messages WHERE channel_id = ? AND timestamp >= ?")
          .get(targetChannelId, periodStart.toISOString()) as { count: number };

        // 3. Get Layer 2 events in window
        const events = db
          .prepare(`
            SELECT event_id, type, title, description, owner, deadline, confidence, source_message_id, source_url, created_at
            FROM conversation_events
            WHERE channel_id = ? AND created_at >= ?
            ORDER BY created_at DESC
            LIMIT 10
          `)
          .all(targetChannelId, periodStart.toISOString()) as any[];

        // 4. Get channel info
        const channelRow = db
          .prepare("SELECT name FROM discord_channels WHERE id = ?")
          .get(targetChannelId) as { name: string } | undefined;

        return NextResponse.json({
          success: true,
          channel_id: targetChannelId,
          channel_name: channelRow?.name || channelName || "channel",
          missed_messages_count: countRow?.count || 0,
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
          important_events: events.map((e) => ({
            type: e.type,
            title: e.title,
            summary: e.description,
            owner: e.owner,
            deadline: e.deadline,
            confidence: e.confidence,
            source_message_id: e.source_message_id,
            source_url: e.source_url,
          })),
        });
      }

      case "search_conversation": {
        const query = String(args?.query || "").trim();
        const targetChannelId = args?.channel_id || channelId;

        if (!query) {
          return NextResponse.json({ error: "Search query is required" }, { status: 400 });
        }

        const pattern = `%${query}%`;
        const rows = db
          .prepare(`
            SELECT discord_message_id, author_name, channel_name, content, timestamp, source_url
            FROM discord_messages
            WHERE channel_id = ? AND (content LIKE ? OR author_name LIKE ?)
            ORDER BY timestamp DESC
            LIMIT 10
          `)
          .all(targetChannelId, pattern, pattern) as any[];

        return NextResponse.json({
          success: true,
          query,
          count: rows.length,
          results: rows.map((r) => ({
            message_id: r.discord_message_id,
            author: r.author_name,
            content: r.content,
            timestamp: r.timestamp,
            source_url: r.source_url,
          })),
        });
      }

      case "get_source": {
        const messageId = String(args?.message_id || "").trim();
        if (!messageId) {
          return NextResponse.json(
            { found: false, error: "No message ID provided" },
            { status: 400 }
          );
        }

        const msg = db
          .prepare(`
            SELECT discord_message_id, author_name, author_id, channel_id, channel_name, content, timestamp, source_url
            FROM discord_messages
            WHERE discord_message_id = ?
            LIMIT 1
          `)
          .get(messageId) as any;

        if (!msg) {
          return NextResponse.json({
            found: false,
            message_id: messageId,
            error: "The original Discord message could not be retrieved from the evidence index.",
          });
        }

        return NextResponse.json({
          found: true,
          message_id: msg.discord_message_id,
          author: msg.author_name,
          channel: msg.channel_name,
          timestamp: msg.timestamp,
          content: msg.content,
          source_url: msg.source_url,
        });
      }

      case "create_task": {
        // Spec rule 15: Fail honestly if no real external task provider is connected
        return NextResponse.json({
          success: false,
          error: `Task creation is not available: an external task provider (e.g. Linear / GitHub Issues / Todoist) has not been connected to this workspace. The task "${args?.title || "Untitled"}" was not created.`,
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown tool "${toolName}"` },
          { status: 400 }
        );
    }
  } catch (err: any) {
    console.error("Tool execution error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to execute tool" },
      { status: 500 }
    );
  }
}
