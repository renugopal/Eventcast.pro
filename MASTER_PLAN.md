# 🎯 EVENTCAST PRO — MASTER PLAN
**Last Updated:** May 1, 2026  
**Version:** 1.0  
**Purpose:** Single source of truth — past work, bugs, roadmap, architecture

---

## 📐 SECTION 1: SYSTEM ARCHITECTURE

```
USER (Browser)
    ↓
eventcast.pro (Cloudflare Pages — Static Hosting)
    ├── /events/[slug]/index.html  ← Wedding page
    ├── /events/[slug]/config.js   ← Dynamic event config
    └── /events/[slug]/script.js   ← Logic (from template)

ADMIN PANEL (Next.js → Cloudflare Pages)
admin.eventcast.pro
    ↓ API Routes
    ├── /api/events/generate  → Generates config.js + index.html → deploys to Cloudflare
    ├── /api/youtube          → Creates YouTube Live broadcast
    ├── /api/youtube/toggle-live → Go Live / End Live
    ├── /api/cloudinary-signature → Secure uploads
    └── /api/assets           → Asset library management

DATABASES & SERVICES:
    ├── Supabase (PostgreSQL)
    │     ├── events table
    │     ├── photographers table
    │     ├── wishes table         ← per event_id filtered
    │     └── page_views table     ← analytics tracking
    ├── Cloudinary                 ← Media storage (images, videos)
    ├── Cloudflare Pages           ← Static site hosting + KV
    └── YouTube Data API v3        ← Livestream management
```

---

## ✅ SECTION 2: COMPLETED FEATURES

### 2A. Admin Panel — Create Event Form
| Feature | Status | Notes |
|---------|--------|-------|
| Create new event | ✅ Done | Full form with all fields |
| Edit existing event | ✅ Done | Pre-fills form with event data |
| Event types: Wedding, Engagement, Birthday, Half Saree | ✅ Done | |
| **Reception event type** | ✅ Done | Added recently |
| Groom/Bride names (for couple events) | ✅ Done | |
| Celebrant name (for non-couple events) | ✅ Done | |
| Event date + time | ✅ Done | |
| Venue name + Google Maps link | ✅ Done | |
| YouTube Live integration | ✅ Done | Auto-creates broadcast |
| Thumbnail upload (Cloudinary) | ✅ Done | |
| **Multiple invitation videos upload** | ✅ Done | Up to 3 videos, auto-playlist |
| Photo gallery bulk upload | ✅ Done | Multi-select images |
| **Photography Details** (renamed from "Assign Photographer") | ✅ Done | |
| Photographer search (by nickname/name/phone/city) | ✅ Done | |
| Auto-generate SEO thumbnail option | ✅ Done | |
| Custom intro text | ✅ Done | Multi-line support |
| Timer target time (Live Start Time) | ✅ Done | |
| **Dynamic time field label** | ✅ Done | Shows "Reception Time", "Sumuhurtham Time", "Ceremony Time" based on event type |
| WhatsApp & Social Share Preview | ✅ Done | Real-time preview in form |

### 2B. Admin Panel — Events Table
| Feature | Status | Notes |
|---------|--------|-------|
| List all events | ✅ Done | |
| Search by name/venue | ✅ Done | |
| Filter by event type | ✅ Done | |
| Export to CSV | ✅ Done | |
| Thumbnail preview per row | ✅ Done | |
| Stream key display + copy | ✅ Done | |
| Go Live / End Live buttons | ✅ Done | |
| QR code per event | ✅ Done | Download PNG |
| Edit event | ✅ Done | |
| Full delete (DB + YT + Cloudinary) | ✅ Done | |
| Share to Photographer via WhatsApp | ✅ Done | |
| Regenerate website | ✅ Done | |
| View live page link | ✅ Done | |

### 2C. Admin Panel — Photographers Section
| Feature | Status | Notes |
|---------|--------|-------|
| Register new photographer | ✅ Done | |
| **Nickname field** (internal only) | ✅ Done | Not shown on wedding page |
| **All fields optional** | ✅ Done | name, phone, city, logo, instagram |
| Logo upload via Cloudinary | ✅ Done | |
| **Search by nickname/name/phone/city** | ✅ Done | |
| Edit photographer | ✅ Done | |
| Delete photographer | ✅ Done | |
| Rich card display | ✅ Done | Shows all details including phone, city, instagram |

