import { NextResponse } from "next/server";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Daily Digest Webhook / Cron Endpoint.
 * Can be called by Vercel Cron, GitHub Actions, or any HTTP webhook scheduler.
 *
 * Optional security:
 * Provide CRON_SECRET in .env and include header `Authorization: Bearer <CRON_SECRET>`
 */
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const hours = Number(body.hours) || 24;
    const sinceDate = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // Query recent blockers and decisions
    const recentEvents = db
      .prepare(`
        SELECT event_id, type, title, description, owner, deadline, confidence, source_url, channel_id, created_at
        FROM conversation_events
        WHERE type IN ('blocker', 'decision', 'action_item') AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 50
      `)
      .all(sinceDate) as any[];

    const blockers = recentEvents.filter((e) => e.type === "blocker");
    const decisions = recentEvents.filter((e) => e.type === "decision");
    const actionItems = recentEvents.filter((e) => e.type === "action_item");

    // Fetch active users to report on
    const activeUsers = db
      .prepare(`SELECT DISTINCT user_id FROM user_channel_activity`)
      .all() as { user_id: string }[];

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      timeframe_hours: hours,
      stats: {
        active_users_tracked: activeUsers.length,
        total_events_in_window: recentEvents.length,
        blockers_count: blockers.length,
        decisions_count: decisions.length,
        action_items_count: actionItems.length,
      },
      top_blockers: blockers.slice(0, 5),
      top_decisions: decisions.slice(0, 5),
      message: `Daily digest calculated: ${blockers.length} blocker(s) and ${decisions.length} decision(s) across tracked channels.`,
    });
  } catch (err: any) {
    console.error("[DailyDigestWebhook] Error generating digest webhook response:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to process digest webhook" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
