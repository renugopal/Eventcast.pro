"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Monitor, Clock, RefreshCw, Heart, Radio,
  RotateCcw, Play, Activity, Zap, Signal,
  Tv, WifiOff, MapPin,
} from "lucide-react";
import { authFetch } from "@/lib/client-auth";

// ─── HLS Player ───────────────────────────────────────────────────────────────

interface HlsPlayerProps {
  src: string;
}

const HlsPlayer: React.FC<HlsPlayerProps> = ({ src }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setIsLoading(true);
    setHasError(false);
    let destroyed = false;

    const setup = async () => {
      try {
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          // Native HLS (Safari / iOS)
          video.src = src;
          video.play().catch(() => {});
        } else {
          const { default: Hls } = await import("hls.js");
          if (destroyed) return;
          if (Hls.isSupported()) {
            const hls = new Hls({
              lowLatencyMode: false,
              maxBufferLength: 30,
              manifestLoadingTimeOut: 10000,
            });
            hlsRef.current = hls;
            hls.loadSource(src);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (!destroyed) {
                setIsLoading(false);
                video.play().catch(() => {});
              }
            });
            hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean }) => {
              if (data.fatal) setHasError(true);
            });
          } else {
            setHasError(true);
          }
        }
      } catch {
        setHasError(true);
      }
    };

    const onLoaded = () => setIsLoading(false);
    const onError = () => setHasError(true);
    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("error", onError);

    setup();

    return () => {
      destroyed = true;
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("error", onError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src]);

  if (hasError) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-2">
        <WifiOff size={22} className="text-slate-600" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
          No Signal
        </p>
      </div>
    );
  }

  return (
    <>
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 gap-2">
          <div className="w-5 h-5 border-2 border-red-500/40 border-t-red-500 rounded-full animate-spin" />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
            Connecting
          </p>
        </div>
      )}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        autoPlay
        muted
        playsInline
      />
    </>
  );
};

// ─── Metric Pill ──────────────────────────────────────────────────────────────

type PillStatus = "healthy" | "warning" | "error" | "neutral";

interface MetricPillProps {
  label: string;
  value: string | number;
  status: PillStatus;
  icon?: React.ReactNode;
}

const pillColors: Record<PillStatus, string> = {
  healthy: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  error: "bg-red-500/15 text-red-400 border-red-500/30",
  neutral: "bg-slate-500/10 text-slate-500 border-slate-600/30",
};

