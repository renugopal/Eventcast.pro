# Live Streaming Architecture: Complete Report
**Eventcast.pro — Current vs Recommended Design**

---

## 1. Current Architecture: How It Works Today

### Signal Flow
```
OBS (RTMP) 
    → Restreamer VM (FFmpeg) 
        → HLS (memfs, 10 segments × 4s)
        → VOD MP4 (disk, single file)
        → YouTube RTMP (continuous relay)
```

### Current Setup — What Happens

| Component | Behavior | Retention | Issue |
|-----------|----------|-----------|-------|
| **HLS (memfs)** | Live sliding window | Last ~40 seconds only | ❌ No full event recording |
| **VOD MP4 (disk)** | Single file, `-y` overwrite | Until next stream start | ❌ Each restart = previous lost |
| **YouTube** | Broadcast-level recording | Permanent VOD | ✅ Full 6h+ preserved |

### Why Restreamer Lost 6 Hours

**Problem:** Restreamer writes to **one filename**:
```
/core/data/sravani-manoj-engagement.mp4
```

**Timeline:**
1. **00:47** — Stream starts (5 min test) → writes MP4
2. **Stop → Restart** — FFmpeg crashes (file exists, no `-y`)
3. **Fix applied** — Delete old MP4 + add `-y` flag
4. **Restart** — **New MP4 starts from 0**, previous content **overwritten**
5. **08:39** — Stream ends → **only last session (~37 min) in MP4**

YouTube కి relay continuous గా వెళ్లింది (broadcast ID same) — అందుకే 6h 19m archive.

---

## 2. YouTube Architecture: Why It Works Perfectly

### YouTube Live Recording Model

```
OBS → RTMP → YouTube Ingest
                ↓
         [Broadcast Session Buffer]
                ↓
    Automatic chunked recording (internal)
                ↓
         YouTube VOD Storage
                ↓
    On "transition:complete" → VOD published
```

**Key differences:**

| Feature | YouTube | Our Restreamer |
|---------|---------|----------------|
| Recording scope | **Broadcast ID** (multi-session) | **Single file per process** |
| Restart handling | Appends to same broadcast | **Overwrites** previous file |
| Segment storage | Cloud (distributed chunks) | Local disk (single MP4) |
| VOD transition | **Automatic** on broadcast end | ❌ Manual upload needed |

**YouTube succeeds because:**
- RTMP relay = **broadcast-level persistence**
- Multiple disconnects/reconnects → same broadcast → **cumulative VOD**
- Cloud storage = no disk overwrite risk

---

## 3. HLS Segment-Based Recording: Industry Standard

### What Are HLS Segments?

HLS (HTTP Live Streaming) splits video into:
- **Master playlist** (`.m3u8`) — metadata
- **Media segments** (`.ts` files) — 2–10 second chunks

**Current HLS config:**
```typescript
{
  hls_time: 4,              // 4-second segments
  hls_list_size: 10,        // Keep only 10 segments
  hls_flags: "delete_segments"  // Auto-delete old ones
}
```

**This is LIVE-ONLY mode** — designed for minimal latency, not recording.

---

### Segment-Based Recording: The Right Way

**Industry approach** (Cloudflare Stream, Mux, AWS MediaLive):

```
FFmpeg → Continuous segment output
           ↓
    Append-only directory
           ↓
    segment_0000.ts (4s)
    segment_0001.ts (4s)
    segment_0002.ts (4s)
    ...
    segment_5479.ts (last segment)
           ↓
    Post-event: Concatenate all → single MP4
```

**Why this is better:**

| Benefit | Reason |
|---------|--------|
| **Restart-safe** | New segments = new filenames (no overwrite) |
| **Disk-efficient** | Write small chunks (4s), not monolithic file |
| **Crash-tolerant** | Only current 4s lost, not entire recording |
| **Seekable** | Each segment = independent decode point |

**4 seconds is SAFE** — standard for:
- YouTube uploads (segment size)
- Netflix origin (2–6s segments)
- Apple HLS guidelines (6s recommended, 2–10s range)

---

### Can HLS Segments Auto-Play as Single VOD?

**YES — with proper playlist.**

**Two approaches:**

#### A. **Event VOD Playlist** (post-live)
After stream ends, generate **complete manifest**:
```m3u8
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:4.0,
segment_0000.ts
#EXTINF:4.0,
segment_0001.ts
...
#EXTINF:3.5,
segment_5479.ts
#EXT-X-ENDLIST
```

Player (Plyr + Hls.js) చదివినప్పుడు → **full event sequential playback**.

#### B. **Post-process: Stitch to Single MP4**
```bash
ffmpeg -i complete_playlist.m3u8 -c copy output.mp4
```

