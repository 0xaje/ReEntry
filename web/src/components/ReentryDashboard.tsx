"use client";

import React, { useState, useEffect } from "react";
import {
  MessageSquare,
  Volume2,
  Radio,
  ExternalLink,
  Clock,
  CheckCircle2,
  AlertCircle,
  LogOut,
  RefreshCw,
  Sparkles,
  ChevronDown,
  ShieldCheck,
  Calendar,
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
  const [statusNote, setStatusNote] = useState<string | null>(null);

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
  // LOGGED OUT VIEW
  // -------------------------
  if (!session?.user && !isGuestMode) {
    return (
      <main className="min-h-screen relative flex flex-col items-center justify-center p-6 bg-zinc-950 text-zinc-100 selection:bg-indigo-500 selection:text-white">
        <div className="absolute top-1/4 left-1/4 w-[450px] h-[450px] bg-indigo-600/10 rounded-full blur-[130px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-[450px] h-[450px] bg-cyan-600/10 rounded-full blur-[130px] pointer-events-none" />

        <div className="w-full max-w-md bg-zinc-900/70 border border-zinc-800/80 backdrop-blur-2xl p-8 rounded-3xl shadow-2xl flex flex-col gap-6 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Radio className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Project Re-entry</h1>
              <p className="text-xs text-zinc-400">Discord Conversation Intelligence</p>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-zinc-200">Return to what matters.</h2>
            <p className="text-sm text-zinc-400 leading-relaxed">
              You don&apos;t need another summary. You need to know what happened while you were gone.
            </p>
          </div>

          <button
            onClick={() => signIn("discord")}
            className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl bg-[#5865F2] hover:bg-[#4752c4] text-white font-medium transition-all shadow-[0_0_20px_rgba(88,101,242,0.3)] active:scale-[0.98]"
          >
            <MessageSquare className="w-5 h-5" />
            Sign in with Discord
          </button>

          <div className="flex items-center gap-3 my-0.5">
            <div className="flex-1 border-t border-zinc-800" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono">or test locally</span>
            <div className="flex-1 border-t border-zinc-800" />
          </div>

          <button
            onClick={() => setIsGuestMode(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-all border border-zinc-700 active:scale-[0.98]"
          >
            Enter Command Center (Local Test Mode)
          </button>
        </div>
      </main>
    );
  }

  // -------------------------
  // LOGGED IN COMMAND CENTER
  // -------------------------
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col p-4 sm:p-8 relative selection:bg-indigo-500 selection:text-white">
      {/* Subtle Background Glows */}
      <div className="absolute top-0 left-1/3 w-[600px] h-[300px] bg-indigo-600/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[400px] h-[300px] bg-cyan-600/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Top Navigation */}
      <header className="w-full max-w-5xl mx-auto flex items-center justify-between pb-8 mb-6 border-b border-zinc-800/80 z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              PROJECT RE-ENTRY
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                DISCORD
              </span>
            </h1>
            <p className="text-xs text-zinc-400">Voice-Native Conversation Intelligence</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
            <span
              className={`w-2 h-2 rounded-full ${
                syncStatus === "Connected" || syncStatus === "Synced"
                  ? "bg-emerald-400"
                  : syncStatus === "Syncing"
                  ? "bg-amber-400 animate-ping"
                  : "bg-red-400"
              }`}
            />
            <span>{syncStatus}</span>
          </div>

          <div className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800 py-1.5 px-3 rounded-full">
            {session?.user?.image ? (
              <img
                src={session.user.image}
                alt="Avatar"
                className="w-6 h-6 rounded-full border border-zinc-700"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-bold">
                {session?.user?.name?.[0] || "U"}
              </div>
            )}
            <span className="text-xs font-medium hidden sm:inline">{session?.user?.name || "Judge / Guest"}</span>
            {session?.user ? (
              <button
                onClick={() => signOut()}
                className="text-zinc-400 hover:text-zinc-100 transition-colors p-1"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => setIsGuestMode(false)}
                className="text-zinc-400 hover:text-zinc-100 transition-colors p-1 text-[10px]"
                title="Exit guest mode"
              >
                Exit
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="w-full max-w-5xl mx-auto flex-1 flex flex-col gap-8 z-10">
        {/* Channel & Server Banner */}
        <section className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6 backdrop-blur-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl">
          <div className="flex items-center gap-4">
            <div className="p-3.5 rounded-2xl bg-[#5865F2]/10 border border-[#5865F2]/20 text-[#5865F2]">
              <MessageSquare className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Connected Server</span>
                <span className="text-xs text-zinc-600">•</span>
                <span className="text-xs text-zinc-300">{data?.guild?.name || "Acme Community"}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-2xl font-bold text-white tracking-tight">
                  #{data?.channel?.name || "general"}
                </span>
                {data?.channels && data.channels.length > 1 && (
                  <div className="relative inline-block ml-2">
                    <select
                      value={selectedChannelId}
                      onChange={handleChannelChange}
                      className="appearance-none bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 text-xs rounded-lg pl-3 pr-7 py-1 border border-zinc-700 focus:outline-none cursor-pointer"
                    >
                      {data.channels.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          #{ch.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-end">
            <button
              onClick={() => handleSetTestWindow(2)}
              className="text-xs px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors border border-zinc-700"
              title="Simulate being away for 2 hours"
            >
              Simulate 2h Away
            </button>
            <button
              onClick={handleMarkCaughtUp}
              className="text-xs px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors border border-zinc-700 flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Mark Caught Up
            </button>
          </div>
        </section>

        {/* Hero Activity Metric Card */}
        <section className="bg-gradient-to-br from-zinc-900/90 to-zinc-950/80 border border-zinc-800/80 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-400">
                <Sparkles className="w-4 h-4" />
                Activity Detection
              </div>
              <h2 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight">
                {data?.missed_messages_count ?? 0} real messages
              </h2>
              <p className="text-zinc-400 text-sm sm:text-base flex items-center gap-2">
                <Clock className="w-4 h-4 text-zinc-500" />
                Since {timeFormatted} {durationAwayHours > 0 ? `(${durationAwayHours}h away)` : ""}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setIsVoiceModalOpen(true)}
                className="px-6 py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-all shadow-[0_0_25px_rgba(99,102,241,0.35)] flex items-center gap-2.5 active:scale-[0.98]"
              >
                <Volume2 className="w-5 h-5" />
                Catch me up
              </button>

              <button
                onClick={() => setIsVoiceModalOpen(true)}
                className="px-6 py-3.5 rounded-2xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 font-semibold transition-all flex items-center gap-2.5 active:scale-[0.98]"
              >
                <Radio className="w-5 h-5 text-indigo-400 animate-pulse" />
                Talk to Re-entry
              </button>
            </div>
          </div>
        </section>

        {/* What Changed While You Were Away? (Grounded Events) */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
              <span>What changed while you were gone?</span>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                {data?.important_events?.length ?? 0} things matter
              </span>
            </h3>
            <button
              onClick={() => fetchChannelData(selectedChannelId)}
              className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {!data?.important_events || data.important_events.length === 0 ? (
            <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-3xl p-10 text-center text-zinc-500">
              <CheckCircle2 className="w-8 h-8 mx-auto text-zinc-600 mb-3" />
              <p className="text-base font-medium text-zinc-400">You are all caught up!</p>
              <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
                No major decisions, blockers, deadlines, or direct mentions were detected in the recent activity window.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {data.important_events.map((event, idx) => {
                const num = String(idx + 1).padStart(2, "0");
                const badgeColor =
                  event.type === "decision"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : event.type === "blocker"
                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                    : event.type === "deadline"
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    : event.type === "task"
                    ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                    : event.type === "mention"
                    ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                    : "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";

                return (
                  <article
                    key={event.id || idx}
                    className="bg-zinc-900/60 border border-zinc-800/90 rounded-2xl p-5 hover:border-zinc-700 transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-4 group"
                  >
                    <div className="flex items-start gap-4">
                      <span className="font-mono text-zinc-600 font-bold text-lg mt-0.5">{num}</span>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${badgeColor}`}>
                            {event.type.replace("_", " ")}
                          </span>
                          <span className="text-xs text-zinc-500 font-mono">
                            Confidence: {event.confidence}
                          </span>
                        </div>
                        <h4 className="text-base font-semibold text-zinc-100 group-hover:text-indigo-300 transition-colors">
                          {event.title}
                        </h4>
                        <p className="text-sm text-zinc-400 leading-relaxed max-w-2xl">
                          {event.summary}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 self-end md:self-center">
                      <a
                        href={event.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 px-3 py-1.5 rounded-xl transition-colors"
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
          <section className="space-y-4 pt-4 border-t border-zinc-800/60">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Ground Truth Discord Stream ({data.recent_messages.length} messages)
              </h3>
              <span className="text-xs text-zinc-500 font-mono">Indexed via Discord Gateway</span>
            </div>

            <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-4 divide-y divide-zinc-800/60 max-h-60 overflow-y-auto custom-scrollbar text-xs">
              {data.recent_messages.map((m) => (
                <div key={m.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    {m.avatar ? (
                      <img src={m.avatar} alt="Avatar" className="w-5 h-5 rounded-full mt-0.5" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-400">
                        {m.author.slice(0, 1)}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-zinc-200">{m.author}</span>
                        <span className="text-[10px] text-zinc-500">
                          {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="text-zinc-300 mt-0.5">{m.content}</p>
                    </div>
                  </div>
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-zinc-500 hover:text-indigo-400 shrink-0 p-1"
                    title="Jump to Discord message"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

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
    </main>
  );
}
