"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Mic, MicOff, Volume2, X, AlertCircle, Sparkles, Terminal, Link as LinkIcon, Radio } from "lucide-react";

interface VoiceAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  channelName: string;
  guildName: string;
  userName?: string;
  discordId?: string;
}

interface TranscriptEntry {
  sender: "user" | "agent" | "system" | "tool";
  text: string;
  timestamp: string;
  sourceUrl?: string;
}

export default function VoiceAgentModal({
  isOpen,
  onClose,
  channelId,
  channelName,
  guildName,
  userName,
  discordId,
}: VoiceAgentModalProps) {
  const [status, setStatus] = useState<"connecting" | "ready" | "speaking" | "listening" | "interrupted" | "error" | "closed">("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [currentToolAction, setCurrentToolAction] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const nextPlayTimeRef = useRef(0);

  // Stop all audio playback immediately (Barge-in / Interruption)
  const stopAudioPlayback = useCallback(() => {
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    if (audioContextRef.current) {
      nextPlayTimeRef.current = audioContextRef.current.currentTime;
    }
    setStatus("interrupted");
  }, []);

  // Play queued PCM16 chunks
  const playPcmChunk = useCallback((pcmData: Float32Array, sampleRate = 24000) => {
    if (!audioContextRef.current) return;
    const ctx = audioContextRef.current;

    const buffer = ctx.createBuffer(1, pcmData.length, sampleRate);
    buffer.getChannelData(0).set(pcmData);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now, nextPlayTimeRef.current);
    source.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;
    isPlayingRef.current = true;
    setStatus("speaking");

    source.onended = () => {
      if (ctx.currentTime >= nextPlayTimeRef.current - 0.05) {
        isPlayingRef.current = false;
        setStatus("listening");
      }
    };
  }, []);

  // Convert Base64 PCM16 string to Float32Array for AudioContext
  const decodeBase64Pcm16 = useCallback((base64: string): Float32Array => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }
    return float32;
  }, []);

  // Start Voice Session
  const startSession = useCallback(async () => {
    try {
      setStatus("connecting");
      setErrorMessage(null);
      setTranscripts([
        {
          sender: "system",
          text: `Requesting secure ephemeral token for AssemblyAI Voice Agent...`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);

      // 1. Request temporary token from server endpoint
      const tokenRes = await fetch("/api/voice/token", { method: "POST" });
      if (!tokenRes.ok) {
        const errJson = await tokenRes.json().catch(() => ({}));
        throw new Error(errJson.error || `Voice token error (${tokenRes.status})`);
      }
      const tokenData = await tokenRes.json();
      const wsUrl = tokenData.wsUrl;

      // 2. Initialize AudioContext (24kHz preferred for AssemblyAI Voice Agent)
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass({ sampleRate: 24000 });
      audioContextRef.current = audioCtx;
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      // 3. Open WebSocket to AssemblyAI
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setTranscripts((prev) => [
          ...prev,
          {
            sender: "system",
            text: `Connected to AssemblyAI Voice Agent. Initializing re-entry prompt for #${channelName}...`,
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);

        // Send session.update with system prompt and tools
        const sessionUpdate = {
          type: "session.update",
          session: {
            instructions: `You are a conversation re-entry agent for Discord channel #${channelName} in ${guildName}.
The user speaking with you is ${userName || "the returning team member"}.
Your job is to help the user understand what happened in this Discord conversation while they were away and help them re-enter the conversation with confidence.

Do not simply summarize everything.
Prioritize:
1. What changed.
2. What matters to this user.
3. What requires the user's attention.
4. What action may be needed.

BEHAVIORAL PRINCIPLES:
- Every important factual statement must be grounded in retrieved Discord conversation evidence.
- Never invent facts. Never invent decisions, deadlines, tasks, people, assignments, or outcomes.
- Distinguish confirmed information from inference. If something is inferred, clearly state it.
- If evidence is insufficient, say that you cannot verify it.
- When the user asks "why", "who", "where", or "show me the message", use the get_source or search_conversation tools.
- Keep spoken responses concise and natural (typically 2-4 sentences).
- The user may interrupt you naturally at any time.
- When the user requests an action, use the create_task tool.
- If an action cannot be executed, clearly tell the user that it was not completed.`,
            tools: [
              {
                type: "function",
                name: "get_catchup_context",
                description: "Retrieve the personalized catch-up context for this Discord channel.",
                parameters: {
                  type: "object",
                  properties: {
                    channel_id: { type: "string" },
                  },
                  required: ["channel_id"],
                },
              },
              {
                type: "function",
                name: "search_conversation",
                description: "Search actual stored Discord messages and conversation events.",
                parameters: {
                  type: "object",
                  properties: {
                    query: { type: "string" },
                    channel_id: { type: "string" },
                  },
                  required: ["query", "channel_id"],
                },
              },
              {
                type: "function",
                name: "get_source",
                description: "Retrieve the original Discord message evidence for a message ID.",
                parameters: {
                  type: "object",
                  properties: {
                    message_id: { type: "string" },
                  },
                  required: ["message_id"],
                },
              },
              {
                type: "function",
                name: "create_task",
                description: "Create a task or action item.",
                parameters: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    due_date: { type: "string" },
                  },
                  required: ["title"],
                },
              },
            ],
          },
        };

        ws.send(JSON.stringify(sessionUpdate));
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case "session.ready":
              setStatus("ready");
              setTranscripts((prev) => [
                ...prev,
                {
                  sender: "system",
                  text: `Agent ready. Say "Catch me up" to begin.`,
                  timestamp: new Date().toLocaleTimeString(),
                },
              ]);
              break;

            case "reply.audio":
              if (msg.data) {
                const pcm = decodeBase64Pcm16(msg.data);
                playPcmChunk(pcm);
              }
              break;

            case "reply.done":
              if (msg.status === "interrupted") {
                stopAudioPlayback();
                setTranscripts((prev) => [
                  ...prev,
                  {
                    sender: "system",
                    text: `[Interrupted by user]`,
                    timestamp: new Date().toLocaleTimeString(),
                  },
                ]);
              } else {
                setStatus("listening");
              }
              break;

            case "transcript":
            case "agent.transcript":
              if (msg.text) {
                setTranscripts((prev) => [
                  ...prev,
                  {
                    sender: "agent",
                    text: msg.text,
                    timestamp: new Date().toLocaleTimeString(),
                  },
                ]);
              }
              break;

            case "user.transcript":
              if (msg.text) {
                setTranscripts((prev) => [
                  ...prev,
                  {
                    sender: "user",
                    text: msg.text,
                    timestamp: new Date().toLocaleTimeString(),
                  },
                ]);
              }
              break;

            case "tool.call": {
              // Server-side tool execution
              const toolName = msg.name;
              const callId = msg.call_id;
              const args = msg.arguments || {};

              setCurrentToolAction(`Executing: ${toolName}...`);

              const toolRes = await fetch("/api/voice/tool", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  toolName,
                  args: { ...args, channel_id: args.channel_id || channelId },
                  channelId,
                  channelName,
                  userId: userName || "user",
                  discordId,
                }),
              });

              const toolResultData = await toolRes.json();
              setCurrentToolAction(null);

              setTranscripts((prev) => [
                ...prev,
                {
                  sender: "tool",
                  text: `Tool [${toolName}] -> ${JSON.stringify(toolResultData).slice(0, 180)}...`,
                  timestamp: new Date().toLocaleTimeString(),
                  sourceUrl: toolResultData?.source_url || toolResultData?.results?.[0]?.source_url,
                },
              ]);

              // Send tool.result back to AssemblyAI
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: "tool.result",
                    call_id: callId,
                    result: JSON.stringify(toolResultData),
                  })
                );
              }
              break;
            }

            case "error":
              console.error("AssemblyAI agent error:", msg);
              setErrorMessage(msg.message || "An error occurred with the voice agent.");
              setStatus("error");
              break;
          }
        } catch (parseErr) {
          console.error("Failed to parse WebSocket message:", parseErr);
        }
      };

      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        setErrorMessage("WebSocket connection to AssemblyAI failed. Please check network and API credentials.");
        setStatus("error");
      };

      ws.onclose = () => {
        setStatus("closed");
      };

      // 4. Request Microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 24000,
        },
      });
      mediaStreamRef.current = stream;

      // 5. Stream Microphone PCM16 to WebSocket
      const micSource = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorNodeRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (isMuted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const inputChannel = e.inputBuffer.getChannelData(0);
        // Convert Float32 to Int16 PCM
        const pcm16 = new Int16Array(inputChannel.length);
        for (let i = 0; i < inputChannel.length; i++) {
          const s = Math.max(-1, Math.min(1, inputChannel[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Convert to Base64
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Audio = btoa(binary);

        wsRef.current.send(
          JSON.stringify({
            type: "input.audio",
            audio: base64Audio,
          })
        );
      };

      micSource.connect(processor);
      processor.connect(audioCtx.destination);
    } catch (err: any) {
      console.error("Failed to start voice session:", err);
      setErrorMessage(err.message || "Failed to initialize voice session.");
      setStatus("error");
    }
  }, [channelId, channelName, guildName, userName, discordId, isMuted, playPcmChunk, decodeBase64Pcm16, stopAudioPlayback]);

  // Cleanup on close or unmount
  const cleanup = useCallback(() => {
    if (processorNodeRef.current) {
      processorNodeRef.current.disconnect();
      processorNodeRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      startSession();
    } else {
      cleanup();
    }
    return () => cleanup();
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-md">
      <div className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="font-semibold text-zinc-100 flex items-center gap-2 text-sm sm:text-base">
                AssemblyAI Voice Agent • #{channelName}
              </h3>
              <p className="text-xs text-zinc-400">Real-time conversational briefing</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5 ${
                status === "speaking"
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : status === "listening"
                  ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                  : status === "interrupted"
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  : status === "error"
                  ? "bg-red-500/10 text-red-400 border border-red-500/20"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  status === "speaking"
                    ? "bg-emerald-400 animate-ping"
                    : status === "listening"
                    ? "bg-indigo-400 animate-pulse"
                    : status === "interrupted"
                    ? "bg-amber-400"
                    : status === "error"
                    ? "bg-red-400"
                    : "bg-zinc-500"
                }`}
              />
              {status.toUpperCase()}
            </span>
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div className="px-6 py-3 bg-red-950/50 border-b border-red-900/50 flex items-start gap-3 text-red-200 text-xs sm:text-sm">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Voice Agent Error</p>
              <p className="text-red-300/90">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Tool Execution Banner */}
        {currentToolAction && (
          <div className="px-6 py-2.5 bg-indigo-950/40 border-b border-indigo-900/40 flex items-center gap-2.5 text-indigo-200 text-xs font-mono">
            <Sparkles className="w-4 h-4 text-indigo-400 animate-spin" />
            <span>{currentToolAction}</span>
          </div>
        )}

        {/* Live Conversation Transcript */}
        <div className="flex-1 p-6 overflow-y-auto space-y-3 custom-scrollbar min-h-[260px] text-sm">
          {transcripts.map((entry, idx) => (
            <div
              key={idx}
              className={`flex flex-col ${
                entry.sender === "user"
                  ? "items-end"
                  : entry.sender === "tool"
                  ? "items-center"
                  : "items-start"
              }`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                  entry.sender === "user"
                    ? "bg-indigo-600 text-white"
                    : entry.sender === "tool"
                    ? "bg-zinc-950 border border-zinc-800 text-zinc-400 font-mono text-xs w-full"
                    : entry.sender === "system"
                    ? "bg-zinc-800/40 text-zinc-400 text-xs italic border border-zinc-800/60"
                    : "bg-zinc-800/90 text-zinc-100 border border-zinc-700/60"
                }`}
              >
                <div className="flex items-center justify-between gap-4 mb-1">
                  <span className="text-[10px] font-semibold tracking-wider uppercase opacity-75">
                    {entry.sender === "user" ? "You" : entry.sender === "agent" ? "Re-entry Voice" : entry.sender}
                  </span>
                  <span className="text-[10px] opacity-50">{entry.timestamp}</span>
                </div>
                <p className="leading-relaxed whitespace-pre-wrap">{entry.text}</p>
                {entry.sourceUrl && (
                  <a
                    href={entry.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-400 hover:underline"
                  >
                    <LinkIcon className="w-3 h-3" />
                    Verify Source on Discord
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Visualizer & Controls Footer */}
        <div className="p-6 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className={`p-3 rounded-full transition-all ${
                isMuted
                  ? "bg-red-500/10 text-red-400 border border-red-500/20"
                  : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
              }`}
              title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            <button
              onClick={stopAudioPlayback}
              className="px-3.5 py-2 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors border border-zinc-700"
            >
              Barge-in / Interrupt
            </button>
          </div>

          <div className="text-right">
            <p className="text-xs text-zinc-400">Speak naturally into your mic</p>
            <p className="text-[11px] text-zinc-500">Ask: &quot;Why?&quot; • &quot;Who decided that?&quot; • &quot;Show me the message&quot;</p>
          </div>
        </div>
      </div>
    </div>
  );
}
