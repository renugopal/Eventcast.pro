# Immediate Fixes - Implementation Guide

**Priority**: CRITICAL  
**Target**: Deploy before next event  
**Estimated Time**: 4-6 hours

---

## Fix #1: Pin HLS.js Version (Issue #7)

### Current Problem
```html
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
```
❌ `@latest` can auto-update to breaking versions during live events

### Solution

**File**: `workers/render-event-page/templates/dhoti-ceremony-template-01/index.html`  
**File**: `wedding-template-01/index.html`

```html
<!-- Old -->
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>

<!-- New -->
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js"></script>
```

**Deployment**:
```bash
cd D:\Eventcast.pro\workers\render-event-page
npm run deploy
```

**Verification**:
```bash
curl https://eventcast.pro/events/demo-groom-demo-bride-wedding/ | grep "hls.js"
# Should show: hls.js@1.5.8
```

---

## Fix #2: Add Directory Pre-creation (Issue #1)

### Current Problem
If `/core/data/recordings/{slug}/` doesn't exist, HLS archive silently fails.

### Solution

**File**: `eventcast-admin/src/lib/restreamer.ts`

```typescript
async setupChannel(slug: string, youtubeKey?: string) {
  console.log(`Setting up Restreamer channel for ${slug}...`);
  const authHeader = await this.getAuthToken();

  // Remove stale VOD MP4 so FFmpeg never blocks on "file already exists"
  await this.deleteDiskMp4(slug, authHeader);

  // NEW: Ensure HLS archive directory exists
  await this.ensureArchiveDirectory(slug, authHeader);

  // ... rest of setupChannel logic
}

/**
 * Ensure HLS archive directory exists before starting FFmpeg
 */
private async ensureArchiveDirectory(slug: string, authHeader: string): Promise<void> {
  const dirPath = `/recordings/${slug}`;
  
  try {
    // Check if directory exists
    const checkRes = await fetch(
      `${this.config.url}/api/v3/fs/diskfs${dirPath}`,
      { 
        method: 'HEAD',
        headers: { Authorization: authHeader }
      }
    );

    if (checkRes.ok) {
      console.log(`Archive directory ${dirPath} already exists`);
      return;
    }

    // Create directory
    const createRes = await fetch(
      `${this.config.url}/api/v3/fs/diskfs${dirPath}`,
      {
        method: 'PUT',
        headers: { 
          Authorization: authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ type: 'directory' })
      }
    );

    if (!createRes.ok) {
      throw new Error(`Failed to create archive directory: ${createRes.status}`);
    }

    console.log(`Created archive directory ${dirPath}`);
  } catch (err) {
    console.error(`Failed to ensure archive directory ${dirPath}:`, err);
    // Don't throw - allow setupChannel to continue (MP4 fallback still works)
  }
}
```

**Testing**:
```bash
# Create test event
cd D:\Eventcast.pro\scratch
node -e "
import { RestreamerClient } from '../eventcast-admin/src/lib/restreamer.ts';
const client = new RestreamerClient({
  url: process.env.RESTREAMER_URL,
  username: process.env.RESTREAMER_USERNAME,
  password: process.env.RESTREAMER_PASSWORD
});
await client.setupChannel('test-archive-dir');
console.log('✅ Directory creation test passed');
"
```

---

## Fix #3: Add Player Circuit Breaker (Issue #8)

### Current Problem
Player reload loop has no limit → infinite reloads if stream permanently fails

### Solution

**File**: `workers/render-event-page/src/index.ts:665`

```javascript
const recoveryFixScript = `<script>
// HLS Player Recovery Fix - prevents stuck state on network drops
(function() {
  if (typeof window === 'undefined') return;

  window.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
      const video = document.getElementById('hls-video');
      if (!video) return;

      console.log('[Recovery Fix] Installing heartbeat monitor...');

      // NEW: Circuit breaker - limit reload attempts
      let reloadCount = parseInt(localStorage.getItem('_eventcast_reload_count') || '0');
      const lastReload = parseInt(localStorage.getItem('_eventcast_last_reload') || '0');
      const now = Date.now();

      // Reset counter if >5 minutes since last reload (stream recovered)
      if (now - lastReload > 300000) {
        reloadCount = 0;
        localStorage.setItem('_eventcast_reload_count', '0');
      }

      // Install heartbeat to detect stuck streams
      let heartbeatInterval = setInterval(function() {
        if (!video) {
          clearInterval(heartbeatInterval);
          return;
        }

        // Check if player is stuck
        const isStuck = video.readyState < 2 || (video.paused && video.currentTime === 0);
        
        if (isStuck && window.WEDDING_CONFIG && window.WEDDING_CONFIG.restreamerUrl) {
          // Circuit breaker: stop after 5 reload attempts
          if (reloadCount >= 5) {
            console.error('[Recovery Fix] Circuit breaker: 5 reload attempts failed, stopping');
            clearInterval(heartbeatInterval);
            
            // Show user-friendly message
            const loader = document.querySelector('.stream-loader');
            if (loader) {
              const loaderText = loader.querySelector('.loader-text, .loader-text-live, .loader-text-paused');
              if (loaderText) {
                loaderText.textContent = 'Stream is temporarily unavailable. Please watch on YouTube.';
              }
            }
            
            return;
          }

          console.warn('[Recovery Fix] Player stuck, forcing reload (attempt ' + (reloadCount + 1) + '/5)...');
          
          // Increment and persist reload count
          reloadCount++;
          localStorage.setItem('_eventcast_reload_count', reloadCount.toString());
          localStorage.setItem('_eventcast_last_reload', now.toString());

          // Force page reload to recover
          const currentUrl = window.location.href;
          const separator = currentUrl.includes('?') ? '&' : '?';
          window.location.href = currentUrl + separator + '_recover=' + now;
        }
      }, 12000); // Check every 12 seconds

      // Cleanup on page unload
      window.addEventListener('beforeunload', function() {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
      });
    }, 3000);
  });
})();
</script>`;
```

