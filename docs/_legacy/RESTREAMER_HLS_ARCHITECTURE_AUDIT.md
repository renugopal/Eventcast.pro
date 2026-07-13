# Restreamer & HLS Player Architecture - Complete Audit Report

**Date**: June 27, 2026  
**Events Audited**: `demo-groom-demo-bride-wedding`, `demo-celebrant-dhoti-ceremony`  
**Status**: ✅ Both streams LIVE and operational

---

## Executive Summary

Complete architecture audit conducted covering:
- ✅ Restreamer configuration and process health
- ✅ HLS streaming pipeline (ingest → output → delivery)
- ✅ Player implementation and recovery mechanisms
- ⚠️ Identified 8 potential issues requiring attention
- 🔧 Recommended 12 improvements for production reliability

**Current Status**: Both events are streaming successfully with all 4 outputs active (HLS live, MP4 VOD, HLS archive, YouTube relay). However, several architectural weaknesses could cause future failures.

---

## 1. Restreamer Configuration Audit

### Current Configuration

**Event**: `demo-groom-demo-bride-wedding`
```
State: running | Order: start
Config:
  ✅ Autostart: true
  ✅ Reconnect: true
  ✅ Options: ["-y"] (overwrite enabled)
  
Input:
  ✅ RTMP: {rtmp,name=demo-groom-demo-bride-wedding/live}
  ✅ Options: ["-fflags","+genpts"] (timestamp generation)
  
Outputs (4):
  1. ✅ hls (memfs) - Live sliding window
  2. ✅ vod-record (diskfs) - Single MP4 fallback
  3. ✅ hls-archive (diskfs) - Segment-based archive
  4. ✅ youtube - RTMP relay
  
Live Status:
  ✅ Video: h264 1920x1080 30.4fps 4.0Mbps
  ✅ Audio: aac 48000Hz 159kbps
  ✅ Inputs: 2 streams (healthy)
```

**Event**: `demo-celebrant-dhoti-ceremony`
```
State: running | Order: start
Config:
  ✅ Autostart: true
  ✅ Reconnect: true
  ✅ Options: ["-y"]
  
Live Status:
  ✅ Video: h264 1920x1080 29.7fps 3.4Mbps
  ✅ Audio: aac 48000Hz 160kbps
  ✅ Inputs: 2 streams (healthy)
```

### ✅ Strengths

1. **Triple Output Strategy**: Successfully configured
   - Live HLS (memfs) - ultra-low latency
   - MP4 VOD (diskfs) - single-file fallback
   - HLS Archive (diskfs) - restart-safe segmented recording

2. **Auto-recovery**: `reconnect: true` handles OBS disconnections

3. **Overwrite Protection**: `-y` flag prevents FFmpeg blocking on file conflicts

4. **Timestamp Repair**: `-fflags +genpts` handles irregular OBS timestamps

### ⚠️ Issues Identified

#### Issue #1: Missing Directory Pre-creation Logic
**Severity**: HIGH  
**Impact**: HLS archive silently fails if `/core/data/recordings/{slug}/` doesn't exist

**Current Behavior**:
- Restreamer starts FFmpeg with `{diskfs}/recordings/{processid}/index.m3u8`
- If directory doesn't exist, FFmpeg silently fails (no error, no segments)
- This happened during initial setup for both events

**Evidence**:
```typescript
// restreamer.ts:150
{
  "id": "hls-archive",
  "address": "{diskfs}/recordings/{processid}/index.m3u8",
  // FFmpeg will fail silently if parent dir doesn't exist
}
```

**Fix Required**:
```typescript
// Before creating Restreamer process, ensure directory exists:
async ensureArchiveDirectory(slug: string) {
  const dirPath = `/core/data/recordings/${slug}`;
  await this.execInContainer(`mkdir -p ${dirPath}`);
}
```

**Recommendation**: Add pre-flight check in `setupChannel()` before submitting process config.

---

#### Issue #2: No Disk Space Monitoring in Restreamer Layer
**Severity**: MEDIUM  
**Impact**: Restreamer will crash or corrupt files if disk fills during event

**Current State**:
- VOD uploader has disk monitoring (`DISK_WARN_PERCENT`)
- But Restreamer itself has no safeguards
- If uploader fails and disk fills, FFmpeg outputs will fail

