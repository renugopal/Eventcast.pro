# ✅ Eventcast Pro - Task Log & Progress Tracker

This document provides a concise summary of completed and pending tasks.

## 🏁 Completed Tasks

### Streaming & Infrastructure
- [x] Fixed HLS Player ReferenceError in `script.js`.
- [x] Standardized RTMP ingest: `rtmp://34.100.142.25/{slug}`.
- [x] Implemented YouTube Auto-VOD Fallback.
- [x] Added Independent YouTube Relay Toggle.
- [x] Enabled Full Stream VOD recording on persistent storage ({data}).
- [x] Integrated Restreamer UI Metadata for dashboard visibility.
- [x] Optimized HLS buffering for high-bitrate streams.
- [x] Added "Force Restart" button for media processes.
- [x] **Smart UI Logic**:
    - [x] Dynamic section visibility (Hide if empty).
    - [x] Auto-pause video/slideshow on scroll.
- [x] **Resource Guard**:
    - [x] Cloudinary credit monitoring & alerting.

### UI & UX
- [x] Fixed video player bottom gap/alignment issue.
- [x] Added wait-for-stream polling loader in landing pages.
- [x] Implemented Project Diary & Narrative Log (English & Telugu).

### Admin Dashboard
- [x] Fixed YouTube metadata persistence during "Edit & Save".
- [x] Added YouTube Relay status indicators in EventTable.
- [x] Implemented Mobile-Responsive Admin Dashboard.
- [x] Secured backend with Supabase Row-Level Security (RLS).
- [x] Added `robots.txt` to prevent admin panel indexing.
- [x] Implemented Operational Analytics (Peak Hours chart).
- [x] Added Photographer Management & Branding system.
- [x] Integrated System Sentinel health monitoring.

### Template Features
- [x] Automated video auto-play for invitation videos.
- [x] Implemented Open Graph (OG) metadata for social sharing.
- [x] Standardized SEO semantic HTML for all templates.
- [x] **Live Viewer Count (Premium)**: Integrated Supabase Realtime Presence across all templates (with auto-hide and tab-visibility logic).
- [x] **Telugu Localization (Premium)**: Added a premium frosted-glass language toggle (EN | తె) with localStorage memory and Noto Sans Telugu typography.
- [x] **Wedding Template-01 Rules**: 
    - [x] Anytime-Start polling logic.
    - [x] Automated YouTube VOD Fallback.
    - [x] Stability-first Hls.js configuration.
    - [x] Real-time Wishes Wall integration.

---

## 🛠️ Ongoing / Pending Tasks

### High Priority
- [ ] White Labeling: Custom Live Control Center in Admin Dashboard (Replace Restreamer UI).
- [ ] AI Thumbnails: Auto-generate event thumbnails using Vertex AI.
- [x] **Restreamer Token Cache**: `RestreamerClient.getAuthToken()` now caches the Bearer token at module level (key: `url::username`) with a 55-minute TTL. All 7 methods share the same token within an Edge worker isolate — reduces `/api/login` calls from N-per-cron-tick to 1-per-55-min. `invalidateToken()` auto-evicts on HTTP 401 so stale tokens self-heal without a worker restart.
- [x] **GitHub Rate Limit — Recursive Tree Fetch (generate)**: `/api/events/generate` now uses the GitHub Contents API (`GET /repos/.../contents/{templatePath}`) instead of `?recursive=1` to locate template files. Response is O(template_files) not O(repo_size). Safe at 1000+ events.
- [x] **GitHub Rate Limit — Bulk Delete**: `/api/events/delete` now lists only the target event folder's files via the Contents API and removes them by sending `sha:null` entries against `base_tree`. Single targeted commit; never re-lists the full repo. `deleteMultipleEvents()` in the admin panel now processes deletions in sequential batches of 2 (instead of a single `Promise.all`) to avoid 429 responses on the GitHub API.
- [x] **Stream Health Monitor**: Cron route `/api/cron/stream-health-monitor` built. Polls Restreamer for bitrate/state per live event window. Alerts via Supabase `stream_alerts` table + optional WhatsApp (CallMeBot). Enable WhatsApp by adding `ALERT_WHATSAPP_PHONE` + `ALERT_WHATSAPP_APIKEY` to `.env.local`.
- [x] **Event Deletion**: Purge VOD/HLS media files from Restreamer `data/` filesystem on event delete (`deleteChannelFiles` added to `RestreamerClient`, wired into `/api/events/delete`).

### Planned Features
- [ ] **Multi-Camera Support**: Internal switching between streams.
- [ ] **Smart TV Casting**: AirPlay and Chromecast integration.
- [ ] **Viewer Analytics**: Peak viewer charts and geo-data.

---
*Status: Active Development*
