# Project Re-entry: Architecture Specification

## 1. Thesis & Design Philosophy

> *"You don't need another summary. You need to know what happened while you were gone."*

Project Re-entry enables individuals returning to high-volume Discord conversations to rapidly regain full context. Rather than providing generic narrative summaries, it extracts discrete, verified conversation events (decisions, tasks, deadlines, blockers, mentions, and updates), calculates user-specific relevance, and delivers a voice-native conversational briefing powered by the **AssemblyAI Voice Agent API**.

Every claim made by the system is grounded in verifiable Discord evidence with exact snowflake IDs and permalinks.

---

## 2. System Architecture

Project Re-entry decouples ingestion, state grounding, web telemetry, and full-duplex voice execution into three focused pipelines:

### Pipeline A: User & Web Client
```
USER
  │
  ▼
RE-ENTRY WEB CLIENT (Next.js 14 App Router)
  │
  ▼
NEXT.JS API (/api/catchup)
  │
  ▼
CATCH-UP / RELEVANCE ENGINE
  │
  ▼
SQLITE (data/reentry.db)
```

### Pipeline B: Discord Gateway Ingestion
```
DISCORD GUILD (#general)
  │
  ▼
DISCORD GATEWAY (discord.js v14: GatewayIntentBits.MessageContent)
  │
  ▼
INGESTION PIPELINE
  ├── Layer 1: Raw Message Store (discord_messages)
  ├── Layer 2: Event Extractor (conversation_events)
  └── Layer 3: User Relevance Engine (user_relevance)
  │
  ▼
SQLITE (data/reentry.db)
```

### Pipeline C: Full-Duplex Voice Agent
```
VOICE CLIENT (Browser Web Audio / PCM16 24 kHz)
  │
  ├─► POST /api/voice/token (Server mints 600s ephemeral AssemblyAI token)
  │
  ▼
ASSEMBLYAI VOICE AGENT (wss://agents.assemblyai.com/v1/ws)
  │
  ▼
VOICE TOOLS (/api/voice/tool)
  ├── get_catchup_context ──┐
  ├── search_conversation ──┼──► RE-ENTRY DATA (SQLite)
  ├── get_source ───────────┘          │
  └── create_task (Honest unavailable)  ▼
                                DISCORD SOURCE (Verified Permalinks)
```

---

## 3. Layer Breakdown

### Layer 1: Raw Message Storage (`discord_messages`)
- **Source of Truth**: Discord.
- **Ingestion**:
  - Live gateway event streaming via `discord.js` (`messageCreate`, `messageDelete`).
  - Historical backfilling via `backfillChannelHistory` with pagination.
- **Attributes Captured**:
  - `discord_message_id`: Discord snowflake ID.
  - `guild_id`, `channel_id`, `channel_name`.
  - `author_id`, `author_name`, `author_avatar`.
  - `content`, `timestamp`.
  - `reply_to_message_id`, `thread_id`, `attachments_json`.
  - `source_url`: `https://discord.com/channels/{guild_id}/{channel_id}/{message_id}`.

### Layer 2: Conversation Event Extraction (`conversation_events`)
- Extracts meaningful, high-value conversation occurrences from real messages:
  - `decision`: Team consensus, architectural decisions, product agreements.
  - `task`: Action items assigned or claimed.
  - `deadline`: Deliverable dates and commitments.
  - `blocker`: Critical bugs, impediments, deployment failures.
  - `question`: Unanswered inquiries requiring input.
  - `mention`: Direct callouts (<@userId>).
  - `important_update`: Key announcements and state changes.
- **Confidence Model**:
  - `CONFIRMED`: Explicitly and unambiguously stated in the message text.
  - `INFERRED`: Derived from conversational context across messages.
  - `UNKNOWN`: Insufficient evidence (never fabricated).
- Every event retains a required `source_message_id` and `source_url`.

### Layer 3: User Relevance Layer (`user_relevance`)
- Determines why an event matters to a specific authenticated user:
  - `direct_mention`: User was pinged in the message (Score: 1.0).
  - `assigned_to_user`: Task was explicitly associated with the user (Score: 0.95).
  - `user_reply`: Message is a direct reply to user's earlier message (Score: 0.9).
  - `contextual_relevance`: Team decision, blocker, or deadline in user's channel (Score: 0.7 - 0.8).
- Prioritization:
  1. Direct mentions
  2. Tasks assigned to user
  3. Replies to user
  4. Blockers affecting the team
  5. Decisions and deadlines

---

## 4. AssemblyAI Voice Agent Integration

- **Protocol**: Full-duplex WebSocket at `wss://agents.assemblyai.com/v1/ws`.
- **Audio Specifications**:
  - Input: PCM 16-bit mono 24 kHz streamed via `input.audio` chunks.
  - Output: PCM 16-bit mono 24 kHz received via `reply.audio` chunks.
  - Turn-Taking: Managed natively by AssemblyAI Voice Activity Detection (VAD).
  - Interruption / Barge-in: Handles `reply.done` with `status: "interrupted"`, clearing client audio queue immediately.
- **Security & Ephemeral Tokens**:
  - Permanent `ASSEMBLYAI_API_KEY` resides strictly on the server.
  - Browser requests single-use token from `POST /api/voice/token` (`POST https://agents.assemblyai.com/v1/token`).
- **Voice Agent Tools**:
  1. `get_catchup_context(channel_id)`: Fetches personalized briefing for the channel.
  2. `search_conversation(query, channel_id)`: Searches stored messages and events.
  3. `get_source(message_id)`: Retrieves full message text, author, timestamp, and Discord jump URL.
  4. `create_task(title, description, due_date)`: External task provider boundary (fails honestly if no provider is connected).

---

## 5. Implementation Status

| Subsystem | Status | Details |
| :--- | :--- | :--- |
| **Discord Gateway Ingestion** | **IMPLEMENTED** | Real-time `messageCreate`, `messageDelete` handlers in `src/discord/`. |
| **Historical Backfill Service** | **IMPLEMENTED** | `backfillChannelHistory` retrieves real Discord history. |
| **SQLite Persistence Layer** | **IMPLEMENTED** | Full schema in `src/core/db.ts` & `web/src/lib/db.ts`. |
| **Layer 2 Event Extraction** | **IMPLEMENTED** | Deterministic & LLM-assisted extractors in `src/core/extractor.ts`. |
| **Layer 3 User Relevance** | **IMPLEMENTED** | Mentions, replies, tasks scoring in `src/core/relevance.ts`. |
| **Catch-up Context Engine** | **IMPLEMENTED** | Dynamic away window calculation in `src/core/relevance.ts`. |
| **AssemblyAI Token Route** | **IMPLEMENTED** | `POST /api/voice/token` in `web/src/app/api/voice/token/`. |
| **Voice Tool Execution Route** | **IMPLEMENTED** | `POST /api/voice/tool` in `web/src/app/api/voice/tool/`. |
| **Web Audio PCM Streaming** | **IMPLEMENTED** | AudioContext & ScriptProcessor in `web/src/components/VoiceAgentModal.tsx`. |
| **Re-entry Command Center UI** | **IMPLEMENTED** | High-aesthetic dashboard in `web/src/components/ReentryDashboard.tsx`. |
| **Discord Slash Command `/catchup`** | **IMPLEMENTED** | Evidence-grounded slash command in `src/discord/commands/catchup.ts`. |
| **Automated Test Suite** | **IMPLEMENTED** | 22 tests across 4 test suites in `tests/` using Vitest. |
| **External Task Integration (Linear/GitHub)** | **PLANNED** | Tool schema defined; fails honestly until external API is connected. |
