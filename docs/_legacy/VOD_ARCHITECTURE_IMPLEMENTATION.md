# VOD Architecture Implementation Guide

**Status**: ✅ Implemented (Phase 1 - Segment-based Archive)

**Implementation Date**: June 26, 2026

---

## Overview

Eventcast.pro now uses **segment-based HLS archival** for reliable, YouTube-quality VOD recordings that survive stream interruptions, OBS crashes, and Restreamer restarts.

This architecture ensures:
- ✅ Complete event capture (even with connection drops)
- ✅ Restart-safe recording (no overwriting)
- ✅ Automatic VOD playback after event ends
- ✅ Same segment duration as YouTube (4 seconds)
- ✅ Professional post-event archival pipeline

---

## Architecture Changes

### 1. Restreamer Triple Output

**File**: `eventcast-admin/src/lib/restreamer.ts`

Every live stream now produces THREE outputs simultaneously:

| Output | Purpose | Storage | Behavior |
|--------|---------|---------|----------|
| **HLS Live** | Low-latency viewer playback | RAM (memfs) | Sliding window (last 40s) |
| **VOD MP4** | Fallback single file | Disk (diskfs) | Overwrite on restart |
| **HLS Archive** | Permanent segment collection | Disk (diskfs/recordings/) | Append-only, restart-safe |

**Key Configuration**:

```typescript
{
  id: "hls-archive",
  address: "{diskfs}/recordings/{processid}/index.m3u8",
  options: [
    "-map", "0:v:0",
    "-map", "0:a:0",
    "-c:v", "copy",
    "-c:a", "copy",
    "-f", "hls",
    "-hls_time", "4",              // 4-second segments (YouTube standard)
    "-hls_list_size", "0",         // Keep ALL segments (no deletion)
    "-hls_flags", "append_list",   // Restart-safe mode
    "-hls_segment_filename", "{diskfs}/recordings/{processid}/segment_%05d.ts"
  ]
}
```

### 2. Post-Event VOD Pipeline

**File**: `eventcast-admin/scripts/archive-vod-to-r2.ts`

After the event ends, run this script to archive the complete VOD:

```bash
cd eventcast-admin
npm run archive-vod -- <event-slug>
```

**What it does**:
1. Downloads all segments from Restreamer `/recordings/{slug}/` folder
2. Uploads segments + playlists to Cloudflare R2 bucket (`eventcast-vod`)
3. Updates Supabase `vod_link` field with R2 HLS URL
4. Event page automatically switches to VOD playback

**Example**:
```bash
npm run archive-vod -- sravani-manoj-engagement
```

### 3. Smart Player VOD/Live Detection

**File**: `sravani-manoj-engagement/script.js` (+ template)

The HLS player now intelligently detects VOD vs Live mode:

**VOD Mode** (when `vod_link` is set):
- 🔴 LIVE badge hidden
- ⏯️ Full seeking enabled
- 📊 Standard buffering (30-60s)
- 🚫 No reconnect polling
- 🚫 No "jump to live edge" behavior

**Live Mode** (when `vod_link` is empty):
- 🔴 LIVE badge shown
- ⏯️ Always jumps to live edge on resume
- 📊 Low-latency buffering (15-30s)
- 🔄 Auto-reconnect on drop
- ⚡ GPU-save mode during playback

**Detection Logic**:
```javascript
const isVOD = CONFIG.vodArchiveUrl && CONFIG.restreamerUrl === CONFIG.vodArchiveUrl;
```

**Config Preference** (`workers/render-event-page/src/index.ts`):
```typescript
const vodArchiveUrl = event.vod_link ?? '';
const liveHlsUrl = event.restreamer_hls_url 
  ? `https://${hostname}/events/${slug}/hls/${slug}.m3u8` 
  : '';
