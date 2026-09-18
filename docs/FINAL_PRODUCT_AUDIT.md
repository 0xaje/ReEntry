# Project Re-entry: Final Product Audit

**Date:** September 18, 2026  
**Auditor:** Senior Product & Staff Systems Engineer  
**Scope:** Full-stack Architecture, Frontend UX, Ingestion Pipeline, AssemblyAI Voice Agent, Database Integrity, and Security.

---

## 1. Current Architecture

Project Re-entry is an evidence-grounded, voice-native Discord conversation re-entry assistant built upon a three-layer architecture:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           1. INGESTION PIPELINE                             │
│                                                                             │
│   Discord Gateway (discord.js v14)                                          │
│   ├── GatewayIntentBits: Guilds, GuildMessages, MessageContent              │
│   └── Event Ingestion: messageCreate, messageDelete, backfillChannelHistory │
│         │                                                                   │
│         ▼                                                                   │
│   Layer 1: Raw Messages (SQLite: discord_messages)                          │
│   └── Authoritative snowflakes, author metadata, text, attachments, jumpUrl │
│         │                                                                   │
│         ▼                                                                   │
│   Layer 2: Extracted Events (SQLite: conversation_events)                   │
│   └── Discrete items: decision, task, deadline, blocker, question, mention  │
│       Every event strictly tied to backing source_message_id and source_url │
│         │                                                                   │
│         ▼                                                                   │
│   Layer 3: User Relevance (SQLite: user_relevance)                          │
│   └── Scored 0.0–1.0 based on mentions, assigned tasks, replies, blockers  │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           2. CATCH-UP CONTEXT API                           │
│                                                                             │
│   Next.js 14 App Router API: /api/catchup?channelId=...                     │
│   ├── Identifies away window via user_channel_activity (or default 24h)     │
│   ├── Retrieves unread message count and relevant Layer 2 events            │
│   └── Supplies grounded recent message log for audit transparency           │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         3. VOICE RE-ENTRY ENGINE                            │
│                                                                             │
│   Browser Client                                                            │
│   ├── GET /api/voice/token -> Server mints 600s ephemeral AssemblyAI token  │
│   ├── WebSocket wss://agents.assemblyai.com/v1/ws?token=...                 │
│   ├── PCM16 mono 24 kHz full-duplex streaming (mic input + agent speaker)   │
│   ├── Native barge-in & interruption handling via AssemblyAI VAD            │
│   └── Tool Execution Loop: POST /api/voice/tool                             │
│       ├── get_catchup_context: retrieves channel events                     │
│       ├── search_conversation: queries real stored messages                 │
│       ├── get_source: fetches backing message evidence & jump URL           │
│       └── create_task: honestly reports unavailable if no task provider     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Current User Flow

1. **Authentication & Identity**:
   - User authenticates via Discord OAuth2 (`web/src/auth.ts`) using scopes `identify email guilds`.
   - The user's Discord ID and avatar are stored in SQLite and bound to the session.
   - A local evaluation mode allows testing without third-party OAuth redirect loops.

2. **Context Telemetry**:
   - The user selects an indexed Discord guild and channel (`#general`).
   - The interface computes the duration since last active and presents the count of unread real messages.

3. **Grounded Briefing Cards**:
   - Key conversation occurrences (decisions, blockers, deadlines, questions, tasks) appear in structured HUD panels with tailored color accents.
   - Each event features an authoritative `[View source]` link that jumps directly to the Discord message in the Discord desktop/web app.

4. **Voice Catch-Up**:
   - User clicks `[ Catch me up ]`.
   - Browser initializes an AudioContext, requests mic permissions, and establishes a secure WebSocket connection to AssemblyAI's voice agent.
   - AssemblyAI introduces itself in context of the channel and answers conversational questions.
   - When the user asks for sources, the agent invokes `get_source` and renders the exact verified message permalink in the transcript.
   - The user can interrupt the agent at any point; audio immediately stops and the agent listens to the new prompt.

---

## 3. Frontend Structure

- **Framework**: Next.js 14.2.3 App Router with React 18, Tailwind CSS, and Lucide icons.
- **Theme**: Deep Cyber Blueprint (`#08296a` canvas, `#092c73` topbar, `#041a4a` modal dialogs, `#020c24` telemetry panels).
- **Core Components**:
  - `web/src/app/page.tsx`: Server component fetching initial channel context and session.
  - `web/src/components/ReentryDashboard.tsx`: Client dashboard with live telemetry, channel selector, hero activity card, grounded event feed, and authoritative message log.
  - `web/src/components/VoiceAgentModal.tsx`: Voice agent modal with WebSocket client, PCM16 resampling, AudioContext playback queue, live transcript, and tool execution status.

---

## 4. Backend Structure

- **Discord Service (`src/discord/`)**:
  - `index.ts`: Discord client initialization with gateway intents.
  - `events/messageCreate.ts`: Real-time ingestion and event extraction trigger.
  - `commands/catchup.ts`: Native Discord `/catchup` slash command.