### 2D. Wedding Template (wedding-template-01)
| Feature | Status | Notes |
|---------|--------|-------|
| Hero section with names, date, venue, time | ✅ Done | |
| Floral wreath with initials | ✅ Done | |
| **Dynamic timeLabel** | ✅ Done | "Sumuhurtham"/"Reception"/etc. from CONFIG |
| **Dynamic intro text** | ✅ Done | Multi-line support |
| Countdown timer | ✅ Done | Auto-switches to "LIVE" when time passes |
| Floating "Watch Live" button | ✅ Done | Appears when countdown ends |
| **Invitation video section** | ✅ Done | Hides if no video provided |
| **Multiple videos auto-playlist** | ✅ Done | Plays 1→2→3→1... with dot indicators |
| YouTube Live embed | ✅ Done | |
| **Photo gallery** (Memories) | ✅ Done | Hides if no photos; title changed from "Pre-Wedding Memories" |
| Slideshow with arrows + dots | ✅ Done | Auto-advance every 5s |
| Wishes Wall | ✅ Done | Per-event (event_id filtered) |
| Real-time wishes | ✅ Done | Supabase Realtime subscription |
| Map section | ✅ Done | Embedded Google Maps |
| Photographer footer | ✅ Done | Logo, name, phone, instagram |
| **Photographer logo size** | ✅ Done | 300×190px for better readability |
| Page views counter | ✅ Done | Real count from page_views table |
| Falling petals animation | ✅ Done | Canvas-based, no image files |
| Scroll reveal animations | ✅ Done | ScrollReveal library |
| Mobile responsive | ✅ Done | |
| Cloudinary image optimization | ✅ Done | f_auto,q_auto on all images |

### 2E. SEO & Sharing
| Feature | Status | Notes |
|---------|--------|-------|
| **WhatsApp title with ❤️ emoji** | ✅ Done | "Bhanu ❤️ Pavani Wedding \| Friday, May 1st" |
| **WhatsApp description** | ✅ Done | "Join us live and be part of this beautiful wedding celebration..." |
| **YouTube title with formatted date** | ✅ Done | "Friday, May 1st" format instead of raw ISO |
| YouTube description with hashtags | ✅ Done | |
| og:image (thumbnail) | ✅ Done | |
| Twitter card | ✅ Done | |

### 2F. Performance
| Feature | Status | Notes |
|---------|--------|-------|
| **PNG files removed** | ✅ Done | bg_wash.png, floral_corner.png, petal.png, leaf.png deleted (2.4MB saved) |
| WebP assets in use | ✅ Done | bg_wash.webp, floral_corner.webp, wreath.webp |

---

## 🐛 SECTION 3: KNOWN BUGS (Priority Order)

### 🔴 Critical — Fix ASAP

| # | Location | Bug | Fix Required |
|---|----------|-----|-------------|
| B1 | Events Table | **Stream Key రావడం లేదు** — fetchEvents query లో select అవ్వట్లేదు | ✅ Fixed |
| B2 | Events Table | **Date raw format** — "2026-05-01" కనిపిస్తోంది | ✅ Fixed |
| B3 | Events Table | **Go Live button title** లో raw date | ✅ Fixed |
| B4 | Events Table | **Reception filter missing** | ✅ Fixed |
| B5 | Analytics | **Views = 0** — page_views table నుండి fetch చేయట్లేదు | ✅ Fixed |
| B6 | Analytics | **Fake data** — "4m 12s", "+12% this week" hardcoded | ✅ Fixed |
| B7 | Template | **Save to Calendar link hardcoded** — "Arjun & Nithya Wedding" | ✅ Fixed |
| B8 | Template | **Supabase race condition** — _supabase define అవ్వడానికి ముందే trackPageView() call | ✅ Fixed |
| B9 | Template | **YouTube iframe** — youtubeId empty అయినా load అవుతోంది | ✅ Fixed |