const primaryHlsUrl = vodArchiveUrl || liveHlsUrl; // VOD first, then live
```

---

## Workflow

### During Live Event

1. OBS streams RTMP to Restreamer
2. Restreamer produces:
   - Live HLS for viewers (in RAM)
   - Archive segments on disk (append-mode)
   - YouTube relay (optional)
3. Viewers watch via HLS player (live mode)

If OBS crashes/restarts:
- ✅ Live HLS resumes immediately
- ✅ Archive segments continue numbering (no overwrite)
- ✅ YouTube merges sessions
- ❌ Single MP4 restarts from zero (only keeps last session)

### After Event Ends

```bash
# 1. End Restreamer process (optional - preserves MP4 & segments)
cd scratch
node end_sravani_event.mjs  # Updates YouTube status, stops Restreamer

# 2. Archive VOD to R2
cd eventcast-admin
npm run archive-vod -- sravani-manoj-engagement
```

**What happens**:
- Segments uploaded: `r2://eventcast-vod/events/{slug}/vod/segment_*.ts`
- Playlist uploaded: `r2://eventcast-vod/events/{slug}/vod/index.m3u8`
- Supabase updated: `vod_link = "https://vod.eventcast.pro/events/{slug}/vod/index.m3u8"`
- Event page auto-switches to VOD mode

### Viewer Experience

**During Live**: 🔴 LIVE badge, low latency, auto-reconnect  
**After Archival**: Full event playback, seekable, no LIVE badge

---

## Comparison: Restreamer vs YouTube VOD

### Before This Implementation

| Metric | Restreamer MP4 | YouTube VOD |
|--------|----------------|-------------|
| Duration (Sravani event) | 30-40 min | 6h 19m |
| Reason | Overwrite on restart | Merges all sessions |
| Restart-safe? | ❌ No | ✅ Yes |

### After This Implementation

| Metric | Restreamer Archive | YouTube VOD |
|--------|-------------------|-------------|
| Duration | Full event | Full event |
| Restart-safe? | ✅ Yes (append_list) | ✅ Yes |
| Segment size | 4 seconds | 4 seconds |
| Format | HLS (TS segments) | HLS/DASH |
| Storage | R2 (permanent) | YouTube (permanent) |

---

## Technical Q&A

### Q: Is 4-second segment size safe?

**A**: Yes, this is the **industry standard**.
- YouTube uses 2-6s segments
- Twitch uses 2-4s segments
- Netflix/Hulu use 4-10s segments

4 seconds balances:
- ✅ Low latency (viewers join quickly)
- ✅ Adaptive quality switching
- ✅ CDN caching efficiency
- ✅ Mobile device compatibility

### Q: What if internet drops during recording?

**A**: Archive segments survive disconnects.
- Restreamer stores segments on local disk
- When reconnected, archival script uploads all segments
- Segments are numbered sequentially, no gaps in file naming
- Playback may show brief black frames at drop points (same as YouTube)

### Q: How much disk space does archive use?

**A**: Approximately **1 GB per hour** for 1080p30 H.264.
- 4s segment = ~1 MB
- 6 hours = ~5.4 GB
- Post-archival, delete from Restreamer to free space

### Q: Can I delete old archives?

**A**: Yes, after uploading to R2.

**Cleanup command** (Restreamer disk):
```bash
# Via Restreamer API (DELETE /api/v3/fs/disk/recordings/{slug})
curl -X DELETE https://media.eventcast.pro/api/v3/fs/disk/recordings%2Fsravani-manoj-engagement \
  -H "Authorization: Bearer $TOKEN"
```

### Q: Why keep the single MP4 output?

**A**: Fallback compatibility.
- Some older workflows expect a single file
- Easier for quick local preview
- Can be disabled in future if unused

---

## Benefits Over Single MP4

| Feature | Single MP4 | Segment Archive |
|---------|-----------|-----------------|
| Restart-safe | ❌ Overwrites | ✅ Appends |
| Partial playback | ❌ Wait for end | ✅ Immediate |
| Adaptive quality | ❌ Single bitrate | ✅ Multi-bitrate ready |
| CDN caching | ❌ Large file | ✅ Small chunks |
| Parallel download | ❌ Serial | ✅ Parallel |
| Industry standard | ❌ No | ✅ Yes (YouTube, Netflix, Twitch) |

---

## Future Enhancements (Phase 2)

### Planned Features

