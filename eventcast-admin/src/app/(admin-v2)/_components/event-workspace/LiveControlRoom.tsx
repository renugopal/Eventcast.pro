"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Eye, EyeOff, LifeBuoy, Radio, Video } from "lucide-react";
import { authFetch } from "@/lib/client-auth";
import {
  enableLivestream,
  endLivestream,
  fetchLivestreamStatus,
  updateYoutubeWatchUrl,
  type LivestreamStatus,
} from "@/lib/livestreamClient";
import { fetchRecordingView, type ProviderRecordingView } from "@/lib/recordingClient";

/**
 * Live Control Room (Livestream + YouTube + Live Control Room delivery
 * package, Baseline V2.1 LIV-007). Real provider-facing control surface
 * replacing the Event Workspace Live tab's former "not implemented"
 * placeholder.
 *
 * Every value shown here has a real, named source:
 *  - Private Livestream enabled/disabled, Stream URL, publish window,
 *    YouTube relay flag: `GET /api/events/[eventId]/livestream/status`,
 *    which reuses the existing `media_event_assignments` control-plane row
 *    (no new stream state).
 *  - Stream Key: only ever present once, in the response of a successful
 *    Enable call — the raw token is never persisted anywhere (only its
 *    hash), so it cannot be re-shown after this component unmounts or the
 *    page reloads. That is disclosed in the UI copy rather than hidden.
 *  - Resolution/FPS/bitrate/codecs/duration/reconnects/viewers: no
 *    authoritative source exists yet anywhere in the current SRS/Media
 *    Agent integration, so these are shown as "Not yet measured" rather
 *    than fabricated (baseline: "no fake stream health").
 *  - YouTube: the manual watch-link model only (Baseline YTB-003) — a link,
 *    never relay credentials. OAuth-connected channels are a separate,
 *    unimplemented destination model (see the package completion report).
 *  - Recording/replay: `GET /api/events/[eventId]/recording` (Milestone N —
 *    B2 playback delivery, replay expiry, verified YouTube fallback), the
 *    same sanitized provider-facing view the public event page's own replay
 *    eligibility is independently derived from. Never a raw B2 key, bucket,
 *    or infrastructure field — only replay status, retention expiry, and
 *    whether a verified YouTube fallback exists.
 *
 * Test vs. Live framing: while the event's page is still a Draft, the
 * public Worker refuses to serve the page or any HLS asset at all (its own
 * event lookup requires `page_state = 'published'` before an HLS request is
 * even reached) — so enabling here is already a fully private test with no
 * schema change needed. The button label reflects that honestly; the
 * backend action is identical either way.
 */

interface LiveControlRoomProps {
  eventId: string;
  pageState: string | null;
}

type OneTimeCredentials = { streamUrl: string; streamKey: string };

