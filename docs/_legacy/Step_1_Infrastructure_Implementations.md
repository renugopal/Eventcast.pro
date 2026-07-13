# Infrastructure Phase 1: Implementations Blueprint

This document contains step-by-step technical blueprints and prompts for Cursor to implement the first two high-priority infrastructure tasks: **HLS Proxy Caching** and **Automated Cloudflare R2 VOD Archiving**.

---

## 🚀 Task 1: Cloudflare HLS Caching Strategy (Live Traffic Load Balancer)

### ℹ️ The Goal
Ensure Cloudflare handles 95%+ of the traffic during a live stream. HLS works by serving a playlist index (`.m3u8`) and tiny video chunks (`.ts` segments). We must cache the `.ts` video chunks globally (since they never change), but NEVER cache the `.m3u8` playlist (since it updates every 2 seconds with new chunks).

### 🛠️ Execution Plan
Since the media server is accessed directly (e.g., via `media.eventcast.pro` or your GCP IP mapped to a domain in Cloudflare), the caching is configured **directly inside your Cloudflare Dashboard**. You do NOT need to write any Next.js code for this.

#### 1. Cloudflare DNS Setup
Make sure your media server domain (e.g., `media.eventcast.pro` pointing to your GCP IP) is **Proxied** (Orange Cloud icon is ON) in the Cloudflare DNS settings.

#### 2. Cloudflare Cache Rules Configuration
Go to your **Cloudflare Dashboard -> Caching -> Cache Rules** and create two new rules:

**Rule 1: Cache `.ts` Video Segments (Force Cache)**
- **Field:** URI Path
- **Operator:** ends with
- **Value:** `.ts`
- **Action:** Cache Everything (Eligible for Cache)
- **Edge Cache TTL:** 2 hours (or 1 day)
- **Browser Cache TTL:** 30 minutes

**Rule 2: Bypass `.m3u8` Playlists (Real-time Live Feed)**
- **Field:** URI Path
- **Operator:** ends with
- **Value:** `.m3u8`
- **Action:** Bypass Cache (Or set Edge Cache TTL to 1 second)

---

## 🚀 Task 2: Automated Cloudflare R2 VOD Archiving (Storage Cleanup)

### ℹ️ The Goal
When a live stream ends, we need to stitch the hundreds of 2-second `.ts` chunks on the media server into a single high-quality `.mp4` file, upload it to R2 (which has free bandwidth egress), update Supabase, and delete the temporary files on the GCP server to free up space.

### ⚠️ Critical Architecture Constraint
Our Next.js Admin Panel runs on **Cloudflare Pages (Edge Runtime)**. Edge runtime **cannot** execute heavy commands like `ffmpeg` or access a local filesystem. Therefore, the VOD stitching script **MUST run on the GCP VM (Media Server)** itself where Restreamer and FFmpeg are already installed.

### 🛠️ Execution Plan (Copy/Paste this prompt to Cursor)

```markdown
Act as a Senior Systems Architect. I need to build a lightweight Node.js or Python backend script that runs as a cron job on my GCP VM (Media Server) to automate Cloudflare R2 VOD Archiving.

### Context:
1. Restreamer (Datarhei) stores the recorded .ts and .m3u8 files in the local directory `/opt/restreamer/data/` (or similar docker volume mount).
2. The Next.js database is Supabase. We have an `events` table with columns: `id`, `slug`, `youtube_status` (becomes 'completed' when live ends), `video_url` (the VOD link, currently null).
3. The GCP VM already has `ffmpeg` installed.

### Requirements for the Script (`vod-archiver.js` or `vod-archiver.py`):
1. **Fetch Pending Events:** Connect to Supabase and find events where `youtube_status = 'completed'` AND `video_url` is NULL.
2. **Locate HLS Files:** For each pending event, look into the Restreamer data directory and locate the `<slug>.m3u8` and the corresponding `<slug>*.ts` files.
3. **Stitch with FFmpeg:** Run a fast FFmpeg merge command to stitch HLS to a single MP4 without re-encoding:
   `ffmpeg -i <slug>.m3u8 -c copy <slug>.mp4`
4. **Upload to R2:** Upload the generated `<slug>.mp4` to our Cloudflare R2 Bucket. (You can use the S3 API or trigger a POST request to our Next.js API `/api/r2-upload` route, passing the file).
5. **Update Supabase:** Update the event's `video_url` column in Supabase with the public R2 URL of the MP4.
6. **Cleanup Local Disk:** Once upload is verified, delete the temporary `<slug>.mp4` from the VM disk AND call the Restreamer API or run a filesystem command to delete the raw `.ts` and `.m3u8` files to free up space on the VM.

Please write the complete, clean, and production-ready script. Include clear setup instructions (dependencies, env variables) and how to schedule it using a standard Linux systemd service or crontab on the GCP VM.
```