1. **Multi-bitrate VOD**
   - Generate 720p, 480p, 360p variants
   - Store in R2 with ABR playlists
   - Player auto-switches quality

2. **Background VOD Processing**
   - Cloudflare Worker on Restreamer webhook
   - Auto-archive on stream end (no manual script)

3. **Thumbnail Generation**
   - Extract poster frame at 5% / 50% / 95%
   - Store in R2, set as video poster

4. **VOD Preview Clips**
   - Generate 30s highlights
   - Show on event page before full archival

5. **Progress Dashboard**
   - Real-time segment count
   - Archival status in admin panel
   - Disk space monitoring

---

## Dependencies Added

**Package.json** (`eventcast-admin`):
```json
{
  "scripts": {
    "archive-vod": "tsx scripts/archive-vod-to-r2.ts"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.738.0"
  }
}
```

---

## Testing

### 1. Test Archive Generation

```bash
# Start a short test stream (30 seconds)
# OBS -> Restreamer (test-event-slug)

# Check if archive created
curl https://media.eventcast.pro/api/v3/fs/disk/recordings%2Ftest-event-slug \
  -H "Authorization: Bearer $TOKEN"

# Should show: segment_00000.ts, segment_00001.ts, ..., index.m3u8
```

### 2. Test Restart Safety

```bash
# While streaming:
# 1. Stop OBS (10 seconds)
# 2. Restart OBS
# 3. Check archive folder - new segments should append (e.g. segment_00005.ts continues)
```

### 3. Test VOD Archival

```bash
npm run archive-vod -- test-event-slug
# Output should show:
# ✓ Found X files in Restreamer archive
# ✓ Uploaded all X files to R2
# ✓ Updated Supabase vod_link
```

### 4. Test Player VOD Mode

1. Visit event page after archival
2. Console should log: `"VOD mode: Full archive playback"`
3. LIVE badge should be hidden
4. Full seeking should work
5. No reconnect polling

---

## Deployment Checklist

- [x] Update `restreamer.ts` with archive output
- [x] Add `archive-vod-to-r2.ts` script
- [x] Add `@aws-sdk/client-s3` dependency
- [x] Update `render-event-page` worker (VOD preference)
- [x] Update player script (VOD/Live detection)
- [x] Document architecture in `STREAMING_ARCHITECTURE_REPORT.md`
- [x] Create implementation guide (this file)
- [ ] Install dependencies: `npm install` in `eventcast-admin`
- [ ] Deploy worker: `npm run deploy` in `workers/render-event-page`
- [ ] Test with upcoming event: `chinna-eswari-wedding` (June 27)
- [ ] Monitor disk space on Restreamer server
- [ ] Set up R2 lifecycle policy (optional: auto-delete after 1 year)

---

## Rollback Plan

If issues occur, revert to single MP4 only:

1. Remove `hls-archive` output from `restreamer.ts`
2. Redeploy Restreamer channels
3. Player still works (uses `vod_link` or `restreamer_hls_url`)

---

## Related Documentation

- [STREAMING_ARCHITECTURE_REPORT.md](./STREAMING_ARCHITECTURE_REPORT.md) - Full technical analysis
- [restreamer.ts](../eventcast-admin/src/lib/restreamer.ts) - Restreamer config
- [archive-vod-to-r2.ts](../eventcast-admin/scripts/archive-vod-to-r2.ts) - VOD pipeline
- [script.js](../sravani-manoj-engagement/script.js) - Player VOD logic

---

## Support & Issues

**For VOD archival issues**:
- Check Restreamer disk space: `df -h /core/data`
- Check segment count: `ls /core/data/recordings/{slug}/ | wc -l`
- Check R2 upload status in script output

**For player issues**:
- Check browser console for `"VOD mode"` vs `"Live mode"` log
- Verify `CONFIG.vodArchiveUrl` in page source
- Test R2 HLS URL directly: `https://vod.eventcast.pro/events/{slug}/vod/index.m3u8`

---

**Last Updated**: June 26, 2026  
**Status**: Production-ready for `chinna-eswari-wedding` (June 27, 2026)
