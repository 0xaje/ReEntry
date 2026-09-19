"use client";

import React, { useState } from "react";
import Image from "next/image";
import {
  MessageSquare,
  Volume2,
  Radio,
  ExternalLink,
  Clock,
  CheckCircle2,
  LogOut,
  RefreshCw,
  Sparkles,
  ChevronDown,
  ShieldCheck,
} from "lucide-react";
import { signIn, signOut } from "next-auth/react";
import VoiceAgentModal from "./VoiceAgentModal";
import { markChannelCatchup, setTestAwayTime } from "../app/actions";

interface GroundedEvent {
  id: string;
  type: string;
  title: string;
  summary: string;
  owner?: string | null;
  deadline?: string | null;
  confidence: "CONFIRMED" | "INFERRED" | "UNKNOWN";
  source_message_id: string;
  source_url: string;
  created_at: string;
}

interface RecentMessage {
  id: string;
  author: string;
  avatar?: string | null;
  content: string;
  timestamp: string;
  url: string;
}

interface ReentryDashboardProps {
  session: any;
  initialData?: {
    connected: boolean;
    guild?: { id: string; name: string; icon?: string | null };
    channel?: { id: string; name: string; type: number };
    guilds: { id: string; name: string; icon?: string | null }[];
    channels: { id: string; guild_id: string; name: string; type: number }[];
    missed_messages_count: number;
    total_messages_count: number;
    period_start: string;
    period_end: string;
    important_events: GroundedEvent[];
    recent_messages: RecentMessage[];
    message?: string;
  };
}

