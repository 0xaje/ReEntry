# Project Re-entry: Integrations Guide

## 1. Discord Integration

### Gateway Bot Setup
Project Re-entry connects to Discord via a Discord Application Bot running `discord.js` v14.

**Required Gateway Intents**:
- `GatewayIntentBits.Guilds` — To enumerate servers and channels.
- `GatewayIntentBits.GuildMessages` — To receive live channel messages.
- `GatewayIntentBits.MessageContent` — **Privileged Intent**. Must be enabled in the Discord Developer Portal under Bot > Privileged Gateway Intents.

**Bot Permissions Required**:
- Read Messages / View Channels (`0x400`)
- Read Message History (`0x10000`)
- Send Messages (`0x800`)
- Embed Links (`0x4000`)
- Use Application Commands (`0x80000000`)

**OAuth2 Bot Invite URL**:
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=274877991936&scope=bot%20applications.commands
```

### Discord OAuth for Web
The web frontend authenticates users via Discord OAuth to determine their Discord user snowflake and channel memberships.
- **Provider**: NextAuth Discord Provider (`web/src/auth.ts`).
- **Scopes**: `identify email guilds`.
- **Callback URL**: `http://localhost:3000/api/auth/callback/discord` (or your production domain).

---

## 2. AssemblyAI Voice Agent Integration

Project Re-entry uses the real **AssemblyAI Voice Agent API** for interactive spoken briefings.

### Ephemeral Token Endpoint
- **URL**: `POST https://agents.assemblyai.com/v1/token`
- **Headers**:
  ```http
  Authorization: YOUR_ASSEMBLYAI_API_KEY
  Content-Type: application/json
  ```
- **Body**:
  ```json
  {
    "expires_in_seconds": 3600
  }
  ```
- **Response**:
  ```json
  {
    "token": "..."
  }
  ```

### WebSocket Protocol
- **Endpoint**: `wss://agents.assemblyai.com/v1/ws?token=TOKEN`
- **Audio Encoding**: PCM 16-bit mono 24 kHz.
- **Client to Server**:
  - `session.update`: Configures system instructions and tools.
  - `input.audio`: Streams microphone PCM chunks encoded as Base64:
    ```json
    { "type": "input.audio", "audio": "BASE64_PCM16" }
    ```
- **Server to Client**:
  - `session.ready`: Session established and ready for voice input.
  - `reply.audio`: Spoken audio chunks:
    ```json
    { "type": "reply.audio", "data": "BASE64_PCM16" }
    ```
  - `reply.done`: Agent finished speaking. Includes `status: "interrupted"` if barge-in occurred.
  - `tool.call`: Agent requests tool execution:
    ```json
    { "type": "tool.call", "call_id": "call_123", "name": "get_source", "arguments": { "message_id": "..." } }
    ```
  - `tool.result`: Client returns function result:
    ```json
    { "type": "tool.result", "call_id": "call_123", "result": "..." }
    ```

---

## 3. LLM Configuration (Layer 2 Event Extraction)

For converting raw message transcripts into discrete `conversation_events`:
- Supports OpenAI, Google Gemini, or OpenAI-compatible endpoints (e.g. MiMo, OpenCode).
- Configured via `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL`.
- If no AI key is configured, Project Re-entry falls back to deterministic rule-based event extraction on real messages, ensuring the application remains fully functional offline.

---

## 4. External Task Action Provider (Status: PLANNED)

In compliance with specification Rule 15:
- The `create_task` tool schema is formally defined.
- Runtime execution reports honest unavailability until an external task system (e.g., Linear API, GitHub Issues API, or Todoist) is configured with live credentials.
- The system never pretends that a task was created when the real external operation did not occur.
