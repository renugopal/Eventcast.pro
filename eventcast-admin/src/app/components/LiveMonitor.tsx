"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Monitor, Clock, RefreshCw, Heart, Radio,
  RotateCcw, Play, Activity, Zap, Signal,
  Tv, WifiOff,
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
    <div className="min-h-[800px] bg-[#07070d] text-slate-100 rounded-3xl overflow-hidden relative">

      {/* Ambient glow orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="absolute -top-40 -left-40 w-80 h-80 bg-red-600/[0.04] rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-80 h-80 bg-blue-600/[0.04] rounded-full blur-3xl" />
        {liveCount > 0 && (
          <div className="absolute top-1/3 right-1/3 w-64 h-64 bg-red-500/[0.03] rounded-full blur-3xl animate-pulse" />
        )}
      </div>

      {/* ── Top Bar ───────────────────────────────────── */}
      <div className="relative z-10 flex items-center justify-between px-8 py-5 border-b border-white/[0.05]">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
            <Monitor size={20} className="text-red-400" />
          </div>
          <div>
            <h2 className="text-lg font-black tracking-tight text-white">
              Live Control Center
            </h2>
            <div className="flex items-center gap-3 mt-0.5">
              {systemStatus === 'initializing' && (
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <Radio size={10} className="animate-pulse" />
                  Connecting…
                </span>
              )}
              {systemStatus === 'online' && (
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                  <Radio size={10} className="animate-pulse" />
                  System Online
                </span>
              )}
              {systemStatus === 'degraded' && (
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-400">
                  <Radio size={10} className="animate-pulse" />
                  Degraded
                </span>
              )}
              {systemStatus === 'offline' && (
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-red-400">
                  <WifiOff size={10} />
                  Media Server Offline
                </span>
              )}
              {liveCount > 0 && (
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-red-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
                  {liveCount} Live Now
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {lastUpdated && (
            <button
              onClick={fetchLiveStatus}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-slate-300 transition-colors"
            >
              <RefreshCw
                size={11}
                className={isRefreshing ? "animate-spin text-blue-400" : ""}
              />
              <span className="font-mono">
                {lastUpdated.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </button>
          )}

          <div className="text-right">
            <div className="text-3xl font-black font-mono tracking-tighter text-white tabular-nums">
              {currentTime.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </div>
            <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-0.5">
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
      <div className="relative z-10 p-8 grid grid-cols-1 xl:grid-cols-4 gap-8">

        {/* Left column: streams + upcoming */}
        <div className="xl:col-span-3 space-y-8">

          {/* Active Broadcasts */}
          <section>
            <div className="flex items-center gap-2.5 mb-5">
              {activeStreams.length > 0 && (
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.7)]" />
              )}
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">
                Active Broadcasts
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-white/[0.04] text-slate-500 border border-white/[0.05]">
                {activeStreams.length}
              </span>
            </div>

            {activeStreams.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.05] bg-white/[0.02] py-16 flex flex-col items-center justify-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/[0.05] flex items-center justify-center">
                  <Signal size={24} className="text-slate-700" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-black text-slate-600">
                    No Active Broadcasts
                  </p>
                  <p className="text-xs text-slate-700 mt-1">
                    Streams will appear here when events go live
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
            <section>
              <div className="flex items-center gap-2.5 mb-4">
                <Clock size={13} className="text-blue-400" />
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">
                  Upcoming Today
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  {upcomingToday.length}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {upcomingToday.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] transition-colors"
                  >
                    <div className="min-w-0 mr-4">
                      <h4 className="font-black text-sm text-white leading-tight truncate">
                        {event.groom_name || event.celebrant_name}
                        {event.bride_name ? ` & ${event.bride_name}` : ""}
                      </h4>
                      <p className="text-[11px] text-slate-600 mt-0.5 truncate">
                        {event.event_type}
                        {event.venue_name ? ` • ${event.venue_name}` : ""}
                      </p>
                    </div>
                    <span className="font-mono text-blue-400 font-black text-sm bg-blue-500/10 border border-blue-500/20 px-3 py-1 rounded-lg flex-shrink-0">
                      {event.timer_target_time || event.event_time || "TBD"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right column: Wishes Feed */}
        <div className="xl:col-span-1">
          <div className="rounded-2xl border border-white/[0.05] bg-white/[0.02] overflow-hidden flex flex-col">
            <div className="p-5 border-b border-white/[0.05]">
              <div className="flex items-center gap-2">
                <Heart size={14} className="text-pink-400" />
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">
                  Wishes Feed
                </h3>
              </div>
              <p className="text-[10px] text-slate-700 font-bold uppercase tracking-widest mt-1.5">
                Today · {todayWishes.length} messages
              </p>
            </div>

            <div
              className="overflow-y-auto p-4 space-y-3"
              style={{ maxHeight: "520px" }}
            >
              {todayWishes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
                  <Heart size={20} className="text-slate-800" />
                  <p className="text-xs font-bold text-slate-700">
                    Waiting for wishes…
                  </p>
                </div>
              ) : (
                todayWishes.map((wish, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.05] transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-pink-500/30 to-purple-500/30 border border-white/10 flex items-center justify-center text-[10px] font-black text-pink-300 flex-shrink-0">
                        {wish.name?.[0]?.toUpperCase() ?? "?"}
                      </div>
                      <h4 className="font-black text-xs text-white truncate">
                        {wish.name}
                      </h4>
                    </div>
                    <p className="text-slate-400 text-xs leading-relaxed">
                      &ldquo;{wish.message}&rdquo;
                    </p>
                    {wish.events && (
                      <p className="text-[10px] text-slate-700 font-bold uppercase tracking-widest text-right mt-2">
                        For {wish.events.groom_name || wish.events.celebrant_name}
                      </p>
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