**Recommendation**:
1. Add pre-stream disk check in admin panel
2. Alert operator if <20GB free before starting stream
3. Consider emergency circuit breaker: stop recording if <5GB free

---

#### Issue #3: YouTube Stream Key Exposure
**Severity**: LOW (security)  
**Impact**: Stream keys visible in Restreamer config API responses

**Current Behavior**:
```json
{
  "id": "youtube",
  "address": "rtmp://a.rtmp.youtube.com/live2/<REDACTED_YOUTUBE_STREAM_KEY>"
}
```

**Recommendation**:
- Store keys in Supabase `youtube_stream_key` (encrypted)
- Never log full RTMP URLs
- Rotate keys after each event

---

#### Issue #4: No Process Health Monitoring
**Severity**: MEDIUM  
**Impact**: Silent failures go undetected; operator unaware until viewer reports

**Current State**:
- `RestreamerClient.getProcessHealth()` exists but not actively used
- No automated alerts for:
  - Bitrate drops to 0 (encoder disconnected)
  - Process state changes to 'failed' or 'idle'
  - Output failures (YouTube relay down, HLS archive stalled)

**Recommendation**:
Implement cron job (every 60 seconds during live events):
```typescript
// Check all active events
const health = await restreamer.getProcessHealth(slug);
if (health.bitrateKbps === 0 && health.state === 'running') {
  // Alert: "Stream running but no input signal"
}
if (health.state === 'failed') {
  // Alert: "Restreamer process crashed"
}
```

---

## 2. HLS Streaming Pipeline Audit

### Data Flow

```
┌─────────────┐
│ OBS Studio  │ RTMP 4Mbps
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────────────────┐
│ Restreamer (GCP VM: eventcast-vm)                │
│                                                   │
│  FFmpeg Outputs:                                 │
│  1. memfs/{slug}.m3u8  ───────────────┐         │
│  2. diskfs/{slug}.mp4                  │         │
│  3. diskfs/recordings/{slug}/index.m3u8 │        │
│  4. rtmp://youtube/live2/{key}          │        │
└──────────────────────────────┬──────────┘        │
                               │                    │
       ┌───────────────────────┴────────────┐      │
       │                                     │      │
       ▼                                     ▼      ▼
┌────────────────┐                  ┌──────────────────┐
│ media.event... │ Direct CDN       │ YouTube CDN      │
│ /memfs/{slug}  │                  │                  │
└────────┬───────┘                  └──────────────────┘
         │
         │ Proxied by Cloudflare Worker
         ▼
┌────────────────────────────────────┐
│ eventcast.pro/events/{slug}/hls/*  │
└────────┬───────────────────────────┘
         │
         ▼
┌─────────────────────┐
│ HLS.js Player       │
│ (Browser)           │
└─────────────────────┘
```

### ✅ Strengths

1. **Dual-path Delivery**: Direct CDN + proxied through Cloudflare
2. **CORS Handled**: Worker proxy eliminates cross-origin issues
3. **Low Latency**: memfs → CDN → Cloudflare is <5 seconds end-to-end

### ⚠️ Issues Identified

#### Issue #5: HLS Proxy Lacks Error Handling
**Severity**: MEDIUM  
**Impact**: 502/503 errors not gracefully handled; player gets raw error

**Current Code**:
```typescript
// workers/render-event-page/src/index.ts:406
async function proxyHlsAsset(assetPath: string, search: string): Promise<Response> {
  const upstream = `https://media.eventcast.pro/memfs/${assetPath}${search}`;
  const upstreamRes = await fetch(upstream, {
    headers: { Accept: '*/*' },
    cf: { cacheTtl: 0 },
  });

  if (!upstreamRes.ok) {
    return new Response(upstreamRes.body, { 
      status: upstreamRes.status, 
      statusText: upstreamRes.statusText 
    });
  }
  // ...
}
```

**Problem**: If Restreamer is down, player gets raw 502/404 → fatal HLS.js error → player stuck

**Recommendation**:
```typescript
if (!upstreamRes.ok) {
  // Log error for monitoring
  console.error(`[HLS Proxy] ${assetPath} failed: ${upstreamRes.status}`);
  
  // Return player-friendly error for manifest requests
  if (assetPath.endsWith('.m3u8')) {
    return new Response(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=0\noffline.m3u8',
      { 
        status: 200, // Don't fail player, let it retry
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl' }
      }
    );
  }
  
  return new Response(upstreamRes.body, { status: upstreamRes.status });
}
```

---

#### Issue #6: Cache Headers Not Optimal
**Severity**: LOW  
**Impact**: Unnecessary origin requests, higher latency

**Current**:
```typescript
headers: {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
}
```

**Problem**: Every segment fetch bypasses CDN cache → higher load on Restreamer

**Recommendation**:
```typescript
// For .ts segments (immutable once written)
if (assetPath.endsWith('.ts')) {
  headers['Cache-Control'] = 'public, max-age=86400, immutable';
}

