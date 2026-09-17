# Project Re-entry: Demonstration & Verification Guide

This guide walks through the end-to-end golden path demonstration for **Project Re-entry** using live Discord activity and the AssemblyAI Voice Agent API.

---

## Prerequisites

1. Create a `.env` file from `.env.example`:
   ```bash
   cp .env.example .env
   ```
2. Set the following environment variables:
   - `DISCORD_TOKEN`: Bot token from Discord Developer Portal.
   - `DISCORD_CLIENT_ID`: Application ID.
   - `ASSEMBLYAI_API_KEY`: AssemblyAI account API key.
   - `AUTH_SECRET`: Random string for NextAuth session encryption (`openssl rand -hex 32`).

---

## Step 1: Start the Core Services

In separate terminal windows:

**Terminal 1 — Discord Ingestion Gateway**:
```bash
npm run dev
```
*Expected log output*:
```
⚡ PROJECT RE-ENTRY — Discord Adapter
✅ Logged in as YourBot#1234
📡 Connected to 1 server(s)
📦 Evidence database initialized at /.../data/reentry.db
```

**Terminal 2 — Re-entry Web Command Center**:
```bash
npm run dev --prefix web
```
*Expected log output*:
```
▲ Next.js 14.2.3
- Local: http://localhost:3000
```

---

## Step 2: Ingest Real Discord Messages

1. In your Discord server (where the bot has been invited and permissions granted), send realistic conversation messages in a designated channel (e.g. `#launch`):
   - **Decision**: *"We decided to push the frontend release to Friday at 3 PM."*
   - **Blocker**: *"CRITICAL BLOCKER: The staging database migration is timing out on AWS."*
   - **Deadline**: *"All QA approvals must be completed by Thursday noon."*
   - **Direct Mention**: *"Hey @YourUsername, can you review the pull request for the API routes?"*
2. Verify in the bot terminal that messages are captured in Layer 1 (`discord_messages`) and extracted into Layer 2 events (`conversation_events`).

---

## Step 3: Open the Re-entry Command Center

1. Navigate to `http://localhost:3000` in your web browser.
2. Sign in with Discord.
3. Verify that the primary screen immediately displays:
   - Connected Discord Community (e.g. `Acme Community`)
   - Channel selector (e.g. `#launch`)
   - Real message count: `[N] real messages since [Timestamp]`
   - Away duration
   - Grounded event cards:
     - `01 — [DECISION] We decided to push the frontend release to Friday`
     - `02 — [BLOCKER] The staging database migration is timing out`
     - `03 — [MENTION] Direct callout from Colleague`
4. Click **`[ View source ]`** on any event card:
   - Confirms that it opens the exact Discord message jump URL: `https://discord.com/channels/{guild_id}/{channel_id}/{message_id}`.

---

## Step 4: Spoken Catch-up Briefing (AssemblyAI Voice Agent)

1. Click **`[ Talk to Re-entry ]`** or **`[ Catch me up ]`**.
2. The Voice Agent Modal opens:
   - Requests microphone permission.
   - Fetches an ephemeral token from `POST /api/voice/token`.
   - Connects to `wss://agents.assemblyai.com/v1/ws`.
   - Status transitions to `LISTENING`.
3. Say aloud: *"Catch me up."*
4. The agent will respond in speech with a grounded briefing:
   *"While you were away from launch, three important things happened. First, the team decided to move the frontend release to Friday at 3 PM. Second, there is an active blocker regarding the staging database migration..."*

---

## Step 5: Natural Interruption (Barge-in)

1. While the agent is speaking, interrupt naturally by speaking into your microphone:
   *"Wait, which one affects me?"*
2. The agent stops immediately (audio playback queue clears via barge-in).
3. The agent responds directly:
   *"You were directly called out by Colleague regarding reviewing the pull request for the API routes."*

---

## Step 6: Evidence & Source Retrieval

1. Ask the agent:
   *"Who made the decision about Friday?"*
2. The agent executes the `search_conversation` or `get_source` tool:
   *"LeadArchitect made that decision in their message at 2:15 PM."*
3. Ask: *"Show me the message."*
4. The agent executes `get_source`:
   - Returns the exact author, channel, and Discord permalink.
   - The verified source link is displayed in the live transcript.

---

## Step 7: Action Tool Execution

1. Request an action:
   *"Create a task to fix the database migration."*
2. The agent executes `create_task`.
3. Because no external task provider (like Linear) is connected, the tool honestly reports:
   *"Task creation is not available: an external task provider has not been connected to this workspace. The task was not created."*
4. The agent honestly informs the user rather than faking success.