export default function ReentryDashboard({ session, initialData }: ReentryDashboardProps) {
  const [data, setData] = useState(initialData);
  const [selectedChannelId, setSelectedChannelId] = useState<string>(
    initialData?.channel?.id || (initialData?.channels?.[0]?.id || "")
  );
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"Connected" | "Syncing" | "Synced" | "Error">(
    initialData?.connected ? "Connected" : "Error"
  );
  const [, setStatusNote] = useState<string | null>(null);

  // Fetch updated channel data when selection changes
  const fetchChannelData = async (channelId: string) => {
    if (!channelId) return;
    setIsLoading(true);
    setSyncStatus("Syncing");
    try {
      const res = await fetch(`/api/catchup?channelId=${channelId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const freshData = await res.json();
      setData(freshData);
      setSyncStatus("Synced");
    } catch (err: any) {
      console.error("Failed to fetch catch-up data:", err);
      setSyncStatus("Error");
      setStatusNote("Failed to synchronize with Discord index.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleChannelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value;
    setSelectedChannelId(newId);
    fetchChannelData(newId);
  };

  const handleMarkCaughtUp = async () => {
    if (!selectedChannelId) return;
    setIsLoading(true);
    await markChannelCatchup(selectedChannelId);
    await fetchChannelData(selectedChannelId);
  };

  const handleSetTestWindow = async (hours: number) => {
    if (!selectedChannelId) return;
    setIsLoading(true);
    await setTestAwayTime(selectedChannelId, hours);
    await fetchChannelData(selectedChannelId);
  };

  // Format away time
  const periodStart = data?.period_start ? new Date(data.period_start) : null;
  const timeFormatted = periodStart
    ? periodStart.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "Unknown";

  const durationAwayHours = periodStart
    ? Math.max(0, Math.round((Date.now() - periodStart.getTime()) / (1000 * 60 * 60)))
    : 0;

  const [isGuestMode, setIsGuestMode] = useState(false);

  // -------------------------
  // LOGGED OUT VIEW (Blueprint Cyber)
  // -------------------------
  if (!session?.user && !isGuestMode) {
    return (
      <main className="min-h-screen relative flex flex-col items-center justify-center p-6 bg-[#08296a] text-[#f4f8ff]">
        <div className="canvas-grid" />
        <div className="panel w-full max-w-md p-8 shadow-2xl z-10">
          <span className="panel-corner panel-corner--tl" />
          <span className="panel-corner panel-corner--br" />
          <span className="panel-corner panel-corner--tr" />
          <span className="panel-corner panel-corner--bl" />

          <div className="section-kicker">
            <span>00 // CONVERSATION INTELLIGENCE</span>
            <span className="section-kicker__line" />
            <span style={{ color: "#79edbe" }}>ONLINE</span>
          </div>

          <div className="py-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 border border-[rgba(204,226,255,0.29)] bg-[rgba(4,28,79,0.42)]">
                <Radio className="w-6 h-6 text-[#79edbe]" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white uppercase font-mono">Project Re-entry</h1>
                <p className="text-xs text-[#b5c8eb]">Evidence-Grounded Discord Intelligence</p>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <h2 className="text-base font-semibold text-white">Return to what matters.</h2>
              <p className="text-xs text-[#b5c8eb] leading-relaxed">
                You don&apos;t need another summary. You need to know what happened while you were gone.
              </p>
            </div>

            <div className="pt-4 space-y-3">
              <button
                onClick={() => signIn("discord")}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                <MessageSquare className="w-4 h-4" />
                Sign in with Discord
              </button>

              <div className="flex items-center gap-3 my-2">
                <div className="flex-1 border-t border-[rgba(204,226,255,0.18)]" />
                <span className="text-[9px] text-[#8eaee1] uppercase tracking-widest font-mono">or test locally</span>
                <div className="flex-1 border-t border-[rgba(204,226,255,0.18)]" />
              </div>

              <button
                onClick={() => setIsGuestMode(true)}
                className="btn-outline w-full flex items-center justify-center gap-2 text-xs"
              >
                Enter Command Center (Local Test Mode)
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // -------------------------
  // LOGGED IN COMMAND CENTER (Blueprint Cyber)
  // -------------------------
  return (
    <div className="min-h-screen bg-[#08296a] text-[#f4f8ff] flex flex-col font-sans relative">
      <div className="canvas-grid" />

      {/* Top Navigation Bar */}
      <header className="topbar">
        <div className="flex items-center gap-3">
          <div className="p-2 border border-[rgba(204,226,255,0.29)] bg-[rgba(4,28,79,0.42)]">
            <Radio className="w-5 h-5 text-[#79edbe] animate-pulse" />
          </div>
          <div>
            <div className="brand-title">PROJECT RE-ENTRY</div>
            <div className="brand-subtitle">DISCORD CONVERSATION INTELLIGENCE</div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="status-chip">
            <span className="status-dot" />
            <span>LIVE LINKED • {syncStatus}</span>
          </div>

          <div className="flex items-center gap-3 border border-[rgba(204,226,255,0.29)] bg-[rgba(4,28,79,0.42)] py-1.5 px-3">
            {session?.user?.image ? (
              <Image
                src={session.user.image}
                alt="Avatar"
                width={24}
                height={24}
                unoptimized
                className="w-6 h-6 rounded-none border border-[rgba(204,226,255,0.29)] object-cover"
              />
            ) : (
              <div className="w-6 h-6 bg-[rgba(121,237,190,0.15)] text-[#79edbe] flex items-center justify-center text-[10px] font-mono font-bold">
                {session?.user?.name?.[0] || "G"}
              </div>
            )}
            <span className="text-xs font-mono text-[#b5c8eb] hidden sm:inline">
              {session?.user?.name || "Judge / Guest"}
            </span>
            {session?.user ? (
              <button
                onClick={() => signOut()}
                className="text-[#8eaee1] hover:text-white transition-colors p-1"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => setIsGuestMode(false)}
                className="text-[#8eaee1] hover:text-white transition-colors p-1 text-[10px] font-mono uppercase"
                title="Exit guest mode"
              >
                Exit
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="w-full max-w-6xl mx-auto flex-1 flex flex-col gap-6 p-4 sm:p-8 z-10">
        {/* Channel & Server Header Panel */}
        <section className="panel">
          <span className="panel-corner panel-corner--tl" />
          <span className="panel-corner panel-corner--br" />
          <div className="section-kicker">
            <span>01 // ACTIVE TELEMETRY • #{data?.channel?.name || "general"}</span>
            <span className="section-kicker__line" />
            <span className="font-mono text-[#79edbe]">{data?.guild?.name || "DISCORD SERVER"}</span>
          </div>

          <div className="p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="p-3.5 border border-[rgba(204,226,255,0.29)] bg-[rgba(4,28,79,0.42)] text-white">
                <MessageSquare className="w-7 h-7 text-[#79edbe]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#8eaee1]">Connected Server</span>
                  <span className="text-xs text-[rgba(204,226,255,0.3)]">•</span>
                  <span className="text-xs text-[#b5c8eb]">{data?.guild?.name || "Acme Community"}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-2xl font-extrabold text-white tracking-tight">
                    #{data?.channel?.name || "general"}
                  </span>
                  {data?.channels && data.channels.length > 1 && (
                    <div className="relative inline-block ml-2">
                      <select
                        value={selectedChannelId}
                        onChange={handleChannelChange}
                        className="field-select appearance-none pl-3 pr-8 py-1 text-xs cursor-pointer"
                      >
                        {data.channels.map((ch) => (
                          <option key={ch.id} value={ch.id} className="bg-[#041a4a] text-white">
                            #{ch.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-[#8eaee1] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 w-full md:w-auto justify-end">
              <button
                onClick={() => handleSetTestWindow(2)}
                className="btn-outline text-[10px] py-1.5 px-3"
                title="Simulate being away for 2 hours"
              >
                Simulate 2h Away
              </button>
              <button
                onClick={handleMarkCaughtUp}
                className="btn-outline text-[10px] py-1.5 px-3 text-[#79edbe] border-[rgba(121,237,190,0.4)] hover:bg-[rgba(121,237,190,0.15)] flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Mark Caught Up
              </button>
            </div>
          </div>
        </section>

        {/* Hero Activity Detection Panel */}
        <section className="panel">
          <span className="panel-corner panel-corner--tl" />
          <span className="panel-corner panel-corner--br" />
          <span className="panel-corner panel-corner--tr" />
          <span className="panel-corner panel-corner--bl" />

          <div className="section-kicker">
            <span>02 // CONVERSATION ACTIVITY DETECTION</span>
            <span className="section-kicker__line" />
            <span style={{ color: "#79edbe" }}>AUTHORITATIVE INGESTION</span>
          </div>

          <div className="p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-wider text-[#79edbe]">
                <Sparkles className="w-3.5 h-3.5" />
                CONVERSATION RE-ENTRY
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                You were away.
              </h2>
              <p className="text-sm sm:text-base text-white/90 font-medium">
                Catch up on what changed while you were gone.
              </p>
              <div className="flex flex-wrap items-center gap-3 text-[#b5c8eb] text-xs font-mono pt-1">
                <span className="flex items-center gap-1.5 text-[#79edbe] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#79edbe] animate-pulse" />
                  {data?.missed_messages_count ?? 0} unread messages
                </span>
                <span className="text-[rgba(204,226,255,0.3)]">•</span>
                <span className="flex items-center gap-1.5" suppressHydrationWarning>
                  <Clock className="w-3.5 h-3.5 text-[#8eaee1]" />
                  Since {timeFormatted} {durationAwayHours > 0 ? `(${durationAwayHours}h away)` : ""}
                </span>
                {data?.total_messages_count ? (
                  <>
                    <span className="text-[rgba(204,226,255,0.3)]">•</span>
                    <span>{data.total_messages_count} total stored</span>
                  </>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setIsVoiceModalOpen(true)}
                className="btn-primary"
              >
                <Volume2 className="w-4 h-4" />
                Catch me up
              </button>

              <button
                onClick={() => setIsVoiceModalOpen(true)}
                className="btn-outline"
              >
                <Radio className="w-4 h-4 text-[#79edbe] animate-pulse" />
                Talk to Re-entry
              </button>
            </div>
          </div>
        </section>

        {/* What Changed While You Were Away? (Grounded Events) */}
        <section className="space-y-3">
          <div className="section-kicker">
            <span>03 // WHAT CHANGED WHILE YOU WERE GONE</span>
            <span className="section-kicker__line" />
            <div className="flex items-center gap-3">
              <span style={{ color: "#79edbe" }}>
                {data?.important_events?.length ?? 0} THINGS MATTER
              </span>
              <button
                onClick={() => fetchChannelData(selectedChannelId)}
                className="text-[10px] text-[#8eaee1] hover:text-white flex items-center gap-1 transition-colors"
                title="Refresh channel telemetry"
              >
                <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
                SYNC
              </button>
            </div>
          </div>

          {!data?.important_events || data.important_events.length === 0 ? (
            <div className="panel p-8 text-center text-[#8eaee1]">
              <CheckCircle2 className="w-8 h-8 mx-auto text-[#79edbe] mb-3" />
              <p className="text-sm font-semibold text-white">You are all caught up</p>
              <p className="text-xs text-[#b5c8eb] mt-1 max-w-sm mx-auto">
                No major decisions, blockers, deadlines, or direct mentions were detected in the recent activity window.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {data.important_events.map((event, idx) => {
                const num = String(idx + 1).padStart(2, "0");

                // Blueprint Tailored Accent Roles
                let cardBorder = "border-[rgba(204,226,255,0.29)]";
                let cardBg = "bg-[rgba(8,46,117,0.68)]";
                let badgeStyle = "bg-[rgba(4,28,79,0.42)] text-[#f4f8ff] border-[rgba(204,226,255,0.29)]";

                if (event.type === "decision") {
                  cardBorder = "border-[rgba(212,169,255,0.4)]";
                  cardBg = "bg-[rgba(26,12,48,0.4)]";
                  badgeStyle = "bg-[rgba(212,169,255,0.15)] text-[#d4a9ff] border-[rgba(212,169,255,0.4)]";
                } else if (event.type === "blocker") {
                  cardBorder = "border-[#ff6b6b]";
                  cardBg = "bg-[rgba(255,107,107,0.12)]";
                  badgeStyle = "bg-[rgba(255,107,107,0.2)] text-[#ff8e7d] border-[#ff6b6b]";
                } else if (event.type === "deadline" || event.type === "question") {
                  cardBorder = "border-[rgba(255,196,125,0.45)]";
                  cardBg = "bg-[rgba(85,45,8,0.35)]";
                  badgeStyle = "bg-[rgba(255,196,125,0.15)] text-[#ffc47d] border-[rgba(255,196,125,0.45)]";
                } else if (event.type === "task") {
                  cardBorder = "border-[rgba(121,237,190,0.4)]";
                  cardBg = "bg-[rgba(121,237,190,0.12)]";
                  badgeStyle = "bg-[rgba(121,237,190,0.15)] text-[#79edbe] border-[rgba(121,237,190,0.4)]";
                }

                return (
                  <article
                    key={event.id || idx}
                    className={`panel p-5 border ${cardBorder} ${cardBg} flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-all`}
                  >
                    <span className="panel-corner panel-corner--tl" />
                    <span className="panel-corner panel-corner--br" />

                    <div className="flex items-start gap-4">
                      <span className="font-mono text-[#8eaee1] font-bold text-base mt-0.5">{num}</span>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 border ${badgeStyle}`}>
                            {event.type.replace("_", " ")}
                          </span>
                          <span className="text-[10px] text-[#8eaee1] font-mono">
                            CONFIDENCE: {event.confidence}
                          </span>
                          {event.owner && (
                            <span className="text-[10px] text-[#b5c8eb] font-mono">
                              OWNER: {event.owner}
                            </span>
                          )}
                          {event.deadline && (
                            <span className="text-[10px] text-[#ffc47d] font-mono">
                              DEADLINE: {event.deadline}
                            </span>
                          )}
                        </div>
                        <h4 className="text-sm sm:text-base font-bold text-white tracking-tight">
                          {event.title}
                        </h4>
                        <p className="text-xs sm:text-sm text-[#b5c8eb] leading-relaxed max-w-3xl">
                          {event.summary}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 self-end md:self-center">
                      <a
                        href={event.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-outline text-[10px] py-1 px-3 flex items-center gap-1.5 hover:text-[#79edbe]"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        View source
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Real Message Ground Evidence Preview */}
        {data?.recent_messages && data.recent_messages.length > 0 && (
          <section className="panel mt-2">
            <span className="panel-corner panel-corner--tl" />
            <span className="panel-corner panel-corner--br" />
            <div className="section-kicker">
              <span>04 // AUTHORITATIVE DISCORD MESSAGE LOG</span>
              <span className="section-kicker__line" />
              <div className="flex items-center gap-1.5 text-[#79edbe] font-mono">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>INDEXED VIA GATEWAY ({data.recent_messages.length})</span>
              </div>
            </div>

            <div className="bg-[#020c24] p-4 divide-y divide-[rgba(204,226,255,0.12)] max-h-64 overflow-y-auto custom-scrollbar font-mono text-xs">
              {data.recent_messages.map((m) => (
                <div key={m.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    {m.avatar ? (
                      <Image
                        src={m.avatar}
                        alt={m.author}
                        width={20}
                        height={20}
                        unoptimized
                        className="w-5 h-5 rounded-none border border-[rgba(204,226,255,0.2)] mt-0.5 object-cover"
                      />
                    ) : (
                      <div className="w-5 h-5 bg-[rgba(4,28,79,0.8)] text-[#8eaee1] flex items-center justify-center text-[10px]">
                        {m.author.slice(0, 1)}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{m.author}</span>
                        <span className="text-[10px] text-[#8eaee1]" suppressHydrationWarning>
                          {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="text-[#b5c8eb] font-sans text-xs mt-0.5">{m.content}</p>
                    </div>
                  </div>
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#8eaee1] hover:text-white shrink-0 p-1"
                    title="Jump to Discord message"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* AssemblyAI Voice Agent Modal */}
      <VoiceAgentModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        channelId={selectedChannelId}
        channelName={data?.channel?.name || "general"}
        guildName={data?.guild?.name || "Discord Server"}
        userName={session?.user?.name || "User"}
        discordId={(session?.user as any)?.discordId || ""}
      />
    </div>
  );
}