function maskValue(value: string): string {
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}${"•".repeat(Math.max(8, value.length - 8))}${value.slice(-4)}`;
}

function MaskedField({ label, value }: { label: string; value: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail (permissions, insecure context) — the
      // value stays visible via Reveal either way, so this is non-fatal.
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)" }}>{label}</span>
      <div className="flex items-center gap-2 flex-wrap">
        <code
          style={{
            fontSize: "12px",
            background: "var(--surface-hover)",
            padding: "4px 8px",
            borderRadius: "4px",
            wordBreak: "break-all",
          }}
        >
          {revealed ? value : maskValue(value)}
        </code>
        <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={() => setRevealed((r) => !r)}>
          {revealed ? <EyeOff size={12} /> : <Eye size={12} />} {revealed ? "Hide" : "Reveal"}
        </button>
        <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={handleCopy}>
          <Copy size={12} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function LiveControlRoom({ eventId, pageState }: LiveControlRoomProps) {
  const [status, setStatus] = useState<LivestreamStatus | null>(null);
  const [youtubeWatchUrl, setYoutubeWatchUrl] = useState<string | null>(null);
  const [youtubeInput, setYoutubeInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [oneTimeCredentials, setOneTimeCredentials] = useState<OneTimeCredentials | null>(null);
  const [recording, setRecording] = useState<ProviderRecordingView | null>(null);

  async function reload() {
    try {
      const data = await fetchLivestreamStatus(authFetch, eventId);
      setStatus(data.status);
      setYoutubeWatchUrl(data.youtubeWatchUrl);
      setYoutubeInput(data.youtubeWatchUrl ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    try {
      setRecording(await fetchRecordingView(authFetch, eventId));
    } catch {
      // Recording state is supplementary to the live control surface above —
      // a failed lookup here must not block or blank out the rest of the
      // page, so it is left at its previous value (initially null, rendered
      // as "not measured yet" below) rather than surfacing a second error banner.
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function handleEnable() {
    setBusy(true);
    setError(null);
    try {
      const result = await enableLivestream(authFetch, eventId);
      setOneTimeCredentials(result);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleEnd() {
    setBusy(true);
    setError(null);
    try {
      await endLivestream(authFetch, eventId);
      setOneTimeCredentials(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveYoutube() {
    setBusy(true);
    setError(null);
    try {
      await updateYoutubeWatchUrl(authFetch, eventId, youtubeInput.trim() || null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const isDraft = pageState === "draft";
  const enableLabel = isDraft ? "Start Test Stream" : "Enable Private Livestream";

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)", fontSize: "13px" }}>
          {error}
        </div>
      )}

      <div className="ec-card space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="ec-section-title flex items-center gap-2">
            <Radio size={16} /> Private Livestream
          </h3>
          <span
            className="ec-badge"
            style={{
              color: status?.enabled ? "var(--success, #16a34a)" : "var(--text-secondary)",
            }}
          >
            {status === null ? "Loading…" : status.enabled ? "Enabled" : "Disabled"}
          </span>
        </div>

        {isDraft && (
          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            This event's page is still a Draft, so guests cannot reach it yet — starting the stream now is a private
            test. Nothing is publicly visible until you Publish the page.
          </p>
        )}

        {status && !status.enabled && (
          <button type="button" className="ec-btn ec-btn-primary" disabled={busy} onClick={handleEnable}>
            {enableLabel}
          </button>
        )}

        {status && status.enabled && (
          <>
            <div className="flex flex-col gap-3">
              {oneTimeCredentials ? (
                <>
                  <MaskedField label="Stream URL" value={oneTimeCredentials.streamUrl} />
                  <MaskedField label="Stream Key" value={oneTimeCredentials.streamKey} />
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                    In OBS (or any RTMP encoder), choose the &quot;Custom&quot; service and paste these two values
                    exactly as shown into the plain &quot;Server&quot; and &quot;Stream Key&quot; fields — do not
                    combine, edit, or reorder them. The Stream Key is shown only once, right now. It is not stored
                    anywhere in a form that can be shown again — copy it into your encoder before leaving this page.
                    If you lose it, End Stream and start again to get a new one.
                  </p>
                </>
              ) : (
                status.streamUrl && (
                  <>
                    <MaskedField label="Stream URL" value={status.streamUrl} />
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      This is your encoder&apos;s &quot;Server&quot; value. The Stream Key was shown only once, when
                      this stream was enabled, and cannot be shown again here. If you no longer have it, End Stream
                      and enable it again to get a new Server + Stream Key pair.
                    </p>
                  </>
                )
              )}
            </div>

            <div className="flex gap-4 flex-wrap" style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              <span>Publish window ends: {status.publishWindowEndAt ?? "—"}</span>
              <span>Last updated: {status.updatedAt ?? "—"}</span>
            </div>

            <button type="button" className="ec-btn ec-btn-secondary" disabled={busy} onClick={handleEnd}>
              End Stream
            </button>
          </>
        )}
      </div>

      <div className="ec-card space-y-2">
        <h3 className="ec-section-title">Technical stream metrics</h3>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          Resolution, FPS, video/audio bitrate, codecs, duration, reconnect count, and current/peak viewers have no
          authoritative source yet in the current SRS/Media Agent integration — shown here as unmeasured rather than
          guessed, per the "no fake stream health" rule.
        </p>
        <div className="flex flex-wrap gap-3" style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
          {["Resolution", "FPS", "Video bitrate", "Audio bitrate", "Codecs", "Duration", "Reconnects", "Viewers"].map(
            (metric) => (
              <span key={metric} className="ec-badge" style={{ color: "var(--text-tertiary)" }}>
                {metric}: Not yet measured
              </span>
            )
          )}
        </div>
      </div>

      <div className="ec-card space-y-2">
        <h3 className="ec-section-title flex items-center gap-2">
          <Video size={16} /> YouTube destination
        </h3>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          Manually link a YouTube Live watch page (Baseline YTB-003). This is a link only — it does not relay your
          stream to YouTube and never carries YouTube ingest credentials. OAuth-connected channel destinations are
          not implemented yet.
        </p>
        <div className="flex gap-2 flex-wrap items-center">
          <input
            type="url"
            value={youtubeInput}
            onChange={(e) => setYoutubeInput(e.target.value)}
            placeholder="https://youtube.com/watch?v=…"
            className="ec-input"
            style={{ flex: "1 1 280px", fontSize: "13px" }}
          />
          <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" disabled={busy} onClick={handleSaveYoutube}>
            Save
          </button>
        </div>
        {youtubeWatchUrl && (
          <a href={youtubeWatchUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px" }}>
            Open current link ↗
          </a>
        )}
      </div>

      <div className="ec-card space-y-2">
        <h3 className="ec-section-title">Recording &amp; replay</h3>
        {recording === null ? (
          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Loading…</p>
        ) : (
          <>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
              {recording.replayStatus === "available" &&
                "The finalized recording is available as an automatic replay on this event's page once the live stream ends."}
              {recording.replayStatus === "processing" &&
                "The recording is being finalized and verified. It will become an automatic replay on this event's page once that completes — this can take a while and does not affect the live stream."}
              {recording.replayStatus === "failed" &&
                "Recording finalization failed for this event. Contact Support if you expected a replay."}
              {recording.replayStatus === "not_available" &&
                "No recording exists for this event yet — one is created automatically the first time you stream."}
            </p>
            {recording.retentionExpiresAt && (
              <p style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                Hosted replay available until {new Date(recording.retentionExpiresAt).toLocaleDateString()}.
                {recording.youtubeFallbackAvailable
                  ? " A verified YouTube replay will automatically take over after that."
                  : ""}
              </p>
            )}
          </>
        )}
      </div>

      <div className="ec-card space-y-2">
        <h3 className="ec-section-title flex items-center gap-2">
          <LifeBuoy size={16} /> Need help right now?
        </h3>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          Opens a Support ticket already linked to this event, marked Urgent Live Support.
        </p>
        <Link
          href={`/support?eventId=${encodeURIComponent(eventId)}&category=urgent_live`}
          className="ec-btn ec-btn-secondary ec-btn-sm"
        >
          <LifeBuoy size={14} /> Urgent Live Support
        </Link>
      </div>
    </div>
  );
}