### 🟡 Medium Priority

| # | Location | Bug | Fix Required |
|---|----------|-----|-------------|
| B10 | Template | **og:url missing** — WhatsApp preview లో canonical URL లేదు | ✅ Fixed |
| B11 | Template | **"124" views hardcoded** in index.html | ✅ Fixed |
| B12 | Template | **Invitation section title** "Wedding Invitation" hardcoded | ✅ Fixed |
| B13 | Template | **CONFIG.invitationVideos** — old events లో undefined | Fallback handle చేయాలి (already partially done) |

---

## 🗺️ SECTION 4: DEVELOPMENT ROADMAP

### Phase 1: Bug Fixes (Priority: HIGH — Do First)
```
[x] B1: Stream Key in table fix
[x] B2: Date format in table
[x] B3: Go Live button date format
[x] B4: Reception filter in table
[x] B5: Real analytics views
[x] B6: Remove fake analytics data
[x] B7: Save to Calendar dynamic link
[x] B8: Supabase race condition fix
[x] B9: YouTube iframe conditional
[x] B10: og:url meta tag
[x] B11: Remove hardcoded 124 views
```

### Phase 2: Events Table Improvements
```
[x] Status badges: Upcoming 🟡 / Today 🟢 / Live 🔴 / Completed ⚫
[x] Sort by date (upcoming first)
[x] Photographer name in row
[x] Page URL one-click copy button
[x] Client WhatsApp share button
[x] Stream Key copy button (cleaner UI)
```

### Phase 3: Dashboard Home Screen (New)
```
[ ] New "Home" tab in sidebar
[ ] Today's events card
[ ] Upcoming events (next 7 days)
[ ] Stats: Total events, total views, active now
[ ] Recent activity feed (new wishes, views)
```

### Phase 4: Analytics Improvements
```
[ ] Real views per event from page_views table
[ ] Per-event analytics page
[ ] Wishes count per event
[ ] Peak hours view chart (event day)
[ ] Remove all hardcoded/fake data
```

### Phase 5: New Major Features
```
[ ] Live Monitor Screen (event day dashboard)
[ ] Client Portal Link Generator
[ ] Account Settings (default photographer, template, etc.)
[ ] Photographer stats (events count, last worked)
[ ] Notification system (today's event alert)
[ ] Sidebar collapse for wider content
[ ] Duplicate Event button
[ ] Event Notes field (internal only)
```

---

## 🏗️ SECTION 5: DATABASE SCHEMA (Supabase)

### events table (key columns):
```sql
id                    uuid (PK)
slug                  text (unique) — URL identifier
event_type            text — Wedding/Engagement/Reception/Birthday/Half Saree
groom_name            text
bride_name            text
celebrant_name        text
event_date            date
event_time            time
timer_target_time     time — Live start time
venue_name            text
venue_map_link        text
invitation_video_url  text — First video URL (DB stores first only)
gallery_urls          text[] — Array of photo URLs
thumbnail_url         text
photographer_id       uuid (FK → photographers)
youtube_broadcast_id  text
stream_key            text  ← ⚠️ Bug: not showing in table
vod_link              text
template_id           text
custom_top_title      text — Intro text
time_label            text — "Sumuhurtham"/"Reception"/etc.
show_timer            boolean
privacy_status        text
custom_initials       text — Optional manual override for loader initials
hide_loader_photo     boolean — Toggle to completely hide the loader photo
loader_photo_url      text — Optional specific photo for the loader
view_count            integer (legacy — use page_views table instead)
created_at            timestamp
```

### photographers table:
```sql
id              uuid (PK)
nickname        text  ← NEW (internal only, not on wedding page)
name            text  — Studio name (shown on page)
phone_number    text
city            text
logo_url        text
instagram_url   text
created_at      timestamp
```

### wishes table:
```sql
id          uuid (PK)
event_id    text  ← filters per event
name        text
message     text
created_at  timestamp
```

### page_views table:
```sql
id          uuid (PK)
event_id    text
device_type text — Mobile/Desktop/Tablet
referrer    text — WhatsApp/Instagram/Facebook/Direct
user_agent  text
created_at  timestamp
```

