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
        const targetChannelId = args?.channel_id;

        // Server-wide catchup across all channels in the server
        if (targetChannelId === "all" || (!targetChannelId && !channelId)) {
          const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const periodEnd = new Date();

          const countRow = db
            .prepare("SELECT COUNT(*) as count FROM discord_messages WHERE timestamp >= ?")
            .get(periodStart.toISOString()) as { count: number };

          const events = db
            .prepare(`
              SELECT event_id, type, title, description, owner, deadline, confidence, source_message_id, source_url, created_at
              FROM conversation_events
              WHERE created_at >= ?
              ORDER BY created_at DESC
              LIMIT 15
            `)
            .all(periodStart.toISOString()) as any[];

          return NextResponse.json({
            success: true,
            scope: "server",
            channel_name: "All Channels (Server-Wide)",
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

        const activeChannelId = targetChannelId || channelId;

        // 1. Get user last active time or default to 24h ago
        const activityRow = db
          .prepare("SELECT last_active_at FROM user_channel_activity WHERE user_id = ? AND channel_id = ?")
          .get(userId, activeChannelId) as { last_active_at: string } | undefined;

        const periodStart = activityRow
          ? new Date(activityRow.last_active_at)
          : new Date(Date.now() - 24 * 60 * 60 * 1000);
        const periodEnd = new Date();

        // 2. Count real messages in window
        const countRow = db
          .prepare("SELECT COUNT(*) as count FROM discord_messages WHERE channel_id = ? AND timestamp >= ?")
          .get(activeChannelId, periodStart.toISOString()) as { count: number };

        // 3. Get Layer 2 events in window
        const events = db
          .prepare(`
            SELECT event_id, type, title, description, owner, deadline, confidence, source_message_id, source_url, created_at
            FROM conversation_events
            WHERE channel_id = ? AND created_at >= ?
            ORDER BY created_at DESC
            LIMIT 10
          `)
          .all(activeChannelId, periodStart.toISOString()) as any[];

        // 4. Get channel info
        const channelRow = db
          .prepare("SELECT name FROM discord_channels WHERE id = ?")
          .get(activeChannelId) as { name: string } | undefined;

        return NextResponse.json({
          success: true,
          scope: "channel",
          channel_id: activeChannelId,
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
        const targetChannelId = args?.channel_id;

        if (!query) {
          return NextResponse.json({ error: "Search query is required" }, { status: 400 });
        }

        const pattern = `%${query}%`;
        const isServerWide = !targetChannelId || targetChannelId === "all";

        const rows = isServerWide
          ? (db
              .prepare(`
                SELECT discord_message_id, author_name, channel_name, content, timestamp, source_url
                FROM discord_messages
                WHERE (content LIKE ? OR author_name LIKE ?)
                ORDER BY timestamp DESC
                LIMIT 15
              `)
              .all(pattern, pattern) as any[])
          : (db
              .prepare(`
                SELECT discord_message_id, author_name, channel_name, content, timestamp, source_url
                FROM discord_messages
                WHERE channel_id = ? AND (content LIKE ? OR author_name LIKE ?)
                ORDER BY timestamp DESC
                LIMIT 15
              `)
              .all(targetChannelId, pattern, pattern) as any[]);

        return NextResponse.json({
          success: true,
          scope: isServerWide ? "server" : "channel",
          query,
          count: rows.length,
          results: rows.map((r) => ({
            message_id: r.discord_message_id,
            channel: r.channel_name,
            author: r.author_name,
            content: r.content,
            timestamp: r.timestamp,
            source_url: r.source_url,
          })),
        });
      }

      case "get_server_overview": {
        const channels = db
          .prepare("SELECT id, name, topic FROM discord_channels ORDER BY name ASC")
          .all() as any[];

        return NextResponse.json({
          success: true,
          total_channels: channels.length,
          channels: channels.map((c) => ({
            id: c.id,
            name: c.name,
            topic: c.topic || "General discussion",
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
        const title = String(args?.title || "Untitled Task").trim();
        const description = args?.description ? String(args.description) : "";
        const dueDate = args?.due_date ? String(args.due_date) : undefined;
        const sourceUrl = args?.source_url ? String(args.source_url) : undefined;

        // 1. Check Linear
        const linearApiKey = process.env.LINEAR_API_KEY;
        const linearTeamId = process.env.LINEAR_TEAM_ID;

        if (linearApiKey && linearTeamId) {
          let desc = description;
          if (channelName) desc += `\n**Channel:** #${channelName}`;
          if (sourceUrl) desc += `\n**Source Discord Message:** [Jump to Message](${sourceUrl})`;
          desc += "\n\n---\n*Created automatically via Project Re-entry Voice Agent*";

          const linearRes = await fetch("https://api.linear.app/graphql", {
            method: "POST",
            headers: {
              "Authorization": linearApiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: `
                mutation CreateIssue($input: IssueCreateInput!) {
                  issueCreate(input: $input) {
                    success
                    issue { id identifier title url createdAt }
                  }
                }
              `,
              variables: {
                input: {
                  title,
                  description: desc.trim(),
                  teamId: linearTeamId,
                  ...(dueDate ? { dueDate } : {}),
                },
              },
            }),
          });

          if (!linearRes.ok) {
            const errText = await linearRes.text().catch(() => linearRes.statusText);
            return NextResponse.json({
              success: false,
              error: `Linear API error (${linearRes.status}): ${errText}`,
            });
          }

          const linearData = (await linearRes.json()) as any;
          const issue = linearData?.data?.issueCreate?.issue;
          if (!issue) {
            return NextResponse.json({
              success: false,
              error: "Linear task creation did not return a valid issue.",
            });
          }

          db.prepare(`
            INSERT INTO tasks (id, user_id, provider, external_id, external_url, title, description, due_date, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(`linear_${issue.id}`, userId, "linear", issue.identifier, issue.url, issue.title, desc, dueDate || null, "open");

          return NextResponse.json({
            success: true,
            task_id: `linear_${issue.id}`,
            provider: "linear",
            external_id: issue.identifier,
            task_url: issue.url,
            title: issue.title,
            message: `Created Linear issue #${issue.identifier}: "${issue.title}". Link: ${issue.url}`,
          });
        }

        // 2. Check GitHub (User OAuth token or environment token)
        const ghAccount = db
          .prepare("SELECT access_token FROM accounts WHERE userId = ? AND provider = 'github'")
          .get(userId) as { access_token: string } | undefined;

        const ghToken = ghAccount?.access_token || process.env.GITHUB_TOKEN;
        const ghRepo = process.env.GITHUB_REPO;

        if (ghToken && ghRepo) {
          const [owner, repoName] = ghRepo.split("/");
          if (!owner || !repoName) {
            return NextResponse.json({
              success: false,
              error: `Invalid GITHUB_REPO format "${ghRepo}". Expected format: "owner/repo".`,
            });
          }

          let bodyMd = description;
          if (dueDate) bodyMd += `\n\n**Due Date:** ${dueDate}`;
          if (channelName) bodyMd += `\n**Channel:** #${channelName}`;
          if (sourceUrl) bodyMd += `\n**Source Discord Message:** [Jump to Message](${sourceUrl})`;
          bodyMd += "\n\n---\n*Created automatically via Project Re-entry Voice Agent*";

          const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/issues`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${ghToken}`,
              "Accept": "application/vnd.github.v3+json",
              "User-Agent": "Project-Reentry-Web",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title,
              body: bodyMd.trim(),
              labels: ["reentry", "voice-task"],
            }),
          });

          if (!ghRes.ok) {
            const errText = await ghRes.text().catch(() => ghRes.statusText);
            return NextResponse.json({
              success: false,
              error: `GitHub API error (${ghRes.status}): ${errText}`,
            });
          }

          const ghData = (await ghRes.json()) as any;
          db.prepare(`
            INSERT INTO tasks (id, user_id, provider, external_id, external_url, title, description, due_date, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(`gh_${ghData.id}`, userId, "github", String(ghData.number), ghData.html_url, ghData.title, bodyMd, dueDate || null, "open");

          return NextResponse.json({
            success: true,
            task_id: `gh_${ghData.id}`,
            provider: "github",
            external_id: String(ghData.number),
            task_url: ghData.html_url,
            title: ghData.title,
            message: `Created GitHub Issue #${ghData.number}: "${ghData.title}". Link: ${ghData.html_url}`,
          });
        }

        // 3. No external task backend configured — fail honestly
        return NextResponse.json({
          success: false,
          error: `Task creation is not available: an external task provider (GitHub Issues or Linear) has not been connected to this workspace. To enable real task creation, set GITHUB_TOKEN & GITHUB_REPO or LINEAR_API_KEY & LINEAR_TEAM_ID. The task "${title}" was not created.`,
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
