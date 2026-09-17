"use server";

import db from "@/lib/db";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";

/** Record that the user caught up on a channel, updating their last active time */
export async function markChannelCatchup(channelId: string) {
  const session = await auth();
  const userId = session?.user?.id || "anonymous-user";

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_channel_activity (user_id, channel_id, last_active_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, channel_id) DO UPDATE SET
      last_active_at = excluded.last_active_at
  `).run(userId, channelId, now);

  revalidatePath("/");
  return { success: true, last_active_at: now };
}

/** Reset away window to 1 hour ago for testing / demonstration purposes */
export async function setTestAwayTime(channelId: string, hoursAgo: number = 2) {
  const session = await auth();
  const userId = session?.user?.id || "anonymous-user";

  const targetDate = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO user_channel_activity (user_id, channel_id, last_active_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, channel_id) DO UPDATE SET
      last_active_at = excluded.last_active_at
  `).run(userId, channelId, targetDate);

  revalidatePath("/");
  return { success: true, last_active_at: targetDate };
}