const MetricPill: React.FC<MetricPillProps> = ({ label, value, status, icon }) => (
  <div
    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold ${pillColors[status]}`}
  >
    {icon}
    <span className="opacity-60">{label}</span>
    <span>{value}</span>
  </div>
);

// ─── YouTube Toggle ───────────────────────────────────────────────────────────

interface YouTubeToggleProps {
  enabled: boolean;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
}

const YouTubeToggle: React.FC<YouTubeToggleProps> = ({
  enabled,
  onToggle,
  disabled,
  loading,
}) => (
  <button
    onClick={() => !disabled && !loading && onToggle(!enabled)}
    disabled={disabled || loading}
    title={disabled ? "No YouTube key configured" : enabled ? "Disable YouTube relay" : "Enable YouTube relay"}
    className={[
      "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 border",
      enabled
        ? "bg-red-500/20 border-red-500/40 text-red-400 hover:bg-red-500/30"
        : "bg-slate-800/60 border-slate-700/60 text-slate-400 hover:bg-slate-700/80",
      disabled || loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
    ].join(" ")}
  >
    {loading ? (
      <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
    ) : (
      <Play size={12} />
    )}
    <span>YouTube</span>
    <div
      className={`relative w-7 h-3.5 rounded-full transition-colors duration-300 ${
        enabled ? "bg-red-500" : "bg-slate-600"
      }`}
    >
      <div
        className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full shadow transition-transform duration-300 ${
          enabled ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </div>
  </button>
);

// ─── Stream Card ──────────────────────────────────────────────────────────────

interface StreamCardProps {
  stream: any;
  event: any;
}

const StreamCard: React.FC<StreamCardProps> = ({ stream, event }) => {
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartStatus, setRestartStatus] = useState<"idle" | "ok" | "fail">("idle");
  const [youtubeEnabled, setYoutubeEnabled] = useState(false);
  const [youtubeLoading, setYoutubeLoading] = useState(false);

  const slug: string = stream.id;

  // Normalise state whether it comes as a string or as {exec: string}
  const rawState: string =
    typeof stream.state === "string" ? stream.state : stream.state?.exec ?? "unknown";

  const isRunning = rawState === "running";

  // Parse health metrics — handle both raw Datarhei process list shape and
  // the StreamHealth shape used by getProcessHealth()
  const bitrateKbps: number =
    stream.progress?.input?.[0]?.bitrate_kbit ?? stream.bitrateKbps ?? 0;
  const fps: number = stream.progress?.input?.[0]?.fps ?? stream.fps ?? 0;
  const uptimeSec: number = stream.runtime_seconds ?? stream.uptime ?? 0;

  const uptimeLabel =
    uptimeSec > 0
      ? `${Math.floor(uptimeSec / 3600) > 0 ? `${Math.floor(uptimeSec / 3600)}h ` : ""}${Math.floor((uptimeSec % 3600) / 60)}m`
      : "—";

  const stateStatus: PillStatus =
    rawState === "running"
      ? "healthy"
      : rawState === "idle" || rawState === "finished"
      ? "warning"
      : rawState === "failed" || rawState === "stopped"
      ? "error"
      : "neutral";

  // Seed YouTube toggle from process config
  useEffect(() => {
    const outputs: { id: string }[] = stream.config?.output ?? [];
    setYoutubeEnabled(outputs.some((o) => o.id === "youtube"));
  }, [stream.config]);

  const hlsUrl = `https://media.eventcast.pro/memfs/${slug}.m3u8`;
  const eventName = event?.groom_name || event?.celebrant_name || slug;
  const brideName: string | undefined = event?.bride_name;
  const subtitle = [event?.venue_name, event?.event_type].filter(Boolean).join(" • ");

  const handleRestart = async () => {
    setIsRestarting(true);
    setRestartStatus("idle");
    try {
      const res = await authFetch("/api/media/restart-channel", {
        method: "POST",
        body: JSON.stringify({ slug }),
      });
      setRestartStatus(res.ok ? "ok" : "fail");
    } catch {
      setRestartStatus("fail");
    } finally {
      setIsRestarting(false);
      setTimeout(() => setRestartStatus("idle"), 3000);
    }
  };

  const handleYoutubeToggle = async (next: boolean) => {
    if (!event?.id) return;
    setYoutubeLoading(true);
    try {
      const res = await authFetch("/api/media/toggle-youtube", {
        method: "POST",
        body: JSON.stringify({ slug, enabled: next, eventId: event.id }),
      });
      if (res.ok) setYoutubeEnabled(next);
    } catch {
      // state stays unchanged on error
    } finally {
      setYoutubeLoading(false);
    }
  };

  return (
    <div
      className={[
        "relative rounded-2xl overflow-hidden border transition-all duration-500",
        "bg-white/[0.03] backdrop-blur-2xl",
        isRunning
          ? "border-red-500/20 shadow-[0_0_32px_rgba(239,68,68,0.08)]"
          : "border-white/[0.06]",
      ].join(" ")}
    >
      {/* Top glow line when live */}
      {isRunning && (
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-500/60 to-transparent" />
      )}

      {/* ── Video Preview ───────────────────────────────── */}
      <div className="relative aspect-video bg-black overflow-hidden">
        {isRunning ? (
          <HlsPlayer src={hlsUrl} />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Tv size={26} className="text-slate-700" />
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-700">
              Stream Offline
            </p>
          </div>
        )}

        {/* LIVE / state badge */}
        <div className="absolute top-2.5 left-2.5 z-20">
          {isRunning ? (
            <div className="flex items-center gap-1.5 bg-black/70 backdrop-blur-sm px-2.5 py-1 rounded-full border border-red-500/40">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
              <span className="text-[10px] font-black text-red-400 tracking-widest">LIVE</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-black/70 backdrop-blur-sm px-2.5 py-1 rounded-full border border-slate-600/40">
              <span className="w-2 h-2 rounded-full bg-slate-600" />
              <span className="text-[10px] font-black text-slate-400 tracking-widest uppercase">
                {rawState}
              </span>
            </div>
          )}
        </div>

        {/* Uptime / view count overlay */}
        <div className="absolute top-2.5 right-2.5 z-20 flex flex-col items-end gap-1">
          {uptimeSec > 0 && (
            <div className="bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-mono text-slate-300 font-bold">
              ↑ {uptimeLabel}
            </div>
          )}
          {(event?.view_count ?? 0) > 0 && (
            <div className="bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-mono text-blue-400 font-bold">
              {event.view_count} views
            </div>
          )}
        </div>

        {/* Bottom gradient scrim */}
        <div className="absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-black/60 to-transparent z-10 pointer-events-none" />
      </div>

      {/* ── Card Body ──────────────────────────────────── */}
      <div className="p-4 space-y-3">
        {/* Name */}
        <div>
          <h3 className="text-sm font-black text-white tracking-tight leading-tight">
            {eventName}
            {brideName ? ` & ${brideName}` : ""}
          </h3>
          {subtitle && (
            <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
          )}
          <p className="text-[10px] font-mono text-slate-700 mt-1">{slug}</p>
        </div>

        {/* Metrics */}
        <div className="flex flex-wrap gap-1.5">
          <MetricPill
            label="State"
            value={rawState.toUpperCase()}
            status={stateStatus}
          />
          <MetricPill
            label="Bitrate"
            value={bitrateKbps > 0 ? `${Math.round(bitrateKbps)} kbps` : "—"}
            status={bitrateKbps > 500 ? "healthy" : bitrateKbps > 0 ? "warning" : "neutral"}
            icon={<Activity size={9} />}
          />
          <MetricPill
            label="FPS"
            value={fps > 0 ? `${Math.round(fps)}` : "—"}
            status={fps >= 24 ? "healthy" : fps > 0 ? "warning" : "neutral"}
            icon={<Zap size={9} />}
          />
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.04]">
          <button
            onClick={handleRestart}
            disabled={isRestarting}
            className={[
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 border",
              restartStatus === "ok"
                ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                : restartStatus === "fail"
                ? "bg-red-500/20 border-red-500/40 text-red-400"
                : "bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-700/80 hover:text-white",
              isRestarting ? "opacity-60 cursor-not-allowed" : "",
            ].join(" ")}
          >
            <RotateCcw
              size={11}
              className={isRestarting ? "animate-spin" : ""}
            />
            {isRestarting
              ? "Restarting…"
              : restartStatus === "ok"
              ? "Done!"
              : restartStatus === "fail"
              ? "Failed"
              : "Restart"}
          </button>

          <YouTubeToggle
            enabled={youtubeEnabled}
            onToggle={handleYoutubeToggle}
            disabled={!event?.id}
            loading={youtubeLoading}
          />
        </div>
      </div>
    </div>
  );
};

