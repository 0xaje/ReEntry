# Project Re-entry: Architectural Audit & Transition Report

**Target File:** `docs/REENTRY_AUDIT.md`  
**Date:** September 2026  
**Author:** Lead Engineer  
**Status:** Initial Audit & Architectural Assessment  

---

## 1. Executive Summary

The existing repository is named **Pulse**, originally designed as a multi-platform ("cross-platform intelligence") chatbot companion that ingested messages from Discord, Telegram, and X (Twitter) to generate 30-second audio summaries using ElevenLabs text-to-speech, along with scheduled daily minutes, PDF extraction, and multi-language translation.

**Project Re-entry** shifts the fundamental product thesis:
> *"You don't need another summary. You need to know what happened while you were gone."*

Re-entry is a focused, evidence-grounded, voice-native conversation re-entry product specifically for **Discord**. It allows a user returning after time away to get an immediate, personalized briefing answering:
1. What changed?
2. What matters to me?
3. What requires my attention?
4. What should I do next?

The user can converse naturally via a real **AssemblyAI Voice Agent API** session (with barge-in / interruption support), trace every single statement back to an exact Discord message URL/ID, and invoke real tools (search conversations, retrieve sources, and trigger real task creation).

---

## 2. Existing Architecture Analysis

| Layer | Existing Pulse Implementation | Issues & Evaluation for Re-entry |
| :--- | :--- | :--- |
| **Monorepo Layout** | Root Node.js project (TypeScript, `tsx`) + `web/` (Next.js 14 App Router, TailwindCSS, Auth.js). | Root and web share `data/pulse.db`. Good foundation, but lacks cohesive build/dev tooling and type sharing. |
| **Discord Adapter** | `src/discord/` using `discord.js` v14. Captures `messageCreate`, `/catchup`, `/daily`. | Captures messages into SQLite, but schema only has `chat_id`, `user_id`, `text`, `timestamp`. Lacks guild ID, channel name, reply references, thread IDs, attachments metadata, source URLs, and batch fetch backfilling. |
| **Telegram Adapter** | `src/telegram/` using `grammy`. | **Out of scope.** Adds attack surface and dependency bloat. Must be removed. |
| **X (Twitter) Scraper** | `src/x/` using `playwright`, `agent-twitter-client`, stealth plugins. | **Out of scope.** High fragility, browser scraping overhead. Must be removed. |
| **Database** | SQLite via `better-sqlite3` at `data/pulse.db`. | Simple single-file relational DB. Can be modified/extended to support Layer 1 raw messages, Layer 2 conversation events, and Layer 3 user relevance evidence. |
| **Voice / TTS** | ElevenLabs API generating MP3 audio files uploaded to Discord/web. Direct voice reply via OpenAI/Gemini audio notes. | **Not voice-native agent.** Generates static audio files. Does NOT use AssemblyAI Voice Agent API. No streaming, no natural interruption/barge-in, no voice tool execution. Fundamentally needs replacement. |
| **AI / LLM** | Xiaomi MiMo / OpenCode Zen / Gemini via OpenAI SDK for generic batch summarization. | Prompts are generic ("summarize group chat"). No structured event extraction (decisions, blockers, deadlines, mentions), no confidence scoring, no trace linking to message IDs. |
| **Authentication** | NextAuth (v5 beta) in `web/` with Google, Twitter, Discord providers. | Has Discord OAuth provider, but relies on Twitter/Google. Discord OAuth must be the primary authentication flow to establish user identity, Discord ID, and guild access. |
| **Frontend UI** | `web/src/components/Dashboard.tsx` displaying "X Intelligence", Twitter monitors, and ElevenLabs audio players. | Completely mismatched with Project Re-entry. Doesn't show Discord guild/channel, unread message counts, away duration, key events with "View source", "Catch me up", or "Talk to Re-entry" voice UI. |
| **Tests & Verification** | No automated tests. Only ad-hoc manual scripts (`test-x.ts`, `test_gemini2.js`). | Unacceptable for production standard. Real integration tests for Discord ingestion, event extraction, source verification, and voice tools are required. |

---

## 3. Detailed Component Categorization

### KEEP
*Code that directly supports the new product:*
- **`better-sqlite3` database engine (`src/core/db.ts` & `web/src/lib/db.ts`)**: Fast, synchronous, zero-dependency SQLite layer shared between server and web UI.
- **Discord Gateway Client Foundation (`src/discord/index.ts`, `src/discord/events/ready.ts`)**: Established `discord.js` v14 client lifecycle with Guilds, GuildMessages, and MessageContent intents.
- **Next.js 14 App Router Framework (`web/`)**: Clean modern UI foundation with TailwindCSS, Lucide icons, and server actions/route handlers.