// For .m3u8 playlists (need frequent updates)
if (assetPath.endsWith('.m3u8')) {
  headers['Cache-Control'] = 'public, max-age=2, stale-while-revalidate=10';
}
```

---

## 3. HLS Player Implementation Audit

### Player Architecture

**HLS.js Version**: `@latest` (loaded from CDN)
⚠️ **Issue**: No version pinning; breaking changes possible

**Configuration**:
```javascript
new Hls({ 
  capLevelToPlayerSize: true,      // ✅ Good: adaptive quality
  maxBufferLength: 15,              // ✅ Good: 15s buffer
  maxMaxBufferLength: 30,           // ✅ Good: max 30s
  liveSyncDurationCount: 2,         // ✅ Good: stay near live edge
  liveMaxLatencyDurationCount: 6,   // ✅ Good: max 24s behind
  backBufferLength: 0,              // ✅ Good: no memory bloat
  startPosition: -1,                // ✅ Good: start at live edge
  enableWorker: true,               // ✅ Good: offload to Web Worker
  lowLatencyMode: false             // ⚠️ Consider: could enable for <2s latency
});
```

### Recovery Mechanisms

**Three-Layer Protection**:

1. **Layer 1: Template Script Heartbeat** (`script.js:748`)
   - Checks every 10 seconds
   - Detects: `video.paused || readyState < 2 || currentTime === 0`
   - Action: `destroyHls() → showLoader() → startPolling()`

2. **Layer 2: Worker Emergency Fix** (`index.ts:665`)
   - Injected inline script (loads before everything)
   - Checks every 12 seconds
   - Detects: `readyState < 2 || (paused && currentTime === 0)`
   - Action: Force page reload with `?_recover={timestamp}`

3. **Layer 3: HLS.js Error Handling** (`script.js:823`)
   - `NETWORK_ERROR` → retry with polling
   - `MEDIA_ERROR` → `hls.recoverMediaError()`
   - Other → destroy and recreate player

### ✅ Strengths

1. **Redundant Recovery**: Multiple independent systems
2. **Clean State Management**: `destroyHls()` properly clears intervals
3. **Stream Warmup Detection**: Handles "warming" phase gracefully

### ⚠️ Issues Identified

#### Issue #7: HLS.js Version Not Pinned
**Severity**: HIGH  
**Impact**: Automatic CDN updates could break player mid-event

**Current**:
```html
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
```

**Risk**: If HLS.js releases v1.6.0 with breaking changes during live event, all viewers get broken player

**Recommendation**:
```html
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js"></script>
```
(Pin to tested version)

**Action Required**:
1. Update worker template injection
2. Test with pinned version
3. Add version to `.env` for easy updates

---

#### Issue #8: Player Reload Loop Risk
**Severity**: MEDIUM  
**Impact**: If stream permanently fails, player enters infinite reload loop

**Current Behavior**:
- Worker recovery fix reloads page every 12s if stuck
- No circuit breaker; could reload 1000+ times

**Evidence**:
```javascript
// index.ts:680
setInterval(function() {
  const isStuck = video.readyState < 2 || (video.paused && video.currentTime === 0);
  if (isStuck && window.WEDDING_CONFIG && window.WEDDING_CONFIG.restreamerUrl) {
    window.location.href = currentUrl + separator + '_recover=' + Date.now();
  }
}, 12000);
```

**Problem**: No check for repeated failures

**Recommendation**:
```javascript
let reloadCount = parseInt(localStorage.getItem('_eventcast_reload_count') || '0');
const lastReload = parseInt(localStorage.getItem('_eventcast_last_reload') || '0');

// Reset counter if >5 minutes since last reload (stream recovered)
if (Date.now() - lastReload > 300000) reloadCount = 0;

