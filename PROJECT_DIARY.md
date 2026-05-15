# 📔 Eventcast Pro - Collaborative Development Journey

This diary is a detailed record of the evolution of Eventcast Pro. It documents the problems we encountered, our discussions on how to solve them, and the technical decisions that shaped the platform.

---

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
*This diary is a living document. We add to it as we build, ensuring no detail is ever lost.*