- **Core Intelligence (`src/core/`)**:
  - `db.ts`: SQLite schema and data access layer (`better-sqlite3`).
  - `extractor.ts`: Layer 2 event extractor with LLM support and deterministic rule-based fallback.
  - `relevance.ts`: Layer 3 user relevance scoring.
  - `types.ts`: Shared TypeScript interfaces.
- **Web API Routes (`web/src/app/api/`)**:
  - `/api/catchup`: Channel unread metrics, grounded events, and recent message log.
  - `/api/voice/token`: Server-side ephemeral token minting for AssemblyAI.
  - `/api/voice/tool`: Tool execution dispatcher (`get_catchup_context`, `search_conversation`, `get_source`, `create_task`).

---

## 5. Database Structure

Located at `data/reentry.db` (SQLite 3 with WAL mode and 10-second busy timeout):
1. `discord_guilds`: Server metadata (`id`, `name`, `icon`, `owner_id`, `joined_at`).
2. `discord_channels`: Channel metadata (`id`, `guild_id`, `name`, `type`, `topic`, `last_synced_at`).
3. `discord_messages`: Layer 1 raw messages (`discord_message_id`, `guild_id`, `channel_id`, `channel_name`, `author_id`, `author_name`, `content`, `timestamp`, `source_url`). Indexed on `(channel_id, timestamp DESC)` and `discord_message_id`.
4. `conversation_events`: Layer 2 events (`event_id`, `guild_id`, `channel_id`, `type`, `title`, `description`, `owner`, `deadline`, `confidence`, `source_message_id`, `source_url`).
5. `user_relevance`: Layer 3 relevance scores (`id`, `user_id`, `event_id`, `relevance_type`, `relevance_score`, `reason`, `confidence`).
6. `user_channel_activity`: Tracking away windows (`user_id`, `channel_id`, `last_active_at`).
7. `users` and `accounts`: Authentication records.

---

## 6. Integrations & Third-Party APIs

| Service | Protocol / Version | Security Posture | Active Status |
|---|---|---|---|
| **Discord Bot** | WebSocket Gateway (discord.js v14) | Bot token in server `.env`; privileged MessageContent intent enabled | ✅ Connected as `ReEntry#6260` |
| **Discord OAuth** | HTTPS OAuth2 (NextAuth v5 beta) | Client Secret in server `web/.env.local`; scopes `identify email guilds` | ✅ Operational |
| **AssemblyAI Agent** | Full-duplex WebSocket (`wss://agents.assemblyai.com/v1/ws`) | Ephemeral 600s tokens minted server-side via `POST /api/voice/token` | ✅ Verified Live |
| **OpenAI / Gemini** | HTTPS REST | Key in `.env`; graceful fallback to deterministic extraction if unset | ✅ Operational |

---

## 7. Security Model

1. **Permanent Credentials Server-Only**:
   - `DISCORD_TOKEN`, `DISCORD_CLIENT_SECRET`, and `ASSEMBLYAI_API_KEY` are never bundled into client JavaScript, never written to `localStorage`, and never sent to browser networks.
2. **Ephemeral Tokens**:
   - AssemblyAI streaming sessions utilize temporary 600-second tokens minted on-demand via authenticated backend calls.
3. **Evidence Grounding**:
   - All claims must be backed by a verified `discord_message_id`. No ungrounded synthetic events are admitted into `conversation_events`.
4. **Tool Honesty**:
   - `create_task` returns an explicit failure explaining that no external task provider (e.g. Linear) is connected. No fake success states are ever emitted.
5. **Untracked Environment & Data**:
   - `.env`, `web/.env.local`, and `data/reentry.db` are explicitly ignored in `.gitignore`.

---

## 8. Known Limitations & Polish Opportunities

1. **Next.js Lint Warnings**:
   - `ReentryDashboard.tsx` uses raw `<img>` tags for user and author avatars, producing Next.js optimization warnings.
   - *Polish action*: Replace with Next.js `<Image />` (`unoptimized: true`) or standard styled SVG avatar icons.
2. **Legacy Pulse Remnants in Scripts**:
   - `scripts/setup.sh` references legacy Pulse tools (`ffmpeg-static`, `grammy`, `WhatsApp`).
   - *Polish action*: Modernize `scripts/setup.sh` to reflect Project Re-entry's actual requirements.
3. **Repository URLs in README**:
   - `README.md` references the old fork URL (`github.com/Zlatan327/pulse.git`).
   - *Polish action*: Update references to `https://github.com/0xaje/ReEntry.git`.
4. **Voice Agent Diagnostics**:
   - Ensure microphone permission denial and network reconnects present an immediate "Retry Connection" button without requiring modal restart.

---

## 9. Verdict

The system architecture is fundamentally sound, fully grounded in real Discord data and AssemblyAI streaming, with zero fake data or mock providers. All polish opportunities identified above will be executed in Command 6.
