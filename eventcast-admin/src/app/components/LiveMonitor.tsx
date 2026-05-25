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
  healthy: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  error: "bg-red-50 text-red-600 border-red-200",
  neutral: "bg-slate-100 text-slate-600 border-[var(--border)]",
};

const MetricPill: React.FC<MetricPillProps> = ({ label, value, status, icon }) => (
  <div
    className={`ec-badge flex items-center gap-1.5 ${pillColors[status]}`}
  >
    {icon}
    <span style={{ opacity: 0.7 }}>{label}</span>
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
    type="button"
    onClick={() => !disabled && !loading && onToggle(!enabled)}
    disabled={disabled || loading}
    title={disabled ? "No YouTube key configured" : enabled ? "Disable YouTube relay" : "Enable YouTube relay"}
    className={[
      "ec-btn",
      enabled
        ? "bg-red-50 border-red-200 text-red-600 hover:bg-red-100"
        : "ec-btn-secondary",
      disabled || loading ? "opacity-50 cursor-not-allowed" : "",
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
        enabled ? "bg-red-500" : "bg-slate-300"
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
        "ec-card relative overflow-hidden transition-all duration-500 p-0",
        isRunning ? "border-red-300 ring-1 ring-red-100 shadow-md" : "",
      ].join(" ")}
    >
      {/* Top accent line when live */}
      {isRunning && (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-red-400 to-transparent" />
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
            <div className="flex items-center gap-1.5 bg-black/80 px-2.5 py-1 rounded-full border border-red-400/50">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] font-black text-red-300 tracking-widest">LIVE</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-black/80 px-2.5 py-1 rounded-full border border-slate-500/50">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span className="text-[10px] font-black text-slate-300 tracking-widest uppercase">
                {rawState}
              </span>
            </div>
          )}
        </div>

        {/* Uptime / view count overlay */}
        <div className="absolute top-2.5 right-2.5 z-20 flex flex-col items-end gap-1">
          {uptimeSec > 0 && (
            <div className="bg-black/80 px-2 py-0.5 rounded text-[10px] font-mono text-slate-200 font-bold">
              ↑ {uptimeLabel}
            </div>
          )}
          {(event?.view_count ?? 0) > 0 && (
            <div className="bg-black/80 px-2 py-0.5 rounded text-[10px] font-mono text-blue-300 font-bold">
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
          <h3 className="text-sm font-black text-[var(--foreground)] tracking-tight leading-tight">
            {eventName}
            {brideName ? ` & ${brideName}` : ""}
          </h3>
          {subtitle && (
            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{subtitle}</p>
          )}
          <p className="text-[10px] font-mono text-[var(--text-tertiary)] mt-1">{slug}</p>
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
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={handleRestart}
            disabled={isRestarting}
            className={[
              "ec-btn",
              restartStatus === "ok"
                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                : restartStatus === "fail"
                ? "bg-red-50 border-red-200 text-red-600"
                : "ec-btn-secondary",
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

const POLL_INTERVAL_MS = 10_000;

export const LiveMonitor: React.FC<LiveMonitorProps> = ({ events, wishes }) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeStreams, setActiveStreams] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>('initializing');
  const [nextRefreshIn, setNextRefreshIn] = useState<number>(POLL_INTERVAL_MS / 1000);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick the clock every second
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const resetCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setNextRefreshIn(POLL_INTERVAL_MS / 1000);
    countdownRef.current = setInterval(() => {
      setNextRefreshIn(prev => (prev <= 1 ? POLL_INTERVAL_MS / 1000 : prev - 1));
    }, 1000);
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
      resetCountdown();
    }
  }, [events, resetCountdown]);

  useEffect(() => {
    fetchLiveStatus();
    const interval = setInterval(fetchLiveStatus, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
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
    <div className="w-full space-y-8 pb-20 ec-animate-in">

      {/* ── Header ───────────────────────────────────── */}
      <div className="ec-live-monitor-header">
        <div className="flex items-start gap-5">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "var(--error-50)", color: "var(--error)", border: "2px solid #FECDD3" }}
          >
            <Monitor size={28} />
          </div>
          <div>
            <h2 className="ec-page-title">
              Live <span style={{ color: "var(--error)" }}>Monitor</span>
            </h2>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              {systemStatus === "initializing" && (
                <span className="ec-badge" style={{ background: "var(--surface-hover)", color: "var(--text-tertiary)" }}>
                  <span className="w-2 h-2 rounded-full bg-slate-300 animate-pulse" />
                  Connecting to media server…
                </span>
              )}
              {systemStatus === "online" && (
                <span className="ec-badge" style={{ background: "var(--success-50)", color: "var(--success)", border: "1px solid #A7F3D0" }}>
                  <Radio size={12} className="animate-pulse" />
                  Connection stable
                </span>
              )}
              {systemStatus === "degraded" && (
                <span className="ec-badge ec-badge-amber">
                  <Radio size={12} className="animate-pulse" />
                  Connection unstable
                </span>
              )}
              {systemStatus === "offline" && (
                <span className="ec-badge" style={{ background: "var(--error-50)", color: "var(--error)", border: "1px solid #FECDD3" }}>
                  <WifiOff size={12} />
                  Media server offline
                </span>
              )}
              {liveCount > 0 && (
                <span className="ec-badge ec-badge-live" style={{ fontSize: "12px", padding: "6px 14px" }}>
                  {liveCount} stream{liveCount !== 1 ? "s" : ""} live
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="ec-live-monitor-header-tools">
          {lastUpdated && (
            <div className="flex flex-col items-end gap-2">
              <button
                type="button"
                onClick={fetchLiveStatus}
                disabled={isRefreshing}
                className="ec-btn ec-btn-secondary group"
              >
                <RefreshCw
                  size={18}
                  className={isRefreshing ? "animate-spin text-[var(--primary)]" : "group-hover:rotate-180 transition-transform duration-700"}
                />
                {isRefreshing
                  ? "Syncing…"
                  : `Sync ${lastUpdated.toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    })}`}
              </button>
              {!isRefreshing && (
                <div className="flex items-center gap-2">
                  <div
                    className="h-1 rounded-full overflow-hidden"
                    style={{ width: "120px", background: "var(--border-subtle)" }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-1000 ease-linear"
                      style={{
                        width: `${((POLL_INTERVAL_MS / 1000 - nextRefreshIn) / (POLL_INTERVAL_MS / 1000)) * 100}%`,
                        background: "var(--primary)",
                      }}
                    />
                  </div>
                  <span className="text-[11px] font-mono font-bold text-[var(--text-tertiary)] tabular-nums">
                    {nextRefreshIn}s
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="text-right">
            <div className="text-4xl font-black font-mono tracking-tight text-[var(--foreground)] tabular-nums leading-none">
              {currentTime.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              })}
            </div>
            <p className="ec-section-sub mt-2 font-semibold uppercase tracking-wider text-[11px]">
              {currentTime.toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
        </div>
      </div>

      {/* ── Main Grid ─────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">

        {/* Left column: streams + upcoming */}
        <div className="xl:col-span-3 space-y-10">

          {/* Active Broadcasts */}
          <section>
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="ec-section-title">Active live streams</h3>
                <p className="ec-section-sub">{activeStreams.length} active stream{activeStreams.length !== 1 ? "s" : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                {systemStatus === "online" && (
                  <span className="ec-badge" style={{ background: "var(--success-50)", color: "var(--success)", border: "1px solid #A7F3D0" }}>
                    System healthy
                  </span>
                )}
                {systemStatus === "degraded" && (
                  <span className="ec-badge ec-badge-amber">Degraded signal</span>
                )}
                {systemStatus === "offline" && (
                  <span className="ec-badge" style={{ background: "var(--error-50)", color: "var(--error)", border: "1px solid #FECDD3" }}>
                    Server offline
                  </span>
                )}
                {systemStatus === "initializing" && (
                  <span className="ec-badge" style={{ color: "var(--text-tertiary)" }}>Initializing…</span>
                )}
              </div>
            </div>

            {activeStreams.length === 0 ? (
              <div className="ec-card py-24 flex flex-col items-center justify-center gap-6 text-center">
                <div
                  className="w-20 h-20 rounded-2xl flex items-center justify-center"
                  style={{ background: "var(--info-50)", color: "var(--info)", border: "2px solid #BFDBFE" }}
                >
                  <Signal size={36} />
                </div>
                <div>
                  <p className="text-xl font-black text-[var(--foreground)] tracking-tight">
                    Waiting for live streams
                  </p>
                  <p className="ec-section-sub mt-2">Awaiting video feed from streaming software</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
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
            <section className="animate-in slide-in-from-bottom-4 duration-700">
              <div className="flex items-center gap-4 mb-6">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "var(--info-50)", color: "var(--info)", border: "2px solid #BFDBFE" }}
                >
                  <Clock size={22} />
                </div>
                <div>
                  <h3 className="ec-section-title">Upcoming events</h3>
                  <p className="ec-section-sub">Scheduled today · {upcomingToday.length} event{upcomingToday.length !== 1 ? "s" : ""}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {upcomingToday.map((event) => (
                  <div key={event.id} className="ec-card flex items-center justify-between gap-4 p-6 group">
                    <div className="min-w-0">
                      <h4 className="font-black text-lg text-[var(--foreground)] tracking-tight group-hover:text-[var(--primary)] transition-colors">
                        {event.groom_name || event.celebrant_name}
                        {event.bride_name && event.bride_name.toLowerCase() !== "family" && (
                          <span className="text-[var(--text-secondary)] font-medium"> & {event.bride_name}</span>
                        )}
                      </h4>
                      <div className="flex flex-wrap items-center gap-3 mt-2">
                        <span
                          className="ec-badge"
                          style={{ background: "var(--info-50)", color: "var(--info)", border: "1px solid #BFDBFE" }}
                        >
                          {event.event_type}
                        </span>
                        {event.venue_name && (
                          <span className="text-[12px] font-semibold text-[var(--text-secondary)] flex items-center gap-1.5 truncate max-w-[200px]">
                            <MapPin size={14} />
                            {event.venue_name}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
                        Scheduled
                      </span>
                      <span
                        className="font-mono font-black text-xl px-4 py-2 rounded-xl"
                        style={{ background: "var(--info-50)", color: "var(--info)", border: "1px solid #BFDBFE" }}
                      >
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
          <div className="ec-card overflow-hidden flex flex-col sticky top-12" style={{ padding: 0 }}>
            <div className="p-6 border-b border-[var(--border)]">
              <div className="flex items-center gap-4">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "#FDF2F8", color: "#DB2777", border: "2px solid #FBCFE8" }}
                >
                  <Heart size={22} />
                </div>
                <div>
                  <h3 className="ec-section-title" style={{ fontSize: "16px" }}>Recent guest wishes</h3>
                  <p className="ec-section-sub">Today · {todayWishes.length} wish{todayWishes.length !== 1 ? "es" : ""}</p>
                </div>
              </div>
            </div>

            <div
              className="overflow-y-auto p-6 space-y-4 custom-scrollbar flex-1"
              style={{ maxHeight: "700px" }}
            >
              {todayWishes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center border-2 border-dashed"
                    style={{ borderColor: "var(--border)", color: "var(--text-tertiary)" }}
                  >
                    <Heart size={28} />
                  </div>
                  <p className="ec-section-sub font-semibold">Waiting for guest wishes</p>
                </div>
              ) : (
                todayWishes.map((wish, idx) => (
                  <div
                    key={idx}
                    className="ec-panel p-5 transition-all duration-300 hover:border-pink-200 group animate-in slide-in-from-right-4 duration-500"
                    style={{ animationDelay: `${idx * 100}ms` }}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black flex-shrink-0"
                        style={{ background: "#FDF2F8", color: "#DB2777", border: "1px solid #FBCFE8" }}
                      >
                        {wish.name?.[0]?.toUpperCase() ?? "?"}
                      </div>
                      <h4 className="font-bold text-sm text-[var(--foreground)] group-hover:text-pink-600 transition-colors">
                        {wish.name}
                      </h4>
                    </div>
                    <p className="text-[var(--text-secondary)] text-[14px] leading-relaxed font-medium italic">
                      &ldquo;{wish.message}&rdquo;
                    </p>
                    {wish.events && (
                      <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-[var(--border-subtle)]">
                        <span className="text-[11px] font-semibold text-[var(--text-tertiary)]">Target:</span>
                        <span
                          className="ec-badge truncate max-w-[140px]"
                          style={{ background: "#FDF2F8", color: "#DB2777", border: "1px solid #FBCFE8" }}
                        >
                          {wish.events.groom_name || wish.events.celebrant_name}
                        </span>
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