Upload to R2 → serve single MP4 (no segments needed).

**Both work.** Option A = faster (no re-encode), Option B = single file (simpler delivery).

---

## 4. How Other Private Streaming Platforms Work

### A. **Mux (mux.com)**

**Architecture:**
```
RTMP → Mux Ingest
         ↓
   [Live Stream Object]
         ↓
   HLS segments → S3 (append-only)
         ↓
   On stream end:
     - Generate VOD asset (same segments)
     - Manifest switch: live → VOD
```

**Key:** Same segments used for **both live + VOD** — no re-encoding.

---

### B. **Cloudflare Stream**

**Architecture:**
```
Upload/RTMP → Stream API
                ↓
         [Distributed Ingest]
                ↓
    Edge storage (global segments)
                ↓
    HLS delivery (live + VOD unified)
                ↓
    Auto-archive after stream end
```

**Key:** Live segments **永久 saved** — VOD is just a different playlist pointing to same data.

---

### C. **AWS MediaLive + MediaPackage**

**Architecture:**
```
MediaLive (encoding) → MediaPackage (origin)
                            ↓
                    S3 bucket (segments)
                            ↓
                    CloudFront (CDN)
                            ↓
            Live HLS + Time-shifted VOD
```

**Key:** **Append-only S3 bucket** — segments never deleted during broadcast, VOD = historical manifest.

---

### Common Pattern (Industry Best Practice)

| Stage | Action | Storage |
|-------|--------|---------|
| **Live** | Write segments continuously | Append-only (S3/R2/disk) |
| **Delivery** | Serve sliding window playlist | Last N segments |
| **Post-live** | Generate complete manifest | All segments → VOD |
| **Archive** | Optional: Stitch to MP4 + upload | Cloud storage |

**None of them use single-file continuous write** — segment-based is universal.

---

## 5. Recommended Architecture for Eventcast.pro

### Design Goal
- **Match YouTube reliability** (no data loss on restart)
- **Auto VOD playback** after event ends
- **Cost-effective** (self-hosted Restreamer + Cloudflare R2)

---

### Recommended Flow

```
OBS (RTMP)
    ↓
Restreamer (FFmpeg)
    ↓
┌─────────────────────────────────────┐
│  1. Live HLS (sliding window)       │ → memfs (last 10 segments)
│  2. Archive HLS (append-only)       │ → disk /recordings/{slug}/segment_%05d.ts
│  3. YouTube Relay (optional)        │ → RTMP relay
└─────────────────────────────────────┘
    ↓
After event ends:
    ↓
Cron/Webhook detects end
    ↓
┌─────────────────────────────────────┐
│  1. Generate VOD playlist (all segs)│
│  2. Upload segments → R2            │
│  3. Update DB: vod_url              │
│  4. Player: switch live → VOD       │
└─────────────────────────────────────┘
```

---

### Implementation Details

#### **Step 1: Dual HLS Output (Live + Archive)**

**Restreamer config:**
```typescript
outputs: [
  // Live HLS (sliding window, delete old)
  {
    id: "hls-live",
    address: "{memfs}/{processid}.m3u8",
    options: [
      "-f", "hls",
      "-hls_time", "4",
      "-hls_list_size", "10",
      "-hls_flags", "delete_segments"
    ]
  },
  
  // Archive HLS (append-only, keep all)
  {
    id: "hls-archive",
    address: "{diskfs}/recordings/{processid}/index.m3u8",
    options: [
      "-f", "hls",
      "-hls_time", "4",
      "-hls_list_size", "0",        // Keep all
      "-hls_flags", "append_list",  // Restart-safe
      "-hls_segment_filename", "{diskfs}/recordings/{processid}/segment_%05d.ts"
    ]
  },
  
  // YouTube (optional relay)
  {
    id: "youtube",
    address: "rtmp://a.rtmp.youtube.com/live2/{key}",
    options: ["-c", "copy", "-f", "flv"]
  }
]
```

**Result:**
- `/memfs/sravani.m3u8` → live (10 segments)
- `/data/recordings/sravani/index.m3u8` → **full event** (all segments)
- YouTube → backup archive

---

#### **Step 2: Post-Event VOD Pipeline**

**Trigger:** Cron detects `youtube_status = completed` OR manual end.

**Actions:**
1. **Generate complete VOD manifest**
   ```bash
   cd /recordings/{slug}/
   ls segment_*.ts | sort > filelist.txt
   # Generate playlist with all segments + #EXT-X-ENDLIST
   ```

2. **Upload to R2**
   ```bash
   rclone sync /recordings/{slug}/ r2:bucket/events/{slug}/archive/
   ```

