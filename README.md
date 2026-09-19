<div align="center">

# ⚡ Project Re-entry

### Evidence-Grounded, Voice-Native Discord Conversation Re-entry Agent

*«You don't need another summary. You need to know what happened while you were gone.»*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org)
[![AssemblyAI](https://img.shields.io/badge/AssemblyAI-Voice_Agent_API-blueviolet.svg)](https://www.assemblyai.com)

</div>

---

## 🎯 The Thesis

High-volume Discord conversations move too fast. When you return after hours or days away, generic summaries fail to tell you what matters:
- What decisions were actually made?
- What tasks were assigned to you?
- Where were you directly mentioned?
- What blockers prevent your team from moving forward?
- Where is the proof?

**Project Re-entry** reconstructs the exact context you need to re-enter the conversation. It extracts discrete, verifiable conversation events, computes what matters specifically to you, and allows you to converse naturally with an **AssemblyAI Voice Agent** capable of real-time interruption and deep source verification.

Every single factual claim is traceable to an authentic Discord message permalink.

---

## ✨ Key Capabilities

1. **Layer 1: Real-time Discord Ingestion & Historical Backfill**
   - Ingests real messages directly from the Discord Gateway API.
   - Captures author names, avatars, timestamps, reply references, thread IDs, attachments, and permalinks (`https://discord.com/channels/{guild}/{channel}/{msg}`).
   - Backfills conversation history across any accessible channel on demand.

2. **Layer 2: Grounded Conversation Event Extraction**
   - Automatically identifies:
     - `decision`: Product agreements and architecture decisions.
     - `task`: Action items assigned or claimed.
     - `deadline`: Deliverable commitments and milestones.
     - `blocker`: Critical impediments and errors.
     - `question`: Inquiries awaiting team response.
     - `mention`: Direct user pings (`<@userId>`).
     - `important_update`: Key announcements and state changes.
   - Strictly labels confidence: `CONFIRMED` or `INFERRED`.
   - Never hallucinates facts; every event links to a verified message ID.

3. **Layer 3: Personalized User Relevance**
   - Calculates priority for the authenticated user based on real interactions:
     - Direct mentions (1.0)
     - Assigned tasks (0.95)
     - Replies to user messages (0.90)
     - Contextual blockers and decisions (0.75 - 0.80)

4. **AssemblyAI Voice Agent API (Full-Duplex Voice)**
   - Single-connection WebSocket (`wss://agents.assemblyai.com/v1/ws`) for 24 kHz PCM speech input, reasoning, and speech output.
   - **Barge-in / Natural Interruption**: Interrupt the agent mid-speech (*"Wait, which one affects me?"*); the agent stops and responds immediately.
   - **Zero Secret Leakage**: Browser connects using an ephemeral single-use token minted server-side via `POST /api/voice/token`.

5. **Voice Tools with Evidence Grounding**
   - `get_catchup_context`: Delivers current channel briefing.
   - `search_conversation`: Searches stored Discord messages.
   - `get_source`: Retrieves exact original Discord message and jump URL.
   - `create_task`: Task integration boundary (fails honestly if no task backend is connected).

6. **Clean Command Center UI (Next.js 14)**
   - Displays real connected Discord community and channel.
   - Live activity metrics: `486 real messages since 2:14 PM`.
   - Categorized "X things matter" cards with one-click **`[ View source ]`** links.
   - Interactive voice briefing modal with real-time waveform, transcript, and tool execution status.

---

## 🏗️ Architecture

```
                    REAL DISCORD
                         │
                         ▼
              Discord Ingestion Service
             (Gateway Events & Backfill)
                         │
                         ▼
               Layer 1: Raw Messages
              (SQLite: discord_messages)
                         │
                         ▼
            Layer 2: Conversation Events
            (SQLite: conversation_events)
                         │
                         ▼
              Layer 3: User Relevance
              (SQLite: user_relevance)
                         │
                         ▼
             Catch-up Context Engine
                         │
                         ▼
              AssemblyAI Voice Agent
             (WebSocket: PCM16 24kHz)
                         │
               ┌─────────┼──────────┐
               ▼         ▼          ▼
           Search      Source      Action
           Tool        Tool        Tool
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** 20+
- **Discord Bot Token & Client ID** ([Discord Developer Portal](https://discord.com/developers/applications))
- **AssemblyAI API Key** ([AssemblyAI Dashboard](https://www.assemblyai.com))

### 2. Installation
```bash
git clone https://github.com/0xaje/ReEntry.git
cd ReEntry
npm install
npm install --prefix web
```

### 3. Configure Environment
```bash
cp .env.example .env
```
Fill in:
```env
DISCORD_TOKEN=your-discord-bot-token
DISCORD_CLIENT_ID=your-discord-client-id
DISCORD_CLIENT_SECRET=your-discord-client-secret
ASSEMBLYAI_API_KEY=your-assemblyai-api-key
AUTH_SECRET=your-random-nextauth-secret
```

### 4. Run the Application

**Option A — Run Both Together in One Command:**
```bash
npm run dev:all
```
*(or `npm run all:dev`)* — Runs both the Discord Bot (`[BOT]`) and Next.js Web App (`[WEB]`) simultaneously with colored logs and clean Ctrl+C shutdown.

**Option B — Run in Separate Terminals:**

**Terminal 1 — Discord Bot & Voice Integration:**
```bash
npm run dev:bot
```

**Terminal 2 — Web Dashboard & Voice UI:**
```bash
npm run dev:web
```
Open `http://localhost:3000` in your browser.

---

## 🧪 Automated Testing

Project Re-entry includes **44 automated tests** across 7 test suites covering all integration boundaries:
```bash
npm test
```
- Message persistence & query engine
- Event extraction with confidence ratings
- User relevance scoring & catch-up context
- Discord Voice Channel (`/reentry-voice`) & Audio DSP
- Real Task Backends (GitHub Issues & Linear)
- Daily Digest Webhook & Morning DM (`/reentry-digest`)
- Voice Agent tools & failure handling

---

## 📚 Documentation

- [`docs/REENTRY_AUDIT.md`](docs/REENTRY_AUDIT.md) — Comprehensive repository audit from Pulse to Re-entry.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 3-Layer Evidence Grounding & Voice Agent architecture.
- [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) — Discord API, AssemblyAI WebSocket, and OAuth setup.
- [`docs/DEMO.md`](docs/DEMO.md) — Step-by-step golden path demonstration guide.

---

## 📄 License

MIT