### MODIFY
*Code that can be adapted for Re-entry:*
- **`src/core/db.ts` & Schema**:
  - Update `messages` table to store full Discord metadata: `guild_id`, `channel_id`, `channel_name`, `author_id`, `author_name`, `author_avatar`, `content`, `timestamp`, `reply_to_id`, `thread_id`, `attachments_json`, `source_url`.
  - Add tables for **Layer 2 (Events)**: `conversation_events` (`id`, `event_type`, `summary`, `confidence`, `message_id`, `channel_id`, `guild_id`, `author_id`, `timestamp`, `raw_evidence`).
  - Add tables for **Layer 3 (Relevance & Catchup)**: `catchup_sessions`, `user_relevance` (`event_id`, `user_id`, `relevance_type`, `reason`, `is_inferred`).
  - Add table for **Real Tasks**: `tasks` (`id`, `user_id`, `title`, `description`, `due_date`, `source_message_id`, `status`, `created_at`).
- **`src/discord/events/messageCreate.ts`**:
  - Capture real Discord message content, author details, guild ID, channel ID/name, reply references, and construct direct Discord message jump URLs (`https://discord.com/channels/{guild_id}/{channel_id}/{message_id}`).
  - Strip out legacy PDF parsing and ElevenLabs file uploads.
- **`src/discord/index.ts` & Ingestion Service**:
  - Add historical message backfill capability (`fetchRecentMessages` with pagination) so when a user connects or specifies an away timeframe, messages that arrived while away are ingested immediately from the live Discord API.
