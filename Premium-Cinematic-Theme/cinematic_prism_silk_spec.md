# Specification: Cinematic Prism & Silk Wedding Theme

This document defines the visual, structural, and behavioral standards for the **Cinematic Prism & Silk** wedding livestream page. This theme is designed for a digital-first, "Gala" or "Red Carpet" atmosphere.

---

## 1. Visual Identity & Assets

### 🎨 Color Palette
- **Primary Background**: `#0F0F12` (Midnight Charcoal) or `#2B221B` (Sunset Bronze).
- **Accents**: `#F4D03F` (Sun-Drenched Gold) for thin frames; `#FFFAF0` (Ivory Silk) for typography.
- **Glassmorphism**: Mixed opacity frosted glass (`rgba(255, 255, 255, 0.05)`) with a custom gold-foil border effect (`border: 1px solid rgba(212, 175, 55, 0.2)`).

### 🖋️ Typography
- **Headlines/Names**: [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) (High-contrast Serif) or [Montserrat](https://fonts.google.com/specimen/Montserrat) (Modern Wide Sans).
- **Secondary Headers**: [Cinzel](https://fonts.google.com/specimen/Cinzel).

### 🖼️ Key Assets
- **[concept_mockup.png](./concept_mockup.png)**: The core visual reference for this design.
- **`liquid_silk_loop.mp4` or CSS fallback**: High-end silk texture with slow-moving wave animations.
- **`prism_flare.png`**: High-quality light-leak/flare images for atmospheric overlays.

---

## 2. Core Components

### 🎞️ Cinematic Broadcasting Hub
- **21:9 Framing**: The video player should have a cinematic aspect ratio (or be framed in one).
- **Floating Aura**: The player should have a 1px glowing gold border that pulses at a frequency of 0.5Hz.
- **Prism Flare**: A fixed or parallax-positioned light-leak overlay that adds "bloom" to the corners of the player.

### ⏳ Floating Glass Timer
- **Style**: A sleek, horizontal pill-style glass panel floating above the hero content.
- **Animation**: Numbers fade and slide upwards when they increment.

### 📜 Shard-style Wish Wall
- **Layout**: "Glass Shards" — Wishes are displayed on individual frosted glass panels that update with a shimmer animation when a new wish is received from Supabase.
- **Responsive**: Stacks beautifully into a vertical "Gallery" on mobile devices.

---

## 3. Advanced Effects (VFX)

### 🎆 Sun-Drenched Bokeh (Canvas)
- **Engine**: HTML5 Canvas.
- **Behavior**: Drifting gold bokeh particles that change size and opacity based on "Virtual Wind".
- **Interaction**: Particles should subtly react to cursor movement (parallax displacement).

### 🎬 Scene Transition
- **Reveal**: Sophisticated clip-path mask animations that "open" the page from the center outwards on load.

---

## 4. Technical Integration

### 🔗 Backend (Wishes)
- **Supabase Channel**: `public:wishes_cinema`.
- **Logic**: Real-time subscriptions for immediate display of blessings.

### 📅 Event Configuration
- **Date**: Wednesday, April 8, 2026, 8:30 AM IST.

---
*Created by Eventcast.pro — A New Era of Digital Celebrations.*