3. **Update Supabase**
   ```sql
   UPDATE events
   SET vod_url = 'https://pub.r2.dev/events/{slug}/archive/index.m3u8'
   WHERE slug = '{slug}';
   ```

4. **Player logic update**
   ```javascript
   if (CONFIG.vodUrl && eventEnded) {
     hls.loadSource(CONFIG.vodUrl); // Complete archive
   } else {
     hls.loadSource(CONFIG.liveUrl); // Sliding window
   }
   ```

---

### Why This Is Better

| Issue | Current | Recommended |
|-------|---------|-------------|
| Restart data loss | ❌ Overwrites MP4 | ✅ Appends new segments |
| Full event recording | ❌ Only YouTube | ✅ Restreamer + YouTube |
| VOD playback | ❌ Manual setup | ✅ Auto after event end |
| Crash tolerance | ❌ Entire file risk | ✅ Only 4s segment lost |
| Storage efficiency | ❌ Large MP4 rewrites | ✅ Small incremental writes |
| Seek performance | ❌ Single seek point | ✅ Segment-level seek |

---

## 6. Alternative: Single MP4 with Session IDs (Simpler)

If you prefer **single MP4 per session** (not segments):

**Config:**
```typescript
{
  id: "vod-archive",
  address: "{diskfs}/recordings/{processid}/{timestamp}.mp4",
  options: ["-movflags", "+faststart"]
}
```

**Result:**
```
/recordings/sravani/
  ├── 2026-06-25T00-47-10Z.mp4  (5 min test)
  ├── 2026-06-25T06-30-00Z.mp4  (37 min session)
  └── ...
```

**Post-event:**
```bash
ffmpeg -f concat -i filelist.txt -c copy merged.mp4
```

**Pros:** Simpler than segments.  
**Cons:** Restart gap = separate file (manual merge needed).

---

## 7. Final Recommendation

### For Eventcast.pro: **Segment-Based Archive (Recommended)**

**Why:**
- ✅ Matches industry standard (Mux, Cloudflare, AWS)
- ✅ Restart-safe, crash-tolerant
- ✅ Auto VOD (no merge needed)
- ✅ R2 upload = incremental (fast)
- ✅ 4s segments = proven safe

**Implementation priority:**
1. **Phase 1 (Now):** Add `hls-archive` output (append-only segments)
2. **Phase 2:** Post-event cron: upload segments → R2
3. **Phase 3:** Player auto-switch live → VOD

**Estimated effort:** 1–2 days dev + testing.

---

### Migration Path

**Immediate (today):**
- Keep YouTube relay as **primary VOD backup**
- Use current single MP4 for short events (<1h)

**Next sprint:**
- Deploy segment-based archive
- Test with next event (chinna-eswari-wedding)

**Long-term:**
- Phase out single MP4
- R2 becomes primary VOD source

---

## 8. Technical Q&A

### Q: Is 4-second segments safe?
**A:** YES. Apple recommends 6s, Netflix uses 2–6s, YouTube ingests 2–4s chunks. **4s is industry standard.**

### Q: Will segments auto-play as one video?
**A:** YES — if playlist has `#EXT-X-ENDLIST` + all segments listed. Player treats it as single VOD.

### Q: Storage cost for segments?
**A:** Same as single MP4 (data is data). R2: $0.015/GB/month. 6-hour 1080p = ~6 GB = $0.09/month per event.

### Q: What if internet drops mid-event?
**A:** Segments on disk = safe. Upload after reconnect. YouTube = continuous (no local dependency).

### Q: Can we delete segments after stitching MP4?
**A:** YES, but keep segments for fast seek. MP4 = single file = slower seek. Segments = instant jump to any 4s.

---

## 9. Summary Table

| Requirement | Current | Recommended |
|-------------|---------|-------------|
| **Full recording** | YouTube only | Restreamer + YouTube |
| **Restart safety** | ❌ Overwrite | ✅ Append segments |
| **Auto VOD** | ❌ Manual | ✅ Cron pipeline |
| **Storage** | 1.3 GB (lost) | ~6 GB (preserved) |
| **Cost** | $0 (disk) | $0.09/mo (R2) |
| **Complexity** | Low | Medium |
| **Reliability** | Medium | High |

---

## 10. Next Steps

1. **Approve architecture** (segment-based archive)
2. **Update `restreamer.ts`** (add `hls-archive` output)
3. **Test with chinna-eswari-wedding** (27th June)
4. **Deploy post-event pipeline** (R2 upload + DB update)
5. **Player VOD switch logic** (live → archive on event end)

---

**స్పష్టత వచ్చిందా? ఇంకా ఏ doubt ఉంటే అడగండి.**
