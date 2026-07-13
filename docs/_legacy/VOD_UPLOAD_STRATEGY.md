# VOD Upload Strategy: Segments vs Single File

**Question**: Should we upload small segments or merge into single video?  
**Answer**: **Upload segments** (current implementation) is BETTER for most cases.

---

## 🎯 Current Implementation: Upload Segments

### What Happens Now

```bash
npm run archive-vod -- chinna-eswari-wedding
```

**Process**:
1. Download from Restreamer: `segment_00000.ts`, `segment_00001.ts`, ..., `segment_01499.ts`
2. Upload to R2: Each segment individually
3. Upload playlist: `index.m3u8` (master playlist)
4. Result: 1500+ files in R2 for 6-hour event

**Example Structure in R2**:
```
r2://eventcast-vod/events/chinna-eswari-wedding/vod/
  ├── index.m3u8 (master playlist)
  ├── segment_00000.ts (4 seconds)
  ├── segment_00001.ts (4 seconds)
  ├── segment_00002.ts (4 seconds)
  ...
  └── segment_01499.ts (4 seconds)
```

---

## 📊 Comparison: Segments vs Single File

| Aspect | Small Segments | Single Merged File |
|--------|----------------|-------------------|
| **Upload time** | ⏱️ Parallel (5-10 min) | ⏱️ Serial (slower) |
| **Playback start** | ⚡ Instant | ⏳ Wait for headers |
| **Seeking** | ⚡ Instant (byte-range) | ⏳ Slow (large file) |
| **CDN caching** | ✅ Efficient (small chunks) | ❌ Poor (large file) |
| **Bandwidth efficiency** | ✅ Only load needed | ❌ Load entire file |
| **Mobile-friendly** | ✅ Adaptive loading | ❌ Heavy download |
| **Partial playback** | ✅ Works | ❌ Needs full file |
| **Resumable download** | ✅ Yes (per segment) | ⚠️ Restart from 0 |
| **Storage cost** | Same | Same |
| **R2 request cost** | Higher (1500 requests) | Lower (1 request) |

### Cost Analysis (6-hour event example)

**Segments (1500 files @ 3.6 MB each)**:
- Storage: 5.4 GB × $0.015/GB/month = **$0.08/month**
- Upload requests: 1500 × $0.0000036 = **$0.0054**
- Playback (100 views, avg 30 min watch): ~750K requests × $0.00000036 = **$0.27**
- **Total: ~$0.35/month**

**Single File (5.4 GB)**:
- Storage: 5.4 GB × $0.015/GB/month = **$0.08/month**
- Upload requests: 1 × $0.0000036 = **~$0**
- Playback bandwidth: 100 views × 1 GB avg = 100 GB × $0.01/GB = **$1.00**
- **Total: ~$1.08/month**

**Winner**: Segments are **3x cheaper** for playback!

---

## ✅ Why Segments Are BETTER

### 1. Instant Playback Start

**Segments**:
```
User clicks play → Download segment_00000.ts (3.6 MB)
                 → Start playing in 0.5 seconds
                 → Download next segments in background
```

**Single File**:
```
User clicks play → Download 5.4 GB file headers
                 → Buffer first 50 MB
                 → Start playing in 5-10 seconds (depending on connection)
```

### 2. Seeking Efficiency

**Segments**:
```
User seeks to 3:30:00 (middle of event)
→ Calculate segment number: 3150 seconds / 4 = segment_00787
→ Download segment_00787.ts (3.6 MB)
→ Play immediately (1 second)
```

**Single File**:
```
User seeks to 3:30:00
→ HTTP Range request: bytes=3000000000-3100000000
→ Download 100 MB chunk around position
→ Play after buffering (5-10 seconds)
```

### 3. Network Resilience

**Segments**:
```
Network drops during playback
→ Segment 50 failed to download
→ Retry segment 50 only (3.6 MB)
→ Resume playback quickly
```

**Single File**:
```
Network drops during download
→ Entire 5.4 GB transfer fails
→ Restart from beginning (or use resume if supported)
→ Long re-download time
```

### 4. CDN Efficiency

**Segments**:
```
Cloudflare CDN:
- Cache segment_00000.ts in Mumbai edge
- User in Delhi requests same segment
- Serve from cache (instant)
- Each segment cached independently
```

**Single File**:
```
Cloudflare CDN:
- Cannot cache entire 5.4 GB file
- Must proxy to origin R2 every time
- Slow for all users
```

---

## ⚠️ When Single File Might Be Better

### Use Case 1: Offline Download

**Scenario**: User wants to download full video for offline viewing

**Solution**: Offer separate download button that merges segments
```bash
# On-demand merge
ffmpeg -i "https://vod.eventcast.pro/.../index.m3u8" -c copy event.mp4
# User downloads single 5.4 GB file
```

### Use Case 2: Archive/Backup

**Scenario**: Long-term archival (1 year+), never played

**Solution**: After 6 months, merge segments for cheaper storage
```bash
# Merge and compress
ffmpeg -i index.m3u8 -c:v libx265 -crf 23 archive.mp4
# Result: 2.7 GB (50% saving)
# Delete segments from R2
```

---

## 🔧 Post-Event Transcoding: Should We Do It?