**Deployment**:
```bash
cd D:\Eventcast.pro\workers\render-event-page
npm run deploy
```

---

## Fix #4: Complete VOD Uploader Environment Fix (Issue #10)

### Current Problem
`dotenv` not loading `.env` variables in systemd service context

### Solution (Already Implemented)

**File**: `eventcast-admin/scripts/vod-uploader/live-uploader.mjs`

```javascript
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from script directory (robust for systemd service)
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });
```

### Verification Steps

1. **Check if fix is deployed**:
```bash
# SSH to VM
gcloud compute ssh eventcast-vm

# Check deployed code
cat /opt/eventcast/vod-uploader/live-uploader.mjs | head -25
# Should show: config({ path: join(__dirname, '.env') });
```

2. **Restart service**:
```bash
sudo systemctl restart vod-uploader.service
sudo systemctl status vod-uploader.service
```

3. **Check logs for environment variables**:
```bash
sudo journalctl -u vod-uploader.service -f --since "1 minute ago"
# Should show: Loaded R2 config, authenticated to Restreamer
```

4. **Verify segments uploading**:
```bash
# Check R2 bucket
cd D:\Eventcast.pro
node -e "
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});
const res = await client.send(new ListObjectsV2Command({
  Bucket: process.env.R2_BUCKET_NAME,
  Prefix: 'vod/demo-groom-demo-bride-wedding/',
  MaxKeys: 10
}));
console.log('Recent VOD segments:', res.Contents?.length || 0);
res.Contents?.forEach(obj => console.log(' -', obj.Key, obj.Size, 'bytes'));
"
```

---

## Deployment Sequence

### Step 1: Deploy Worker Fixes (Fixes #1 & #3)
```bash
cd D:\Eventcast.pro\workers\render-event-page
npm run deploy
```

**Expected Output**:
```
✨ Compiled Worker successfully
✨ Uploading Worker to Cloudflare...
✨ Deployment complete!
Published to: https://eventcast.pro
```

### Step 2: Update Restreamer Client (Fix #2)
```bash
cd D:\Eventcast.pro\eventcast-admin
# Edit src/lib/restreamer.ts (add ensureArchiveDirectory method)
npm run build
```

### Step 3: Verify VOD Uploader (Fix #4)
```bash
# SSH to VM
gcloud compute ssh eventcast-vm

# Check if fix is deployed
cat /opt/eventcast/vod-uploader/live-uploader.mjs | grep "config({ path"

# If not deployed, upload fixed version
exit

# On local machine
cd D:\Eventcast.pro\eventcast-admin\scripts\vod-uploader
scp live-uploader.mjs eventcast-vm:/opt/eventcast/vod-uploader/

# Back on VM
gcloud compute ssh eventcast-vm
sudo systemctl restart vod-uploader.service
sudo systemctl status vod-uploader.service
```

### Step 4: Full System Test

**Test Checklist**:
- [ ] Player loads with HLS.js 1.5.8 (not @latest)
- [ ] Player reload loop stops after 5 attempts (manually test by killing Restreamer)
- [ ] New Restreamer channel auto-creates `/recordings/{slug}/` directory
- [ ] VOD uploader logs show successful R2 uploads

---

## Rollback Plan

If any fix causes issues:

### Rollback Worker
```bash
cd D:\Eventcast.pro\workers\render-event-page
git checkout HEAD~1  # Previous version
npm run deploy
```

### Rollback Restreamer Client
```bash
cd D:\Eventcast.pro\eventcast-admin
git checkout HEAD~1 src/lib/restreamer.ts
npm run build
```

### Rollback VOD Uploader
```bash
gcloud compute ssh eventcast-vm
cd /opt/eventcast/vod-uploader
sudo git checkout HEAD~1 live-uploader.mjs
sudo systemctl restart vod-uploader.service
```

---

## Monitoring After Deployment

### 1. Watch Worker Logs
```bash
# Cloudflare Dashboard → Workers → render-event-page → Logs (Real-time)
# Look for: [Recovery Fix] messages
```

### 2. Watch Restreamer Health
```bash
cd D:\Eventcast.pro
node -e "
import { RestreamerClient } from './eventcast-admin/src/lib/restreamer.ts';
const client = new RestreamerClient({
  url: process.env.RESTREAMER_URL,
  username: process.env.RESTREAMER_USERNAME,
  password: process.env.RESTREAMER_PASSWORD
});
const health = await client.getProcessHealth('demo-groom-demo-bride-wedding');
console.log('Stream Health:', health);
"
```

### 3. Watch VOD Uploader
```bash
gcloud compute ssh eventcast-vm
sudo journalctl -u vod-uploader.service -f
```

---

## Success Criteria

✅ All fixes deployed successfully when:
1. Event page loads HLS.js v1.5.8 (visible in browser DevTools → Sources)
2. Player stops reloading after 5 attempts (test by disabling network)
3. New Restreamer channels have pre-created archive directories
4. VOD uploader logs show "Uploaded segment_XXXXX.ts to R2" messages

---

**Last Updated**: June 27, 2026, 11:45 AM IST  
**Maintainer**: Eventcast.pro Team
