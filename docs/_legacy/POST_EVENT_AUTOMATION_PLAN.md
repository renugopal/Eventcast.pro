# Post-Event Automation Plan

**User Request**: After live streaming completes, automatically:
1. End Restreamer process
2. End YouTube broadcast
3. Upload VOD segments to R2
4. Update webpage

---

## 🎯 Current Status: Semi-Manual

**What you do now**:
```bash
# After event ends
cd eventcast-admin
npm run archive-vod -- chinna-eswari-wedding
```

**What happens**:
1. ✅ Downloads segments from Restreamer
2. ✅ Uploads to R2
3. ✅ Updates Supabase vod_link
4. ✅ Webpage auto-switches to VOD

**What's NOT automated**:
- ❌ Ending Restreamer process
- ❌ Ending YouTube broadcast
- ⚠️ Triggering archive script (manual command)

---

## 🚀 Proposed Automation

### Architecture

```
Event ends (OBS stops) 
  ↓
[5 minute wait - confirm no restart]
  ↓
Cloudflare Worker (webhook/cron)
  ↓
┌─────────────────────────────────┐
│  Parallel Tasks:                │
│  1. End Restreamer             │
│  2. End YouTube broadcast       │
│  3. Archive VOD to R2           │
└─────────────────────────────────┘
  ↓
Update Supabase
  ↓
Notification (email/SMS)
```

### Implementation Plan

#### Step 1: Event End Detection

**Option A: Restreamer Webhook** (Recommended)
```typescript
// Restreamer fires webhook when process stops
// webhook.eventcast.pro/restreamer/event-ended

export default {
  async fetch(request, env) {
    const { slug, status } = await request.json();
    
    if (status === 'finished') {
      // Wait 5 minutes (confirm not restarting)
      await env.QUEUE.send({ slug }, { delaySeconds: 300 });
    }
  }
}
```

**Option B: Cron Job** (Fallback)
```typescript
// Check every 5 minutes if stream is still active
// If inactive for 10+ minutes, trigger archival

export default {
  async scheduled(event, env) {
    const activeEvents = await getActiveEvents();
    
    for (const event of activeEvents) {
      const isLive = await checkRestreamerStatus(event.slug);
      
      if (!isLive && event.inactiveMinutes > 10) {
        await triggerArchival(event.slug);
      }
    }
  }
}
```

#### Step 2: End Restreamer Process

**Script**: `scripts/end-restreamer.ts`
```typescript
async function endRestreamer(slug: string) {
  const client = new RestreamerClient();
  
  // Stop process gracefully
  await client.stopChannel(slug);
  
  // Wait for buffers to flush
  await sleep(10000);
  
  // Verify segments are all written
  const files = await client.listDiskFiles(`recordings/${slug}`);
  console.log(`Found ${files.length} segments`);
  
  return files.length;
}
```

#### Step 3: End YouTube Broadcast

**Script**: `scripts/end-youtube.ts`
```typescript
async function endYouTube(broadcastId: string) {
  const youtube = new YouTubeClient();
  
  // Transition to complete
  await youtube.transitionBroadcast(broadcastId, 'complete');
  
  // Remove LIVE prefix from title
  const video = await youtube.getVideo(broadcastId);
  if (video.title.includes('🔴 LIVE')) {
    await youtube.updateTitle(
      broadcastId,
      video.title.replace('🔴 LIVE NOW | ', '')
    );
  }
  
  return video.duration;
}
```

#### Step 4: Archive VOD

**Script**: `scripts/archive-vod-to-r2.ts` (Already exists!)
```typescript
// This already works!
// Just needs to be triggered automatically
await archiveVodToR2(slug);
```

#### Step 5: Orchestrator

**Script**: `scripts/post-event-automation.ts`
```typescript
async function postEventAutomation(slug: string) {
  console.log(`Starting post-event automation for ${slug}`);
  
  try {
    // Parallel: End Restreamer + End YouTube
    const [segmentCount, youtubeDuration] = await Promise.all([
      endRestreamer(slug),
      endYouTube(slug)
    ]);
    
    console.log(`Restreamer: ${segmentCount} segments`);
    console.log(`YouTube: ${youtubeDuration} duration`);
    
    // Sequential: Archive to R2 (after processes ended)
    await archiveVodToR2(slug);
    
    // Update event status
    await supabase
      .from('events')
      .update({
        status: 'completed',
        recording_duration: youtubeDuration,
        segment_count: segmentCount
      })
      .eq('slug', slug);
    
    // Send notification
    await sendNotification({
      type: 'vod_ready',
      slug,
      url: `https://eventcast.pro/events/${slug}/`
    });
    
    console.log(`✅ Post-event automation complete!`);
    
  } catch (err) {
    console.error(`❌ Automation failed:`, err);
    // Send error notification
    await sendNotification({
      type: 'automation_failed',
      slug,
      error: err.message
    });
  }
}
```

---

## 📋 Deployment Timeline

### Phase 1: Manual (Current) ✅

**Status**: Production-ready  
**Effort**: Run one command after event

```bash
npm run archive-vod -- <slug>
```

**Time**: 5-10 minutes

### Phase 2: Semi-Automated (Next Week)

**Tasks**:
1. Create `post-event-automation.ts` script
2. Combine end-restreamer + end-youtube + archive-vod
3. Run single command after event

```bash
npm run post-event -- <slug>
```

**Time**: 5-10 minutes (automatic after trigger)  
**Effort**: ~4 hours development

### Phase 3: Fully Automated (Future)

**Tasks**:
1. Setup Cloudflare Worker webhook endpoint
2. Configure Restreamer to call webhook on stop
3. Add 5-minute delay queue
4. Trigger post-event script automatically

**Time**: Zero manual work  
**Effort**: ~8 hours development + testing

---

## 🎯 Recommendation for June 27 Events

### For This Week: Use Manual (Phase 1)

**After each event**:
```bash
cd D:\Eventcast.pro\eventcast-admin
npm run archive-vod -- chinna-eswari-wedding
```

**Reasons**:
1. ✅ Already tested and working
2. ✅ No risk of automation bugs
3. ✅ Full control over timing
4. ✅ Can verify each step

### For Next Month: Add Phase 2

After we confirm Phase 1 works perfectly for both events:
1. Create combined script
2. Test on completed events
3. Deploy for future events

---

## 💰 Cost-Benefit Analysis

| Approach | Time per Event | Dev Effort | Risk |
|----------|---------------|------------|------|
| Manual | 2 min (run command) | 0 hours | Zero |
| Semi-Auto | 30 sec (run command) | 4 hours | Low |
| Full Auto | 0 min (automatic) | 8 hours | Medium |

**For 10 events/year**:
- Manual: 20 minutes/year → **Acceptable**
- Semi-Auto: 5 minutes/year → **Slight improvement**
- Full Auto: 0 minutes/year → **Ideal but not urgent**

**Recommendation**: Manual for now, automate later when we have more events.

---

## ✅ Action Items

### After June 27 Events

**When you tell me events are complete**:

I will run these commands for you:
```bash
# Event 1
npm run archive-vod -- chinna-eswari-wedding

# Event 2
npm run archive-vod -- bhargavaram-sasiram-chowdary-dhoti-ceremony
```

**Expected output**:
```
✓ Found ~1500 segments per event
✓ Uploaded to R2
✓ Updated vod_link in database
✓ VOD ready in 5-10 minutes
```

**You verify**:
- Visit event pages
- Confirm VOD plays
- Check seeking works
- Confirm no LIVE badge

---

**Last Updated**: June 27, 2026  
**Status**: Ready for manual archival after events ✅