- **`web/src/auth.ts`**:
  - Focus on Discord OAuth (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`) to authenticate users, map their Discord `providerAccountId` to their user account, and enable server-side verification of what channels/servers they belong to.
- **`src/core/config.ts`**:
  - Remove mandatory `ELEVENLABS_API_KEY` requirement (prevent boot crashes).
  - Add AssemblyAI API configuration (`ASSEMBLYAI_API_KEY`).
  - Support LLM provider configuration for real event extraction.

### REMOVE
*Code/features that conflict with or distract from Project Re-entry:*
- **X / Twitter Ingestion (`src/x/`)**: All 7 files (`autoLogin.ts`, `extractCookies.ts`, `index.ts`, `intelligence.ts`, `playwrightScraper.ts`, `scraper.ts`, `spaceHelper.ts`) and root test scripts (`test-x.ts`, `src/test-cookies.ts`).
- **Telegram Ingestion (`src/telegram/`)**: All Grammy handlers, middleware, and command files.
- **Audio Translation Layer (`src/core/translator.ts`, `src/core/transcriber.ts`)**: Auto-translating voice notes from foreign languages.
- **ElevenLabs Text-to-Speech (`src/core/tts.ts`, `src/core/audio.ts`)**: Static audio generation and ffmpeg speedup pipelines.
- **Generic Daily Digest & Cron Scheduler (`src/core/scheduler.ts`, `src/discord/commands/daily.ts`)**: Generic meeting minutes generator.
- **Obsolete Personas / Modes (`src/core/summarizer.ts`)**: "roast", "fun", "story", "manager" persona switches that disguise lack of concrete event grounding.
- **Watchlists & Social Intelligence (`web/src/app/actions.ts`, watchlist tables)**: Target monitoring for Twitter spaces/accounts.
- **Unused Heavy Dependencies**: `puppeteer`, `puppeteer-extra-plugin-stealth`, `playwright`, `playwright-extra`, `agent-twitter-client`, `twitter-agent`, `chrome-cookies-secure`, `grammy`, `@grammyjs/files`, `pdf-parse`, `elevenlabs`.

### REPLACE
*Architecture that is fundamentally wrong for the new product:*
- **Static Audio Summaries → Real AssemblyAI Voice Agent**:
  - Replace ElevenLabs audio file generation with real-time WebSocket connection to `wss://agents.assemblyai.com/v1/ws`.
  - Secure server-side ephemeral token minting via `POST https://agents.assemblyai.com/v1/token`.
  - Browser-to-AssemblyAI full-duplex voice streaming (PCM16 24kHz) with real-time turn detection and user interruption/barge-in.
- **Generic LLM Chat / Summarization → 3-Layer Evidence Grounding Pipeline**:
  - **Layer 1:** Raw Discord messages with message IDs, timestamps, and message jump URLs.
  - **Layer 2:** Structured event extraction (`decision`, `task`, `deadline`, `blocker`, `question`, `mention`, `important_update`) with confidence scores (`confirmed`, `inferred`).
  - **Layer 3:** Personalized relevance matching using deterministic rules (direct mention, replies to user, task assigned to user) and verified context.
- **Multi-Platform Dashboard → Focused Re-entry Dashboard**:
  - Replace the 3-column X/Telegram/ElevenLabs UI with the Project Re-entry Command Center:
    - Connected Discord Guild & Channel selector
    - Real message count & away timestamp display ("486 real messages since 2:14 PM")
    - "X things matter" categorized event cards with direct `[View source]` links to Discord
    - Primary action buttons: `[Catch me up]` and `[Talk to Re-entry]`
    - Live AssemblyAI voice interaction modal / interface with real-time visualizer, transcript, and tool execution status.

### MISSING
*Capabilities required by Project Re-entry that do not exist yet:*
1. **Live Discord Channel Backfill & Ingestion Service**: API to ingest history backwards from a given timestamp or message ID for any accessible channel.
2. **Conversation Event Extraction Engine**: Specialized extractor turning raw messages into discrete, traceable events with confidence levels and source citations.
3. **User Relevance Determination Service**: Computes what matters specifically to the authenticated user based on real conversation interactions.
4. **AssemblyAI Ephemeral Token API Route**: `/api/voice/token` server endpoint that securely requests a short-lived token from AssemblyAI without exposing the API key to the client.
5. **AssemblyAI Voice Agent Session Controller**:
   - Web client AudioWorklet / AudioContext PCM streamer (24kHz input, 24kHz output).
   - WebSocket event handler implementing the official protocol (`session.update`, `input.audio`, `reply.audio`, `reply.done`, `tool.call`, `tool.result`).
   - Implementation of required voice tools:
     - `get_catchup_context`
     - `search_conversation`
     - `get_source`
     - `create_task`
6. **Real Task Backend**: SQLite-backed persistent task management service with title, description, due date, assignee, and source Discord message reference.
7. **Automated Test Suite**: Unit & integration tests for Discord ingestion, event extraction, relevance filters, voice tool execution, and source grounding.

---

## 4. Feature Survival Matrix

| Existing Feature | Status | Justification |
| :--- | :--- | :--- |
| Discord Message Logger | **MODIFY** | Kept and enriched with guild ID, channel name, source URLs, and batch fetch backfilling. |
| Discord `/catchup` Slash Command | **MODIFY** | Can remain as a Discord-side entry point, but must present grounded events and source links rather than ungrounded ElevenLabs audio files. |
| Discord `/daily` Slash Command | **REMOVE** | Daily minutes cron is outside the scope of returning to a high-volume conversation. |
| Telegram Bot & Commands | **REMOVE** | Multi-platform out of scope. |
| X (Twitter) Scraper & Bot | **REMOVE** | Multi-platform out of scope. |
| Voice Note Translation | **REMOVE** | Translation layer is out of scope. |
| PDF Document Parsing | **REMOVE** | PDF ingestion is out of scope. |
| ElevenLabs Audio Generation | **REMOVE** | Replaced by real AssemblyAI Voice Agent API. |
| Persona Selector (Roast/Story/Fun) | **REMOVE** | Replaced by strict grounded system prompt focused on what changed, what matters, and what to do next. |
| X Intelligence & Watchlists | **REMOVE** | Conflicting product concept. |
| Google & Twitter Auth | **REMOVE** | Replaced with Discord OAuth as the sole identity provider. |
| SQLite Storage Engine | **KEEP** | Perfect fit for local persistent storage of raw messages, events, relevance links, and real tasks. |
| Next.js Web App | **KEEP/MODIFY** | Rebuilt into the focused Project Re-entry Command Center. |

---

## 5. Security & Secret Exposure Audit

1. **Current Secret Handling**:
   - `.env.example` contained legacy mock/free API keys for Xiaomi MiMo.
   - Root `src/core/config.ts` crashed if `ELEVENLABS_API_KEY` was absent.
   - Client-side Next.js code did not leak keys directly, but `web/` lacked clean environment isolation.
2. **Required Security Controls**:
   - `ASSEMBLYAI_API_KEY` must remain strictly server-side.
   - Ephemeral tokens (`POST https://agents.assemblyai.com/v1/token`) with short expiry for client WebSocket sessions.
   - Discord bot tokens and OAuth client secrets restricted to server environment.
   - Server-side authorization verification ensuring users only access Discord channels they have rights to view.
   - Input sanitization on all voice tool calls (`search_conversation`, `create_task`).

---

## 6. Recommended Phased Implementation Roadmap

1. **Phase 1: Architecture Alignment & Housekeeping**
   - Clean up obsolete platforms (X, Telegram), unneeded dependencies, and dead code.
   - Upgrade database schema for raw messages, conversation events, user relevance, and tasks.
2. **Phase 2: Live Discord Connection & Ingestion**
   - Real Discord bot gateway listener and channel message backfiller.
   - Storage of rich message metadata including permanent Discord jump URLs.
3. **Phase 3: Context & Event Extraction (Layer 2)**
   - Extract decisions, tasks, deadlines, blockers, questions, mentions, and updates with confidence tags (`confirmed`, `inferred`).
4. **Phase 4: User Relevance Layer (Layer 3)**
   - Grounded relevance scoring linking events to user identities.
5. **Phase 5: Re-entry Command Center UI**
   - Responsive, high-aesthetic web interface showing connected Discord channel, real unread counts, away duration, grounded event list with source verification.
6. **Phase 6: Real AssemblyAI Voice Agent Integration**
   - Secure token minting route.
   - Web Audio PCM streaming pipeline (microphone in, speaker out) with turn-taking and barge-in handling.
   - Voice agent tool execution (`get_catchup_context`, `search_conversation`, `get_source`, `create_task`).
7. **Phase 7: Real Task Execution Backend**
   - Persistence and retrieval of real tasks created conversationally or via UI.
8. **Phase 8: Comprehensive Test Suite & Production Hardening**
   - Automated tests for all core layers and integration boundaries.
   - End-to-end demo verification with live Discord data.
