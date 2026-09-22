"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, Copy, Eye, EyeOff, Film, Gauge, LifeBuoy, Radio, Video } from "lucide-react";
import { authFetch } from "@/lib/client-auth";
import {
  enableLivestream,
  endLivestream,
  fetchLivestreamStatus,
  fetchLivestreamTelemetry,
  isAvailable,
  updateYoutubeWatchUrl,
  type LivestreamStatus,
  type LivestreamTechnical,
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
    <div className="ec-credential-field">
      <span className="ec-credential-field-label">{label}</span>
      <div className="ec-credential-field-row">
        <code className="ec-credential-field-value">{revealed ? value : maskValue(value)}</code>
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

/** One label/value pair in the technical stream metrics grid. `text === null` renders the shared "Not measured" state. */
function TechnicalField({ label, text }: { label: string; text: string | null }) {
  return (
    <div>
      <div
        style={{
          color: "var(--text-tertiary)",
          fontSize: "11px",
          textTransform: "uppercase",
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </div>
      <div style={{ color: text === null ? "var(--text-tertiary)" : "var(--text-primary)" }}>
        {text ?? "Not measured"}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function LiveControlRoom({ eventId, pageState }: LiveControlRoomProps) {
  const [status, setStatus] = useState<LivestreamStatus | null>(null);
  const [youtubeWatchUrl, setYoutubeWatchUrl] = useState<string | null>(null);
  const [youtubeInput, setYoutubeInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [oneTimeCredentials, setOneTimeCredentials] = useState<OneTimeCredentials | null>(null);
  const [recording, setRecording] = useState<ProviderRecordingView | null>(null);
  const [technical, setTechnical] = useState<LivestreamTechnical | null>(null);
  const [technicalLoadState, setTechnicalLoadState] = useState<"loading" | "loaded" | "failed">("loading");

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
    try {
      const data = await fetchLivestreamTelemetry(authFetch, eventId);
      // "loaded" covers BOTH a healthy stream and a successful response
      // reporting no-signal/stale/missing telemetry — toProviderStreamTechnicalView
      // already renders that honestly via sourceHealth/UnavailableFact.
      // "failed" is reserved for an actual inability to reach this API.
      setTechnical(data.technical);
      setTechnicalLoadState("loaded");
    } catch {
      // Current technical telemetry must never keep showing an old
      // successful snapshot after a later fetch fails — that would
      // present stale data as current.
      setTechnical(null);
      setTechnicalLoadState("failed");
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
      {error && <div className="ec-banner ec-banner-error">{error}</div>}

      <div className="ec-card space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="ec-section-title flex items-center gap-2">
            <Radio size={16} /> Private Livestream
          </h3>
          {status === null ? (
            <div className="ec-skeleton" style={{ width: "80px", height: "24px" }} />
          ) : (
            <span className={`ec-status-pill ${status.enabled ? "ec-status-pill--complete" : "ec-status-pill--optional"}`}>
              {status.enabled ? "Enabled" : "Disabled"}
            </span>
          )}
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

            <div>
              <div className="ec-detail-row">
                <span className="ec-detail-row-icon">
                  <Clock size={16} />
                </span>
                <div>
                  <div className="ec-detail-row-label">Publish window ends</div>
                  <div className="ec-detail-row-value">{status.publishWindowEndAt ?? "—"}</div>
                </div>
              </div>
              <div className="ec-detail-row">
                <span className="ec-detail-row-icon">
                  <Clock size={16} />
                </span>
                <div>
                  <div className="ec-detail-row-label">Last updated</div>
                  <div className="ec-detail-row-value">{status.updatedAt ?? "—"}</div>
                </div>
              </div>
            </div>

            <button type="button" className="ec-btn ec-btn-danger" disabled={busy} onClick={handleEnd}>
              End Stream
            </button>
          </>
        )}
      </div>

      <div className="ec-card space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="ec-section-title flex items-center gap-2">
            <Gauge size={16} /> Technical stream metrics
          </h3>
          {technicalLoadState === "loaded" && technical && (
            <span
              className={`ec-status-pill ${
                technical.sourceHealth === "good" ? "ec-status-pill--complete" : "ec-status-pill--optional"
              }`}
            >
              {technical.sourceHealth === "good" ? "Good" : "No signal"}
            </span>
          )}
        </div>

        {technicalLoadState === "loading" ? (
          <div className="ec-empty-state">
            <span className="ec-empty-state-icon">
              <Gauge size={22} />
            </span>
            <span className="ec-empty-state-title">Loading technical telemetry&hellip;</span>
          </div>
        ) : technicalLoadState === "failed" || technical === null ? (
          <div className="ec-empty-state">
            <span className="ec-empty-state-icon">
              <Gauge size={22} />
            </span>
            <span className="ec-empty-state-title">Technical telemetry is currently unavailable</span>
            <span className="ec-empty-state-sub">
              Technical telemetry could not be loaded right now. The rest of the Live Control Room is unaffected.
            </span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3" style={{ fontSize: "13px" }}>
              <TechnicalField
                label="Resolution"
                text={
                  isAvailable(technical.videoWidth) && isAvailable(technical.videoHeight)
                    ? `${technical.videoWidth}×${technical.videoHeight}`
                    : null
                }
              />
              <TechnicalField label="FPS" text={null} />
              <TechnicalField
                label="Video codec"
                text={isAvailable(technical.videoCodec) ? technical.videoCodec : null}
              />
              <TechnicalField
                label="Audio codec"
                text={isAvailable(technical.audioCodec) ? technical.audioCodec : null}
              />
              <TechnicalField
                label="Audio present"
                text={isAvailable(technical.audioPresent) ? (technical.audioPresent ? "Yes" : "No") : null}
              />
              <TechnicalField
                label="Ingest bitrate"
                text={isAvailable(technical.ingestKbpsRecv30s) ? `${Math.round(technical.ingestKbpsRecv30s)} kbps` : null}
              />
              <TechnicalField
                label="Captured bitrate (local only)"
                text={
                  isAvailable(technical.capturedSegmentBitrateKbps)
                    ? `${Math.round(technical.capturedSegmentBitrateKbps)} kbps`
                    : null
                }
              />
              <TechnicalField
                label="Publish duration"
                text={
                  isAvailable(technical.publishDurationSeconds)
                    ? formatDuration(technical.publishDurationSeconds)
                    : null
                }
              />
              <TechnicalField
                label="Reconnects"
                text={isAvailable(technical.reconnectCount) ? String(technical.reconnectCount) : null}
              />
              <TechnicalField
                label="YouTube relay"
                text={technical.relayStateWord === "youtube_enabled" ? "Enabled" : "Disabled"}
              />
            </div>
            <p style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
              Frame rate (FPS) has no source in this deployment and is never estimated. &ldquo;Captured
              bitrate&rdquo; is this node&rsquo;s own local capture rate only — it does not confirm delivery to R2,
              a CDN, or any viewer.
            </p>
          </>
        )}
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
        <h3 className="ec-section-title flex items-center gap-2">
          <Film size={16} /> Recording &amp; replay
        </h3>
        {recording === null ? (
          <div className="ec-skeleton" style={{ height: "20px" }} />
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