### What Is Transcoding?

```bash
# Input: Raw stream segments (H.264, high bitrate)
segment_00000.ts = 3.6 MB per 4 seconds = ~7.2 Mbps

# Transcode to H.265 with same quality
ffmpeg -i segment_00000.ts -c:v libx265 -crf 23 output.mp4
output.mp4 = 1.8 MB per 4 seconds = ~3.6 Mbps

# Result: 50% smaller, same visual quality
```

### Pros of Transcoding

1. **Storage Savings**:
   - 6-hour event: 5.4 GB → 2.7 GB
   - Annual cost: $0.97 → $0.49 (save $0.48/event/year)
   - 100 events: Save ~$48/year

2. **Bandwidth Savings**:
   - Viewers download 50% less data
   - Faster playback start
   - Better mobile experience

3. **Quality Optimization**:
   - Remove encoding artifacts
   - Optimize for web playback
   - Consistent quality across segments

### Cons of Transcoding

1. **Time Cost**:
   - 6-hour event takes ~1 hour to transcode (6x realtime on good CPU)
   - Delays VOD availability (5 min → 65 min)

2. **CPU Cost**:
   - Intensive processing (8 cores at 100% for 1 hour)
   - Cloud compute cost: ~$0.50/hour = **$0.50 per event**
   - OR requires powerful local hardware

3. **Quality Risk**:
   - Re-encoding can introduce artifacts
   - Not visually identical (though very close with crf 23)
   - Original is always safer

4. **Complexity**:
   - Another step in pipeline
   - More failure points
   - Debugging harder

---

## 💡 Recommendation for Your Platform

### Current Implementation (Segments, No Transcoding)

**Keep this for now because:**

1. ✅ **Fast VOD** (5-10 min vs 65 min)
2. ✅ **Simple pipeline** (upload → done)
3. ✅ **Original quality** (no re-encode artifacts)
4. ✅ **Proven reliable** (industry standard)
5. ✅ **Low cost** ($0.35/month per event is negligible)

### When to Add Transcoding (Future)

**Trigger conditions**:
1. Storage cost becomes significant (>₹5000/month)
2. You have >500 events archived
3. Mobile viewers report slow loading
4. You upgrade to dedicated encoding server

**Implementation**:
```bash
# After archival, before R2 upload
npm run archive-vod -- <slug>
  ↓
Transcode segments (optional flag)
  ↓
Upload transcoded versions to R2
```

---

## 📋 Final Strategy

### Current (Production)

```mermaid
Live Stream → Restreamer → Segments (H.264) → R2
                                               ↓
                                         Instant VOD
```

**Pros**: Fast, simple, reliable  
**Cost**: $0.35/month per event  
**Time**: 5-10 min VOD latency

### Phase 2 (Optional Future)

```mermaid
Live Stream → Restreamer → Segments (H.264) → Transcode (H.265) → R2
                                                                    ↓
                                                              VOD (50% smaller)
```

**Pros**: Storage savings, better mobile  
**Cost**: $0.50 transcoding + $0.18/month storage  
**Time**: 60-90 min VOD latency

### Phase 3 (Optional Future)

```mermaid
Live → Restreamer → Multi-bitrate segments → R2 with CDN
                    (1080p, 720p, 480p, 360p)
                                              ↓
                                        ABR streaming (YouTube-like)
```

**Pros**: Adapts to connection, best UX  
**Cost**: 4x storage (~$1.40/month)  
**Time**: Real-time during live

---

## 🎯 Answer to Your Questions

### Q1: Upload small segments or merge into single file?

**Answer**: **Upload segments** (current implementation)

**Reasons**:
1. Instant playback start
2. Efficient seeking
3. CDN-friendly
4. Mobile-optimized
5. Industry standard (YouTube, Netflix, Twitch all use segments)

### Q2: Should we do post-event transcoding/compression?

**Answer**: **Not now, maybe later**

**Current approach**:
- Keep segments as-is (H.264, copy codec)
- Fast VOD (5-10 min)
- Original quality guaranteed

**Future approach** (when needed):
- Add optional transcoding step
- H.265 encoding (50% saving)
- Only when storage cost becomes concern

### Q3: Is segment-based storage good?

**Answer**: ✅ **YES, it's the BEST approach**

**Evidence**:
- YouTube: Uses segments (DASH)
- Netflix: Uses segments (HLS)
- Twitch: Uses segments (HLS)
- All major platforms: Segment-based

**Your cost**: $0.35/month per event is **negligible**  
**Your benefit**: YouTube-quality playback experience

---

## ✅ Summary

| Strategy | Current (Recommended) | Alternative 1 | Alternative 2 |
|----------|----------------------|---------------|---------------|
| **Format** | Segments (H.264) | Single file | Segments (H.265) |
| **VOD time** | 5-10 min | 5-10 min | 60-90 min |
| **Storage** | $0.35/month | $1.08/month | $0.18/month |
| **Quality** | Original | Original | Near-original |
| **Playback** | Excellent | Good | Excellent |
| **Complexity** | Low | Low | Medium |

**Recommendation**: **Stick with current (Segments H.264)**

---

**Last Updated**: June 27, 2026  
**Status**: Production-ready, no changes needed ✅
