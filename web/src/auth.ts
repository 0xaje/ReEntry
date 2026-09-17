import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import db from "./lib/db";
import { randomUUID } from "crypto";


export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "identify email guilds",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      try {
        const discordId = account?.providerAccountId;
        let internalUserId = user.id;

        // Check if user exists by discord_id or email
        let existingUser: { id: string } | undefined;
        if (discordId) {
          existingUser = db.prepare("SELECT id FROM users WHERE discord_id = ?").get(discordId) as { id: string } | undefined;
        }
        if (!existingUser && user.email) {
          existingUser = db.prepare("SELECT id FROM users WHERE email = ?").get(user.email) as { id: string } | undefined;
        }

        if (existingUser) {
          internalUserId = existingUser.id;
          // Update profile details
          db.prepare(`
            UPDATE users SET discord_id = COALESCE(?, discord_id), name = ?, image = ?
            WHERE id = ?
          `).run(discordId || null, user.name || null, user.image || null, internalUserId);
        } else {
          internalUserId = internalUserId || randomUUID();
          db.prepare(`
            INSERT INTO users (id, discord_id, email, name, image)
            VALUES (?, ?, ?, ?, ?)
          `).run(internalUserId, discordId || null, user.email || null, user.name || null, user.image || null);
        }

        user.id = internalUserId;

        if (account && discordId) {
          db.prepare(`
            INSERT INTO accounts (id, userId, provider, providerAccountId, access_token)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(provider, providerAccountId) DO UPDATE SET 
              userId = excluded.userId,
              access_token = excluded.access_token
          `).run(randomUUID(), internalUserId, account.provider, discordId, account.access_token || null);
        }

        return true;
      } catch (e) {
        console.error("SignIn error:", e);
        return false;
      }
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.sub = user.id;
      }
      if (account?.providerAccountId) {
        token.discordId = account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (token.sub) session.user.id = token.sub;
        (session.user as any).discordId = token.discordId;
      }
      return session;
    },
  },
});
