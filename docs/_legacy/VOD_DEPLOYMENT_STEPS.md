# VOD Architecture - Deployment Steps

**Target**: Production deployment for `chinna-eswari-wedding` (June 27, 2026)

---

## Pre-Deployment Checklist

### 1. Code Changes Summary

✅ **Restreamer Config** (`eventcast-admin/src/lib/restreamer.ts`)
- Added `hls-archive` output (append-mode, restart-safe)
- Keeps existing `vod-record` MP4 as fallback

✅ **VOD Archival Script** (`eventcast-admin/scripts/archive-vod-to-r2.ts`)
- Downloads segments from Restreamer disk
- Uploads to Cloudflare R2
- Updates Supabase `vod_link`

✅ **Worker Config** (`workers/render-event-page/src/index.ts`)
- Prefers `vod_link` over live HLS URL
- Sets `CONFIG.vodArchiveUrl` for player detection

✅ **Player Logic** (`sravani-manoj-engagement/script.js`)
- Detects VOD vs Live mode
- Adjusts buffering, badges, reconnect logic

✅ **Documentation**
- `STREAMING_ARCHITECTURE_REPORT.md` - Full analysis
- `VOD_ARCHITECTURE_IMPLEMENTATION.md` - Implementation guide
- `VOD_DEPLOYMENT_STEPS.md` (this file)

---

## Deployment Steps

### Step 1: Install Dependencies

```bash
cd D:\Eventcast.pro\eventcast-admin
npm install
```

**Expected output**:
```
added 1 package (@aws-sdk/client-s3)
```

**Verify**:
```bash
npm list @aws-sdk/client-s3
# Should show: @aws-sdk/client-s3@3.738.0
```

---

### Step 2: Deploy Render Worker (Event Page Config)

```bash
cd D:\Eventcast.pro\workers\render-event-page
npm run deploy
```

**Expected output**:
```
✨ Compiled Worker successfully
✨ Uploading Worker...
✨ Deployment complete!
```

**Verification**:
```bash
# Check any event page config
curl https://eventcast.pro/events/sravani-manoj-engagement/ | grep vodArchiveUrl
# Should show: vodArchiveUrl: ""
```

---

### Step 3: Update Active Restreamer Channels

**For Each Active Event** (`chinna-eswari-wedding`, `bhargavaram-sasiram-chowdary-dhoti-ceremony`):

The new `hls-archive` output will be applied automatically when you:
- Create new channels via admin panel
- Or manually recreate existing channels

**Option A: Via Admin Panel** (Recommended for new events)
1. Go to: https://eventcast.pro/admin/live-setup
2. Create event: `chinna-eswari-wedding`
3. New triple-output config applies automatically

**Option B: Manual Restreamer API Update** (For existing channels)

Create a script to update existing processes:

```bash
cd D:\Eventcast.pro\scratch
node update_channels_triple_output.mjs
```

**Script** (`scratch/update_channels_triple_output.mjs`):
```javascript
import { RestreamerClient } from '../eventcast-admin/src/lib/restreamer.ts';

const slugs = [
  'chinna-eswari-wedding',
  'bhargavaram-sasiram-chowdary-dhoti-ceremony'
];

for (const slug of slugs) {
  console.log(`Updating ${slug}...`);
  const client = new RestreamerClient({
    url: process.env.RESTREAMER_URL,
    username: process.env.RESTREAMER_USERNAME,
    password: process.env.RESTREAMER_PASSWORD
  });
  
  // Delete and recreate with new triple-output config
  await client.deleteChannel(slug);
  await client.setupChannel(slug, process.env.YOUTUBE_KEY);
  console.log(`✅ ${slug} updated`);
}
```

**Note**: This will briefly interrupt any live stream. Best done **before** the event starts.

---

### Step 4: Update Player Scripts (Cache Bust)

**For Static Event Pages**:

Update cache version in `index.html`:

```bash
# Example: sravani-manoj-engagement
cd D:\Eventcast.pro\sravani-manoj-engagement
```

Change:
```html
<script src="script.js?v=20250625c"></script>
```

To:
```html
<script src="script.js?v=20260626"></script>
```

**For Template-based Events**:

Template already uses cache-busted URLs via worker. Deploy worker (Step 2) applies changes automatically.

---

### Step 5: Test Archive Creation (Pre-Event)

**Start Test Stream**:
```bash
# OBS -> rtmp://34.100.142.25/test-archive
# Stream for 30 seconds
# Stop stream
```

**Check Archive Created**:
```bash
cd D:\Eventcast.pro\scratch
node check_archive_test.mjs
```

**Expected**:
- `/recordings/test-archive/index.m3u8` exists
- `/recordings/test-archive/segment_00000.ts` through `segment_0000X.ts` exist

---

### Step 6: Test VOD Archival Script

```bash
cd D:\Eventcast.pro\eventcast-admin
npm run archive-vod -- test-archive
```

**Expected output**:
```
=== Archiving VOD for test-archive ===
✓ Logged into Restreamer
✓ Found 8 files in Restreamer archive
Uploading to R2...
  1/8 index.m3u8 (0.01 MB)
  2/8 segment_00000.ts (1.2 MB)
  ...
✓ Uploaded all 8 files to R2
VOD URL: https://vod.eventcast.pro/events/test-archive/vod/index.m3u8
✓ Updated Supabase vod_link
```

