# 📔 Eventcast Pro - Collaborative Development Journey

This diary is a detailed record of the evolution of Eventcast Pro. It documents the problems we encountered, our discussions on how to solve them, and the technical decisions that shaped the platform.

---

## 🏛️ Session 3: Admin Dashboard Hardening & Operational Tools
**Date: May 4 - May 11, 2026**

### 🔍 Context
The goal was to make the admin dashboard fully mobile-responsive and secure the underlying data structure before scaling.

### 🗣️ Our Discussion
We discussed the best way to utilize Google Cloud credits for future AI features while maintaining a secure Supabase backend. We also planned for a photographer management system to handle credits and branding automatically.

### 🛠️ What we did & Why
1. **Mobile Responsiveness**: Transformed the admin panel into a fully responsive interface.
   - *Why?* To allow event management on-the-go via smartphones.
2. **Security Hardening**: Implemented `robots.txt` for admin exclusion and Supabase Row-Level Security (RLS).
   - *Why?* To prevent sensitive admin data from appearing in Google searches.
3. **Internal Tools**: Added collapsible sidebars, peak hour charts, and internal event notes.

---

## 🏛️ Session 4: Template Automation & Initial Launch
**Date: April 23 - May 2, 2026**
## 🏛️ Session 1: The "Live-to-VOD" Challenge & YouTube Relay
**Date: May 13-14, 2026**

### 🔍 The Problem
User was facing issues where the private live stream would stop working if they edited and saved an event. Also, there was no way to stop the YouTube stream without stopping the whole server. Most importantly, once a live ended, the private server only played the last few seconds, making it useless for "replaying" the wedding for late-comers.

### 🗣️ Our Discussion
We realized that our HLS settings were too aggressive (deleting old segments to save space). This was fine for "real-time" but bad for "memories". 
We also discussed the "Edit & Save" bug—it turns out the YouTube stream keys were being lost during the form submission because the state management wasn't preserving them.

### 🛠️ What we did & Why
1. **The Fix**: We updated the `restreamer.ts` configuration. 
   - *Why?* By removing `delete_segments` and setting `hls_list_size` to `0`, we told the server: "Keep every single second of this wedding on the disk."
2. **The Relay Toggle**: We created a new API and a UI toggle in the Admin Dashboard.
   - *Why?* This gives the user "Surgical Control". You can start the private stream early, but only hit the "YouTube Relay" button when the actual ceremony starts.
3. **The Buffer Fix**: We noticed the stream was "pausing and playing" every 5 seconds.
   - *Why?* We found the bitrate was high (10Mbps at one point) and the player buffer was too small. We increased the Hls.js buffer to 60 seconds of "safety net" data.

### 💡 Results & Learnings
The platform is now much more robust. The "Wait for Stream" loader in the template now polls the server until it's actually live, ensuring a smooth experience for guests.
*Learning*: High bitrates are the enemy of stability. Always aim for 4000-5000 kbps for the best balance.

---

## 🎨 Session 2: Aesthetic Refinements & User Experience
**Date: May 15, 2026**

### 🔍 The Problem
The video player on the landing page had an ugly black gap at the bottom, making it look unpolished. The user also wanted a better way to track our work.

### 🗣️ Our Discussion
We looked at the screenshot and realized the CSS "Intrinsic Ratio" (16:9) was working, but the injected Plyr container wasn't "filling" its parent correctly because it lacked absolute positioning. We also talked about creating this very diary—a way to keep our "brainstorming" alive in text.

### 🛠️ What we did & Why
1. **UI Fix**: Updated `script.js` to inject the player with `position: absolute; top: 0; left: 0;`.
   - *Why?* This forces the player to fill every pixel of the white container, removing the gap.
2. **Master Diary**: Created this narrative-style log.
   - *Why?* To move away from simple "Task Lists" and towards a "Shared Knowledge Base".

---

## 🚀 The Roadmap Ahead
- **AI Thumbnail Engine**: We want to use Vertex AI to look at the groom/bride names and event type to generate a stunning, artistic thumbnail automatically.
- **System Sentinel**: An AI-driven health check that will alert us if the server CPU is too high or if a stream is lagging.
- **Multi-Camera Logic**: Designing a way for users to switch between a "Main Stage" and "Entrance" camera within the same player.

---

## 🏗️ Wedding Template-01: Technical Architecture & Rules
**Date: May 15, 2026**

### 🔍 Context
We standardized the logic for `wedding-template-01` to ensure it's not just a design, but a robust streaming application.

### 🛠️ Core Rules & Logic Implemented
1. **Anytime-Start Logic**: 
   - *Rule*: The player polls the server every 2s. If an RTMP signal is detected from OBS (even before the scheduled time), the player initializes immediately.
   - *Rationale*: To handle early starts or pre-wedding rituals without user intervention.
2. **Auto-VOD Fallback**:
   - *Rule*: If the HLS stream returns a 404 or ends, the player switches to the embedded YouTube VOD after a 5s delay.
   - *Rationale*: Guaranteed content delivery; the user never sees a "dead" player.
3. **Stability over Latency**:
   - *Rule*: High buffer settings (60s max) in Hls.js to handle mobile network jitter.
   - *Rationale*: Prevents the frequent pause/play cycles that irritate wedding viewers.

---

## 🧠 Template Intelligence & Resource Management
**Date: May 15, 2026**

### 🔍 Context
We implemented "Smart Rules" to ensure the templates are efficient, resource-friendly, and maintain a polished look regardless of the data provided.

### 🛠️ Core Intelligence Rules
1. **Dynamic Visibility Logic**: 
   - *Rule*: Sections like 'Invitation Video' or 'Photo Gallery' must automatically hide if no data is provided. They re-appear instantly once data is added in the admin panel.
   - *Rationale*: Prevents broken or empty layouts, ensuring a premium feel at all times.
2. **Smart Focus Playback**:
   - *Rule*: Videos and slideshows only play when in the user's viewport. If a user scrolls away, these elements must auto-pause.
   - *Rationale*: Massive bandwidth savings and better performance on mobile devices.
3. **Cloudinary Credit Sentinel**:
   - *Rule*: Actively monitor Cloudinary usage and provide early warnings before credits are exhausted.
   - *Rationale*: To prevent sudden image loading failures during high-traffic live events.

---
*This diary is a living document. We add to it as we build, ensuring no detail is ever lost.*

