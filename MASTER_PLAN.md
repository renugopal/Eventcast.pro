# 🎯 EVENTCAST PRO — MASTER PLAN
**Last Updated:** May 4, 2026  
**Version:** 1.1  
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
    ├── /api/youtube/toggle-live → Go Live / End Live (Syncs to DB)
    ├── /api/cron/sync-live-status → Automated Start/End background job
    ├── /api/cloudinary-signature → Secure uploads
    └── /api/assets           → Asset library management

DATABASES & SERVICES:
    ├── Supabase (PostgreSQL)
    │     ├── events table         ← added youtube_status column
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

### 2B. Admin Panel — Events Table (Excel-like UI)
| Feature | Status | Notes |
|---------|--------|-------|
| List all events | ✅ Done | |
| **Resizable Columns** | ✅ Done | Drag-to-resize, double-click to auto-fit |
| **Bulk Selection & Actions** | ✅ Done | Select multiple rows for bulk delete |
| **Bulk Delete** | ✅ Done | Deletes multiple events from DB/Files |
| **Information Consolidation** | ✅ Done | Venue & Photographer merged into one column |
| **QR Hover Interface** | ✅ Done | Moved QR from column to hoverable icon in Actions |
| **Wishes Count Badge** | ✅ Done | Real-time count of guest wishes per row |
| **Real-time Views Count** | ✅ Done | Fetched from page_views table (fixed 0 issue) |
| Search by name/venue | ✅ Done | |
| Filter by event type | ✅ Done | |
| Export to CSV | ✅ Done | |
| Thumbnail preview per row | ✅ Done | |
| Stream key display + copy | ✅ Done | |
| Go Live / End Live buttons | ✅ Done | |
| Full delete (DB + YT + Cloudinary) | ✅ Done | |
| Share to Photographer via WhatsApp | ✅ Done | |
| Regenerate website | ✅ Done | |
| View live page link | ✅ Done | |

### 2C. Admin Panel — Automation & Lifecycle
| Feature | Status | Notes |
|---------|--------|-------|
| **Automated Start** | ✅ Done | Prepends "🔴 LIVE NOW" to YT title at event start |
| **Automated End** | ✅ Done | Removes tag & marks completed 12h later |
| **YouTube Status Sync** | ✅ Done | youtube_status column in DB synced with actual YT state |

### 2D. Admin Panel — Photographers Section
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

### 2E. Wedding Template (wedding-template-01)
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

---

## 🐛 SECTION 3: KNOWN BUGS (Priority Order)

### 🔴 Critical — Fix ASAP
| # | Location | Bug | Status |
|---|----------|-----|--------|
| B5 | Events Table | **Views = 0** — Not fetching from page_views | ✅ Fixed |
| B13| Template | **invitationVideos** undefined in old events | Fallback needed |

### 🟡 Medium Priority
| # | Location | Bug | Status |
|---|----------|-----|--------|
| B14| Analytics | Dashboard stats (Home) are still placeholders | ❌ Pending |

---

## 🗺️ SECTION 4: DEVELOPMENT ROADMAP

### Phase 1-2: Core Platform (COMPLETED)
- [x] Bug fixes & Stability
- [x] Excel-like Table Interface
- [x] YouTube Automation Lifecycle
- [x] Real-time Engagement Badges (Wishes)

### Phase 3: Dashboard Home Screen (COMPLETED)
- [x] New "Home" tab in sidebar
- [x] Today's events card (Live Tracking)
- [x] Upcoming events (next 7 days)
- [x] Stats: Total events, total views, active now
- [x] Recent activity feed (new wishes, views)

### Phase 4: Analytics Improvements (COMPLETED)
- [x] Wishes count per event in table
- [x] Remove hardcoded/fake views in table
- [x] Per-event analytics detailed page
- [x] Peak hours view chart (event day visualizer)

### Phase 5: New Major Features (COMPLETED)
- [x] Live Monitor Screen (event day dashboard)
- [x] Client Portal Link Generator (Read-only stats/wishes for clients)
- [x] Duplicate Event button (One-click cloning)
- [x] Account Settings (Default event settings persistence)
- [x] Sidebar collapse for wider content
- [x] Event Notes field (internal team communication)

---

## 🏗️ SECTION 5: DATABASE SCHEMA (Supabase Updates)

### events table (new/critical columns):
```sql
id                    uuid (PK)
youtube_status        text DEFAULT 'upcoming'  ← NEW (automated/manual)
view_count            integer (Calculated in UI from page_views)
photographer_id       uuid (FK → photographers)
...
```

---

## 📋 SECTION 6: IMPORTANT DECISIONS LOG

| Decision | Why | Date |
|----------|-----|------|
| Consolidate QR code to Hover | Saves 80px horizontal space in table | May 2026 |
| Automated YT Lifecycle | Reduce manual admin intervention on event day | May 2026 |
| Resizable Columns | High-density data management requires manual fit | May 2026 |
| Wishes badge in Identity | Immediate visual feedback on event popularity | May 2026 |
| Client Portal Route | Provide value to clients with read-only dashboard | May 2026 |

---

## 📊 SECTION 7: CURRENT STATUS SUMMARY

```
Admin Panel:     95% complete
  Create Event:  ✅ 95% done
  Events Table:  ✅ 100% done (All features + Excel UI)
  Photographers: ✅ 90% done
  Analytics:     ✅ 90% done (Detailed views added, Home stats fixed)
  Automation:    ✅ 100% done (Cron + Sync)
  Portal/Monitor: ✅ 90% done
  
Wedding Template: ✅ 100% complete
```

---

*This document updated automatically at end of session.*
*Path: d:\Eventcast.pro\MASTER_PLAN.md*