---

## 📋 SECTION 6: IMPORTANT DECISIONS LOG

| Decision | Why | Date |
|----------|-----|------|
| Multiple videos → auto-playlist (not tabs) | User wanted automatic play, not manual switching | Apr 2026 |
| PNG files deleted, WebP used | 2.4MB savings, WebP was already referenced in CSS | Apr 2026 |
| invitation_video_url stores only FIRST video | DB backward compatibility; config.js gets full array | Apr 2026 |
| All photographer fields optional | Not all photographers provide all details | Apr 2026 |
| Nickname field — internal only | Privacy; only admin sees it, not on wedding page | Apr 2026 |
| timeLabel from eventType | Reception→"Reception", Wedding→"Sumuhurtham" | Apr 2026 |
| Gallery title → "Memories" (not "Pre-Wedding Memories") | Clients give engagement/other photos too | Apr 2026 |
| page_views table over view_count column | Accurate per-visit tracking, device/referrer data | Apr 2026 |

---

## 🔧 SECTION 7: KEY FILE LOCATIONS

```
d:\Eventcast.pro\
├── eventcast-admin\                    ← Next.js Admin Panel
│   └── src\app\
│       ├── page.tsx                    ← Main admin UI (Create Event form)
│       ├── components\
│       │   ├── EventTable.tsx          ← All Events table
│       │   ├── PhotographerManagement.tsx
│       │   ├── AnalyticsDashboard.tsx
│       │   ├── WishesModeration.tsx
│       │   ├── Sidebar.tsx
│       │   └── AssetLibrary.tsx
│       └── api\
│           ├── events\generate\route.ts  ← CORE: generates config.js + deploys
│           ├── youtube\route.ts          ← YouTube broadcast creation
│           ├── youtube\toggle-live\route.ts
│           └── cloudinary-signature\route.ts
│
└── wedding-template-01\               ← Base Wedding Template
    ├── index.html                     ← Structure (sections)
    ├── style.css                      ← Design/colors
    ├── script.js                      ← All dynamic logic (CONFIG driven)
    ├── config.js                      ← Template defaults (overridden per event)
    ├── bg_wash.webp                   ← Background texture (8.5KB)
    ├── floral_corner.webp             ← Corner decoration (124KB)
    └── wreath.webp                    ← Center wreath (132KB)
```

---

## 📝 SECTION 8: HOW TO USE THIS DOCUMENT

### When starting a new session:
```
"Master plan চదువు" → నేను instant context తీసుకుంటాను
```

### When a bug is fixed:
```
"B1 bug fix అయింది, master plan update చేయి"
→ నేను ✅ Done గా mark చేస్తాను
```

### When a new feature is implemented:
```
"Phase 2 లో status badges implement చేశాం, update చేయి"
→ నేను checklist లో ✅ mark చేస్తాను
```

### When new bugs are found:
```
"కొత్త bug చూశాను: [details]"
→ నేను Section 3 లో add చేస్తాను
```

### When planning next session:
```
"ఈ రోజు Phase 1 bugs fix చేద్దాం"
→ నేను bug tracker చూసి which ones pending అని చెప్తాను
```

---

## 📊 SECTION 9: CURRENT STATUS SUMMARY

```
Admin Panel:     80% complete
  Create Event:  ✅ 95% done
  Events Table:  ⚠️ 70% done (bugs pending)
  Photographers: ✅ 90% done
  Analytics:     ⚠️ 40% done (fake data issue)
  Settings:      ❌ Empty

Wedding Template: ✅ 100% complete
  Core sections: ✅ All done
  Dynamic logic: ✅ All done  
  Bugs:         ✅ 0 bugs pending (All Template bugs fixed)
  Performance:  ✅ WebP optimized

SEO/Sharing:    ✅ 100% done (og:url added)
```

---

*This document should be updated at end of every development session.*
*Path: C:\Users\Renugopal\.gemini\antigravity\brain\c9b5c684-c85d-41d7-b9cc-ef97df1aea8a\master_plan.md*