**Verify VOD Playback**:
```bash
# Visit test event page
# Should show VOD mode, no LIVE badge
curl -I https://vod.eventcast.pro/events/test-archive/vod/index.m3u8
# Should return: 200 OK, Content-Type: application/vnd.apple.mpegurl
```

---

## Environment Variables Required

**Restreamer** (`.env.local`):
```bash
RESTREAMER_URL=https://media.eventcast.pro
RESTREAMER_USERNAME=admin
RESTREAMER_PASSWORD=***
```

**Cloudflare R2**:
```bash
R2_ACCOUNT_ID=***
R2_ACCESS_KEY_ID=***
R2_SECRET_ACCESS_KEY=***
R2_BUCKET=eventcast-vod
R2_PUBLIC_DOMAIN=vod.eventcast.pro
```

**Supabase**:
```bash
SUPABASE_URL=https://***.supabase.co
SUPABASE_SERVICE_KEY=***
```

**Verify All Set**:
```bash
cd D:\Eventcast.pro\eventcast-admin
node -e "require('dotenv').config({path:'.env.local'}); console.log('R2:', !!process.env.R2_ACCOUNT_ID); console.log('Supabase:', !!process.env.SUPABASE_SERVICE_KEY);"
```

---

## Post-Deployment Testing

### Test 1: New Event Creation

1. Create event: `chinna-eswari-wedding` via admin panel
2. Check Restreamer process has 3 outputs:
   ```bash
   curl https://media.eventcast.pro/api/v3/process/chinna-eswari-wedding -H "Authorization: Bearer $TOKEN"
   ```
3. Verify `output` array contains:
   - `"id": "hls"`
   - `"id": "vod-record"`
   - `"id": "hls-archive"`

### Test 2: Live Stream with Restart

1. Start OBS stream to `chinna-eswari-wedding`
2. Stream for 30 seconds
3. Stop OBS, wait 5 seconds
4. Restart OBS, stream for 30 seconds
5. Check archive folder:
   ```bash
   # Should have ~15 segments total (both sessions combined)
   ls /core/data/recordings/chinna-eswari-wedding/
   ```

### Test 3: VOD Archival

1. Run archival script:
   ```bash
   npm run archive-vod -- chinna-eswari-wedding
   ```
2. Visit event page: `https://eventcast.pro/events/chinna-eswari-wedding/`
3. Browser console should log: `"VOD mode: Full archive playback"`
4. LIVE badge should be hidden
5. Full seeking should work (drag timeline)

---

## Rollback Plan

If critical issues occur during `chinna-eswari-wedding`:

### Quick Rollback (Live Event)

**Disable Archive Output**:
```bash
# Via Restreamer API - remove hls-archive output from process config
# Keep only hls (live) and youtube outputs
# This requires process restart - only do if stream is broken
```

**Keep Single MP4**:
- MP4 output still works independently
- After event, can manually upload MP4 to R2 as fallback

### Full Rollback (Post-Event)

1. Revert `restreamer.ts` changes:
   ```bash
   git checkout HEAD~1 -- eventcast-admin/src/lib/restreamer.ts
   ```

2. Redeploy worker:
   ```bash
   cd workers/render-event-page
   npm run deploy
   ```

3. Player still works (uses live HLS or YouTube fallback)

---

## Monitoring & Alerts

### Disk Space Alert

Set up monitoring on Restreamer server:

```bash
# Check available space
df -h /core/data

# Alert if <10GB free
# Archive folder grows ~1GB/hour for 1080p30
```

### Archival Success Check

After each event:
```bash
# Verify R2 upload
aws s3 ls s3://eventcast-vod/events/chinna-eswari-wedding/vod/ --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com
```

---

## Next Event: chinna-eswari-wedding

**Date**: June 27, 2026  
**Setup**:
1. Deploy all changes (Steps 1-4)
2. Create event via admin panel (auto-applies triple output)
3. Test OBS connection before event
4. Monitor live stream (check archive segments during event)
5. After event: run `npm run archive-vod -- chinna-eswari-wedding`
6. Verify VOD playback on event page

**Expected Outcome**:
- ✅ Full event recorded (even if OBS restarts)
- ✅ VOD available within 5-10 minutes post-event
- ✅ YouTube also has full recording (backup)
- ✅ Viewers can rewatch entire event with full seeking

---

## Summary

| Component | Status | Action |
|-----------|--------|--------|
| Restreamer config | ✅ Ready | Deploy via setupChannel |
| VOD script | ✅ Ready | npm install, test run |
| Worker config | ✅ Ready | npm run deploy |
| Player script | ✅ Ready | Cache-bust or redeploy |
| Documentation | ✅ Complete | Review before event |
| Testing | 🟡 Pending | Run Steps 5-6 |
| Production deploy | 🟡 Pending | Before June 27 event |

---

**Deployment Owner**: [Your Name]  
**Deployment Date**: June 26, 2026  
**Production Ready**: ✅ Yes (pending final testing)
