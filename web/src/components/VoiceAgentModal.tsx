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
  const isSessionReadyRef = useRef(false);
  const [isAudioSuspended, setIsAudioSuspended] = useState(false);

  // Resume audio context on any user interaction
  const resumeAudio = useCallback(async () => {
    if (audioContextRef.current && audioContextRef.current.state === "suspended") {
      try {
        await audioContextRef.current.resume();
        setIsAudioSuspended(false);
      } catch (e) {
        console.error("Failed to resume AudioContext:", e);
      }
    }
  }, []);

  // Resample float32 buffer to 24000 Hz for AssemblyAI
  const resampleTo24k = useCallback((input: Float32Array, fromRate: number): Float32Array => {
    if (fromRate === 24000) return input;
    const ratio = 24000 / fromRate;
    const outLength = Math.round(input.length * ratio);
    const output = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const origIndex = i / ratio;
      const i0 = Math.floor(origIndex);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const alpha = origIndex - i0;
      output[i] = input[i0] * (1 - alpha) + input[i1] * alpha;
    }
    return output;
  }, []);

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

    if (ctx.state === "suspended") {
      ctx.resume().then(() => setIsAudioSuspended(false)).catch(console.error);
    }

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

  // Convert Base64 PCM16 string to Float32Array for AudioContext (Endian-safe)
  const decodeBase64Pcm16 = useCallback((base64: string): Float32Array => {
    const binary = atob(base64);
    const len = Math.floor(binary.length / 2);
    const float32 = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const low = binary.charCodeAt(i * 2);
      const high = binary.charCodeAt(i * 2 + 1);
      let int16 = (high << 8) | low;
      if (int16 >= 32768) int16 -= 65536;
      float32[i] = int16 / 32768.0;
    }
    return float32;
  }, []);

  // Start Voice Session
  const startSession = useCallback(async () => {
    try {
      setStatus("connecting");
      setErrorMessage(null);
      isSessionReadyRef.current = false;

      // 1. Initialize AudioContext immediately while user interaction event is live
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = audioContextRef.current || new AudioContextClass();
      audioContextRef.current = audioCtx;

      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => setIsAudioSuspended(true));
      }

      setTranscripts([
        {
          sender: "system",
          text: `Requesting secure ephemeral token for AssemblyAI Voice Agent...`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);

      // 2. Request temporary token from server endpoint
      const tokenRes = await fetch("/api/voice/token", { method: "POST" });
      if (!tokenRes.ok) {
        const errJson = await tokenRes.json().catch(() => ({}));
        throw new Error(errJson.error || `Voice token error (${tokenRes.status})`);
      }
      const tokenData = await tokenRes.json();
      const wsUrl = tokenData.wsUrl;

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

        // Send session.update with system prompt, greeting, and tools
        const sessionUpdate = {
          type: "session.update",
          session: {
            system_prompt: `You are a conversation re-entry agent for Discord channel #${channelName} in ${guildName}.
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
            greeting: `Hello ${userName || "there"}! I am your Project Re-entry assistant for #${channelName}. What would you like to catch up on?`,
            output: {
              voice: "ivy",
            },
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
              isSessionReadyRef.current = true;
              setStatus("ready");
              setTranscripts((prev) => [
                ...prev,
                {
                  sender: "system",
                  text: `Agent connected & ready. Speak into your mic or ask "Catch me up".`,
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

            case "transcript.agent":
            case "agent.transcript":
            case "transcript":
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

            case "transcript.user":
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
              let args = msg.arguments || {};
              if (typeof args === "string") {
                try {
                  args = JSON.parse(args);
                } catch {
                  args = {};
                }
              }

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

      // 4. Request Microphone stream with safe standard constraints
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      // 5. Stream Microphone PCM16 to WebSocket
      const micSource = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorNodeRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (isMuted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !isSessionReadyRef.current) return;

        const inputChannel = e.inputBuffer.getChannelData(0);
        // Resample hardware sample rate to 24000 Hz
        const resampled = resampleTo24k(inputChannel, audioCtx.sampleRate);

        // Convert Float32 to Int16 PCM
        const pcm16 = new Int16Array(resampled.length);
        for (let i = 0; i < resampled.length; i++) {
          const s = Math.max(-1, Math.min(1, resampled[i]));
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

      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      micSource.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);
    } catch (err: any) {
      console.error("Failed to start voice session:", err);
      setErrorMessage(err.message || "Failed to initialize voice session.");
      setStatus("error");
    }
  }, [channelId, channelName, guildName, userName, discordId, isMuted, playPcmChunk, decodeBase64Pcm16, stopAudioPlayback, resampleTo24k]);

  // Cleanup on close or unmount
  const cleanup = useCallback(() => {
    isSessionReadyRef.current = false;
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
  }, [isOpen, startSession, cleanup]);

  if (!isOpen) return null;

  return (
    <div
      onClick={resumeAudio}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(1,10,30,0.85)] backdrop-blur-md"
    >
      <div className="relative w-full max-w-2xl bg-[#041a4a] border border-[rgba(204,226,255,0.29)] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* HUD Corner Brackets */}
        <span className="panel-corner panel-corner--tl" />
        <span className="panel-corner panel-corner--tr" />
        <span className="panel-corner panel-corner--bl" />
        <span className="panel-corner panel-corner--br" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-[rgba(204,226,255,0.25)] bg-[#092c73]">
          <div className="flex items-center gap-3">
            <div className="p-2 border border-[rgba(204,226,255,0.29)] bg-[rgba(4,28,79,0.42)]">
              <Radio className="w-4 h-4 text-[#79edbe] animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-white text-xs sm:text-sm font-mono tracking-wider uppercase">
                ASSEMBLYAI VOICE AGENT • #{channelName}
              </h3>
              <p className="text-[10px] text-[#8eaee1] font-mono">REAL-TIME CONVERSATIONAL TELEMETRY</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`status-chip ${
                status === "interrupted"
                  ? "status-chip--warn"
                  : status === "error"
                  ? "status-chip--danger"
                  : ""
              }`}
            >
              <span
                className={`status-dot ${
                  status === "speaking"
                    ? "animate-ping"
                    : status === "listening"
                    ? "animate-pulse"
                    : ""
                }`}
              />
              <span>{status.toUpperCase()}</span>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-[#8eaee1] hover:text-white hover:bg-[rgba(204,226,255,0.1)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Audio Suspended Banner */}
        {isAudioSuspended && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              resumeAudio();
            }}
            className="w-full px-6 py-2.5 bg-[rgba(85,45,8,0.45)] border-b border-[rgba(255,196,125,0.45)] flex items-center justify-between text-[#ffc47d] text-xs font-mono hover:bg-[rgba(85,45,8,0.6)] transition-colors"
          >
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-[#ffc47d] animate-bounce" />
              <span>Browser audio suspended. Click here to enable audio output.</span>
            </div>
            <span className="font-bold underline uppercase tracking-wider text-[10px]">Enable Audio</span>
          </button>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <div className="px-6 py-3 bg-[rgba(255,107,107,0.15)] border-b border-[#ff6b6b] flex items-start gap-3 text-[#ff8e7d] text-xs font-mono">
            <AlertCircle className="w-4 h-4 text-[#ff8e7d] shrink-0 mt-0.5" />
            <div>
              <p className="font-bold uppercase">Voice Agent Error</p>
              <p className="text-[#ff8e7d]/90 mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Tool Execution Banner */}
        {currentToolAction && (
          <div className="px-6 py-2 bg-[#020c24] border-b border-[rgba(204,226,255,0.2)] flex items-center gap-2.5 text-[#79edbe] text-xs font-mono">
            <Sparkles className="w-3.5 h-3.5 text-[#79edbe] animate-spin" />
            <span>{currentToolAction}</span>
          </div>
        )}

        {/* Live Conversation Transcript */}
        <div className="flex-1 p-6 overflow-y-auto space-y-3 custom-scrollbar min-h-[280px] bg-[rgba(4,28,79,0.3)] text-xs font-sans">
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
                className={`max-w-[85%] p-3.5 ${
                  entry.sender === "user"
                    ? "bg-[rgba(8,46,117,0.85)] border border-[rgba(204,226,255,0.3)] text-white shadow-md"
                    : entry.sender === "tool"
                    ? "bg-[#010818] border border-[rgba(204,226,255,0.18)] text-[#8eaee1] font-mono text-[11px] w-full"
                    : entry.sender === "system"
                    ? "bg-[rgba(4,28,79,0.4)] text-[#8eaee1] text-[11px] font-mono italic border border-[rgba(204,226,255,0.15)]"
                    : "bg-[#020c24] text-[#f4f8ff] border border-[rgba(121,237,190,0.35)] shadow-md"
                }`}
              >
                <div className="flex items-center justify-between gap-4 mb-1">
                  <span className="text-[9px] font-mono font-bold tracking-wider uppercase text-[#79edbe]">
                    {entry.sender === "user" ? "YOU" : entry.sender === "agent" ? "RE-ENTRY AGENT" : entry.sender.toUpperCase()}
                  </span>
                  <span className="text-[9px] font-mono text-[#6e8bc2]">{entry.timestamp}</span>
                </div>
                <p className="leading-relaxed whitespace-pre-wrap">{entry.text}</p>
                {entry.sourceUrl && (
                  <a
                    href={entry.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-mono text-[#79edbe] hover:underline"
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
        <div className="p-4 sm:p-5 border-t border-[rgba(204,226,255,0.25)] bg-[#092c73] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className={`p-2.5 border transition-all ${
                isMuted
                  ? "bg-[rgba(255,107,107,0.2)] text-[#ff8e7d] border-[#ff6b6b]"
                  : "bg-[rgba(4,28,79,0.42)] text-white border-[rgba(204,226,255,0.29)] hover:bg-[rgba(22,69,143,0.7)]"
              }`}
              title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
            >
              {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-[#79edbe]" />}
            </button>
            <button
              onClick={stopAudioPlayback}
              className="btn-outline text-[10px] py-2 px-3 border-[#ff6b6b] text-[#ff8e7d] hover:bg-[rgba(255,107,107,0.2)]"
            >
              Barge-in / Interrupt
            </button>
          </div>

          <div className="text-right font-mono">
            <p className="text-[10px] text-white uppercase tracking-wider">Speak into microphone</p>
            <p className="text-[9px] text-[#8eaee1]">Ask: &quot;Why?&quot; • &quot;Who decided that?&quot; • &quot;Show source&quot;</p>
          </div>
        </div>
      </div>
    </div>
  );
}