if (isStuck && reloadCount < 5) {
  reloadCount++;
  localStorage.setItem('_eventcast_reload_count', reloadCount);
  localStorage.setItem('_eventcast_last_reload', Date.now());
  window.location.href = currentUrl + separator + '_recover=' + Date.now();
} else if (reloadCount >= 5) {
  // Circuit breaker: stop reloading, show error
  console.error('[Recovery Fix] Circuit breaker: stream permanently failed');
  // Optionally: redirect to YouTube fallback
}
```

---

#### Issue #9: No Visibility into Player Errors
**Severity**: LOW  
**Impact**: Operators can't diagnose player issues reported by users

**Current State**:
- All errors logged to browser console
- No telemetry, no server-side logging

**Recommendation**:
Add lightweight error reporting:
```javascript
hls.on(Hls.Events.ERROR, function(event, data) {
  if (data.fatal) {
    // Send to admin monitoring endpoint
    fetch('/api/player-error', {
      method: 'POST',
      body: JSON.stringify({
        slug: CONFIG.slug,
        errorType: data.type,
        errorDetails: data.details,
        userAgent: navigator.userAgent,
        timestamp: Date.now()
      })
    }).catch(() => {}); // Fire-and-forget
  }
});
```

---

## 4. VOD Archival System Audit

### Architecture

```
┌──────────────────────────────────────┐
│ Restreamer                           │
│ /core/data/recordings/{slug}/        │
│   ├── index.m3u8                     │
│   ├── segment_00001.ts               │
│   ├── segment_00002.ts               │
│   └── ...                            │
└──────────────┬───────────────────────┘
               │
               │ Poll every 4 seconds
               ▼
┌──────────────────────────────────────┐
│ live-uploader.mjs (systemd service)  │
│ - List new segments                  │
│ - Download from Restreamer           │
│ - Upload to R2                       │
│ - Verify size match                  │
│ - Mark uploaded in state file        │
│ - Delete local .ts (keep .m3u8)      │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ Cloudflare R2                        │
│ vod/{slug}/                          │
│   ├── index.m3u8                     │
│   ├── segment_00001.ts               │
│   └── ...                            │
└──────────────────────────────────────┘
```

### ✅ Strengths

1. **Retry Logic**: 5 attempts with exponential backoff
2. **Verify-Before-Delete**: Size check prevents data loss
3. **State Tracking**: `.uploaded` files prevent re-upload
4. **Disk Monitoring**: Warns at 75% usage

### ⚠️ Issues Identified

#### Issue #10: Environment Variable Loading (CRITICAL - ALREADY IDENTIFIED)
**Severity**: CRITICAL  
**Impact**: VOD uploader service not uploading (already being fixed)

**Status**: 🔧 Fix in progress (see previous conversation)

**Root Cause**:
```javascript
// Old (fails in systemd):
import 'dotenv/config';