// ─── Main LiveMonitor ─────────────────────────────────────────────────────────

type SystemStatus = 'initializing' | 'online' | 'degraded' | 'offline';

interface LiveMonitorProps {
  events: any[];
  wishes: any[];
}

export const LiveMonitor: React.FC<LiveMonitorProps> = ({ events, wishes }) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeStreams, setActiveStreams] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>('initializing');

  // Tick the clock every second
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const fetchLiveStatus = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const res = await authFetch("/api/media/live-status");
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.activeProcesses) {
          const mapped = (data.activeProcesses as any[]).map((proc) => ({
            ...proc,
            eventData: events.find((e) => e.slug === proc.id) ?? null,
          }));
          setActiveStreams(mapped);
          setLastUpdated(new Date());
          setSystemStatus('online');
        } else {
          setSystemStatus('degraded');
        }
      } else {
        setSystemStatus('offline');
      }
    } catch {
      setSystemStatus('offline');
    } finally {
      setIsRefreshing(false);
    }
  }, [events]);

  useEffect(() => {
    fetchLiveStatus();
    const interval = setInterval(fetchLiveStatus, 15_000);
    return () => clearInterval(interval);
  }, [fetchLiveStatus]);

  const today = new Date().toISOString().split("T")[0];

  // Upcoming events today that aren't currently streaming
  const upcomingToday = events.filter(
    (e) =>
      e.event_date === today && !activeStreams.find((s) => s.id === e.slug)
  );

  const todayWishes = wishes.filter(
    (w) => new Date(w.created_at).toISOString().split("T")[0] === today
  );

  const liveCount = activeStreams.filter((s) => {
    const st = typeof s.state === "string" ? s.state : s.state?.exec;
    return st === "running";
  }).length;

  return (
    <div className="min-h-[900px] text-slate-100 rounded-[3.5rem] overflow-hidden relative border backdrop-blur-3xl shadow-2xl" style={{ background: "rgba(255,255,255,0.01)", borderColor: "rgba(255,255,255,0.08)" }}>

      {/* Ambient glow orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="absolute -top-40 -left-40 w-[30rem] h-[30rem] bg-red-600/[0.04] rounded-full blur-[150px]" />
        <div className="absolute -bottom-40 -right-40 w-[30rem] h-[30rem] bg-blue-600/[0.04] rounded-full blur-[150px]" />
        {liveCount > 0 && (
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[40rem] h-[40rem] bg-red-500/[0.02] rounded-full blur-[120px] animate-pulse" />
        )}
      </div>

      {/* ── Top Bar ───────────────────────────────────── */}
      <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between px-12 py-10 border-b border-white/[0.06] gap-10 bg-white/[0.02]">
        <div className="flex items-center gap-8">
          <div className="w-16 h-16 rounded-[1.5rem] bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0 shadow-2xl shadow-red-500/10 group">
            <Monitor size={32} className="text-red-500 group-hover:scale-110 transition-transform duration-500" />
          </div>
          <div>
            <h2 className="text-3xl font-black tracking-tighter text-white">
              Mission <span className="text-red-500">Control</span> Hub
            </h2>
            <div className="flex items-center gap-5 mt-2.5">
              {systemStatus === 'initializing' && (
                <span className="flex items-center gap-2.5 text-[10px] font-black uppercase tracking-[0.3em] text-white/20">
                  <div className="w-2 h-2 rounded-full bg-white/20 animate-pulse" />
                  Calibrating Satellite Link…
                </span>
              )}
              {systemStatus === 'online' && (
                <span className="flex items-center gap-2.5 text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400 bg-emerald-500/10 px-4 py-1.5 rounded-full border border-emerald-500/20 shadow-lg shadow-emerald-500/5">
                  <Radio size={12} className="animate-pulse" />
                  Telemetry: NOMINAL
                </span>
              )}
              {systemStatus === 'degraded' && (
                <span className="flex items-center gap-2.5 text-[10px] font-black uppercase tracking-[0.3em] text-amber-400 bg-amber-500/10 px-4 py-1.5 rounded-full border border-amber-500/20">
                  <Radio size={12} className="animate-pulse" />
                  Link Degradation Detected
                </span>
              )}
              {systemStatus === 'offline' && (
                <span className="flex items-center gap-2.5 text-[10px] font-black uppercase tracking-[0.3em] text-red-400 bg-red-500/10 px-4 py-1.5 rounded-full border border-red-500/20">
                  <WifiOff size={12} />
                  Mainframe Connection Lost
                </span>
              )}
              {liveCount > 0 && (
                <div className="flex items-center gap-3 bg-red-500/10 px-4 py-1.5 rounded-full border border-red-500/20 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_12px_rgba(239,68,68,1)]" />
                  <span className="text-[10px] font-black text-red-500 uppercase tracking-[0.3em]">{liveCount} BROADCASTS LIVE</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-12">
          {lastUpdated && (
            <button
              onClick={fetchLiveStatus}
              disabled={isRefreshing}
              className="group flex items-center gap-4 text-[10px] font-black text-white/30 hover:text-white transition-all bg-white/[0.03] px-6 py-3 rounded-2xl border border-white/5 hover:border-blue-500/40 active:scale-95"
            >
              <RefreshCw
                size={16}
                className={isRefreshing ? "animate-spin text-blue-400" : "group-hover:rotate-180 transition-transform duration-1000"}
              />
              <span className="font-mono tracking-widest uppercase">
                SYNC {lastUpdated.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false
                })}
              </span>
            </button>
          )}

          <div className="text-right">
            <div className="text-5xl font-black font-mono tracking-tighter text-white tabular-nums drop-shadow-2xl leading-none">
              {currentTime.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false
              })}
            </div>
            <div className="text-[10px] font-black text-white/20 uppercase tracking-[0.4em] mt-3">
              {currentTime.toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Grid ─────────────────────────────────── */}
      <div className="relative z-10 p-12 grid grid-cols-1 xl:grid-cols-4 gap-12">

        {/* Left column: streams + upcoming */}
        <div className="xl:col-span-3 space-y-16">

          {/* Active Broadcasts */}
          <section>
            <div className="flex items-center justify-between mb-10">
              <div className="flex items-center gap-5">
                <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-white/30">
                  Global Sector Monitor
                </h3>
                <div className="h-px w-20 bg-white/[0.06]" />
                <span className="text-[11px] font-black text-white/10 tabular-nums uppercase tracking-widest">
                  {activeStreams.length} ACTIVE NODES
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.8)]" />
                <span className="text-[10px] font-black text-emerald-500/40 uppercase tracking-[0.3em]">Scalability Optimized</span>
              </div>
            </div>

            {activeStreams.length === 0 ? (
              <div className="rounded-[3.5rem] border border-white/[0.05] bg-white/[0.015] py-32 flex flex-col items-center justify-center gap-8 backdrop-blur-3xl shadow-inner relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-b from-blue-500/[0.01] to-transparent" />
                <div className="w-24 h-24 rounded-[2.5rem] bg-white/[0.03] border border-white/[0.06] flex items-center justify-center shadow-2xl group-hover:scale-110 group-hover:border-blue-500/30 transition-all duration-700 relative z-10">
                  <Signal size={40} className="text-white/5 group-hover:text-blue-500/40 transition-colors" />
                </div>
                <div className="text-center relative z-10">
                  <p className="text-2xl font-black text-white/20 tracking-tight">
                    Listening for Broadcast Signals
                  </p>
                  <p className="text-[10px] font-black text-white/10 uppercase tracking-[0.4em] mt-3">
                    Awaiting Ingest Authorization From Remote Nodes
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                {activeStreams.map((stream) => (
                  <StreamCard
                    key={stream.id}
                    stream={stream}
                    event={stream.eventData}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Upcoming Today */}
          {upcomingToday.length > 0 && (
            <section className="animate-in slide-in-from-bottom-6 duration-1000 delay-300">
              <div className="flex items-center gap-5 mb-10">
                <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shadow-lg shadow-blue-500/5">
                  <Clock size={24} className="text-blue-400" />
                </div>
                <div>
                  <h3 className="text-xs font-black uppercase tracking-[0.3em] text-white/30">
                    Deployment Queue
                  </h3>
                  <p className="text-[10px] font-black text-white/10 mt-1 uppercase tracking-[0.4em]">Chronological Schedule: {upcomingToday.length} Expected Units</p>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {upcomingToday.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between p-8 rounded-[2rem] bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-blue-500/40 transition-all duration-500 shadow-2xl group relative overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-600/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="min-w-0 mr-8 relative z-10">
                      <h4 className="font-black text-xl text-white tracking-tight group-hover:text-blue-400 transition-all duration-500">
                        {event.groom_name || event.celebrant_name}
                        {event.bride_name && event.bride_name.toLowerCase() !== 'family' && (
                          <span className="text-white/40 font-medium"> & {event.bride_name}</span>
                        )}
                      </h4>
                      <div className="flex items-center gap-4 mt-3">
                         <span className="text-[9px] font-black text-blue-500/60 uppercase tracking-[0.2em] bg-blue-500/10 px-3 py-1 rounded-lg border border-blue-500/20">{event.event_type}</span>
                         {event.venue_name && <span className="text-[10px] font-black text-white/20 uppercase tracking-widest truncate max-w-[200px] flex items-center gap-2"><MapPin size={12} /> {event.venue_name}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0 relative z-10">
                       <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">Launch T-Minus</span>
                       <span className="font-mono text-blue-400 font-black text-2xl bg-blue-500/10 border border-blue-500/20 px-6 py-2 rounded-2xl shadow-2xl shadow-blue-500/10 group-hover:scale-105 transition-transform">
                         {event.timer_target_time || event.event_time || "—:—"}
                       </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right column: Wishes Feed */}
        <div className="xl:col-span-1">
          <div className="rounded-[3rem] border border-white/[0.08] bg-white/[0.015] overflow-hidden flex flex-col h-full backdrop-blur-3xl shadow-[0_0_50px_rgba(0,0,0,0.3)] sticky top-12">
            <div className="p-10 border-b border-white/[0.06] bg-white/[0.02]">
              <div className="flex items-center gap-5 mb-2">
                <div className="w-12 h-12 rounded-2xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center shadow-lg shadow-pink-500/5">
                  <Heart size={24} className="text-pink-400" />
                </div>
                <div>
                  <h3 className="text-xs font-black uppercase tracking-[0.3em] text-white/30">
                    Signal Intercepts
                  </h3>
                  <p className="text-[10px] text-white/10 font-black uppercase tracking-[0.4em] mt-1.5">
                    Today · {todayWishes.length} DATA PACKETS
                  </p>
                </div>
              </div>
            </div>

            <div
              className="overflow-y-auto p-8 space-y-6 custom-scrollbar flex-1"
              style={{ maxHeight: "700px" }}
            >
              {todayWishes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
                  <div className="w-20 h-20 rounded-[2.5rem] bg-white/[0.01] border border-dashed border-white/10 flex items-center justify-center group hover:border-pink-500/30 transition-all duration-700">
                    <Heart size={32} className="text-white/5 group-hover:text-pink-500/20 transition-colors" />
                  </div>
                  <p className="text-[11px] font-black text-white/10 uppercase tracking-[0.4em]">
                    Awaiting Inbound Engagement
                  </p>
                </div>
              ) : (
                todayWishes.map((wish, idx) => (
                  <div
                    key={idx}
                    className="p-6 rounded-[2.5rem] bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-pink-500/30 transition-all duration-500 shadow-2xl group animate-in slide-in-from-right-4 duration-700"
                    style={{ animationDelay: `${idx * 100}ms` }}
                  >
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-pink-500/20 to-blue-500/20 border border-white/10 flex items-center justify-center text-sm font-black text-pink-400 flex-shrink-0 shadow-lg shadow-pink-500/10 group-hover:scale-110 transition-transform duration-500">
                        {wish.name?.[0]?.toUpperCase() ?? "?"}
                      </div>
                      <h4 className="font-black text-sm text-white tracking-tight group-hover:text-pink-400 transition-colors">
                        {wish.name}
                      </h4>
                    </div>
                    <p className="text-white/50 text-[14px] leading-relaxed font-medium italic">
                      &ldquo;{wish.message}&rdquo;
                    </p>
                    {wish.events && (
                      <div className="flex items-center justify-end gap-3 mt-5 pt-5 border-t border-white/[0.04]">
                        <span className="text-[9px] font-black text-white/10 uppercase tracking-[0.2em]">Target:</span>
                        <span className="text-[9px] font-black text-pink-500/60 uppercase tracking-[0.2em] truncate max-w-[140px]">{wish.events.groom_name || wish.events.celebrant_name}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