// New (works):
import { config } from 'dotenv';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });
```

---

#### Issue #11: No Upload Progress Visibility
**Severity**: LOW  
**Impact**: Operator can't tell if VOD archival is working during event

**Current State**:
- Logs written to systemd journal
- No web dashboard, no Supabase updates

**Recommendation**:
```javascript
// Update Supabase event row periodically
await supabase.from('events').update({
  vod_segments_uploaded: totalSegments,
  vod_last_upload_at: new Date().toISOString()
}).eq('slug', slug);
```

Then add to admin panel:
```
Event: demo-groom-demo-bride-wedding
Status: 🔴 LIVE
VOD Archive: ✅ 342 segments uploaded (last: 2s ago)
```

---

#### Issue #12: No Bandwidth Throttling
**Severity**: LOW  
**Impact**: VOD uploads could saturate uplink, affect live stream quality

**Current State**:
- Uploads happen as fast as possible
- No rate limiting

**Recommendation**:
```javascript
// Add delay between uploads to cap bandwidth
const UPLOAD_DELAY_MS = 500; // ~16Mbps max for 8MB segments
await uploadWithRetry(slug, file.name, body);
await sleep(UPLOAD_DELAY_MS);
```

---

## 5. Critical Production Recommendations

### Immediate Actions (Before Next Event)

1. **Pin HLS.js Version** (Issue #7)
   - Change `@latest` to `@1.5.8`
   - Deploy worker immediately

2. **Add Directory Pre-creation** (Issue #1)
   - Update `setupChannel()` in `restreamer.ts`
   - Test with new event slug

3. **Add Circuit Breaker to Player** (Issue #8)
   - Implement 5-reload limit
   - Deploy worker update

4. **Complete VOD Uploader Fix** (Issue #10)
   - Already in progress
   - Verify `.env` loading works

### Short-term Improvements (Next Week)

5. **Implement Process Health Monitoring** (Issue #4)
   - Create cron job in admin panel
   - Alert via Supabase realtime

6. **Add Player Error Telemetry** (Issue #9)
   - Create `/api/player-error` endpoint
   - Store in Supabase for analysis

7. **Improve HLS Proxy Error Handling** (Issue #5)
   - Graceful degradation for offline streams
   - Better error messages to player

8. **Add Disk Space Pre-flight Check** (Issue #2)
   - Check before starting stream
   - Block if <20GB free

### Long-term Optimizations

9. **Optimize Cache Headers** (Issue #6)
   - Reduce CDN origin requests
   - Improve playback latency

10. **Add VOD Upload Dashboard** (Issue #11)
    - Real-time segment count
    - Upload health indicator

11. **Implement Bandwidth Throttling** (Issue #12)
    - Prevent VOD uploads from affecting live

12. **Rotate YouTube Keys** (Issue #3)
    - Store encrypted in Supabase
    - Auto-rotate post-event

---

## 6. Testing Checklist

Before considering architecture production-ready:

### Restreamer Tests
- [ ] Test HLS archive with pre-existing `/recordings/{slug}/` directory
- [ ] Test HLS archive when directory doesn't exist (should auto-create)
- [ ] Test disk full scenario (Restreamer should gracefully stop recording)
- [ ] Test YouTube relay failure (main stream should continue)
- [ ] Test OBS reconnect after 60s disconnect

### Player Tests
- [ ] Test HLS.js with pinned version (not @latest)
- [ ] Test recovery after Restreamer restart (should reload and resume)
- [ ] Test recovery after network switch (cellular ↔ WiFi)
- [ ] Test circuit breaker (5 failed reloads should stop)
- [ ] Test player on low-bandwidth connection (3G simulation)

### VOD Tests
- [ ] Test uploader service with corrected `.env` loading
- [ ] Test upload retry after R2 503 error
- [ ] Test segment deletion after successful upload
- [ ] Test index.m3u8 upload (should never delete local copy during stream)
- [ ] Test state recovery after service restart

### End-to-End Tests
- [ ] Start stream → verify all 4 outputs active within 30s
- [ ] Disconnect OBS for 10s → verify auto-reconnect
- [ ] Stop stream → verify VOD immediately playable from R2
- [ ] Restart Restreamer during stream → verify HLS archive continues from last segment
- [ ] Fill disk to 95% → verify graceful degradation

---

## 7. Conclusion

### Overall Assessment: 🟡 FUNCTIONAL BUT NEEDS HARDENING

**What's Working Well**:
- ✅ Triple output strategy is solid
- ✅ Player recovery mechanisms are comprehensive
- ✅ YouTube relay is reliable
- ✅ Both events currently streaming without issues

**Critical Gaps**:
- 🔴 No automated health monitoring (silent failures possible)
- 🔴 HLS.js version not pinned (breaking changes risk)
- 🔴 Directory pre-creation logic missing
- 🟡 VOD uploader environment loading needs fix (in progress)
- 🟡 Player reload loop has no circuit breaker

**Next Steps**:
1. Implement 4 immediate fixes (Issues #1, #7, #8, #10)
2. Deploy to production before next event
3. Add health monitoring cron job
4. Create testing checklist and validate all scenarios

**Estimated Time to Production-Ready**: 4-6 hours of focused work

---

## Appendix A: Configuration Files Reference

### Restreamer Process Config
**File**: `eventcast-admin/src/lib/restreamer.ts:110-180`

### HLS Proxy Function
**File**: `workers/render-event-page/src/index.ts:406-428`

### Player Recovery Logic
**Files**:
- Template: `wedding-template-01/script.js:748-761`
- Worker: `workers/render-event-page/src/index.ts:665-705`

### VOD Uploader Service
**Files**:
- Script: `eventcast-admin/scripts/vod-uploader/live-uploader.mjs`
- Systemd: `eventcast-admin/scripts/vod-uploader/vod-uploader.service`

---

**Audit Completed**: June 27, 2026, 11:45 AM IST  
**Next Review**: After implementing immediate fixes (within 24 hours)
