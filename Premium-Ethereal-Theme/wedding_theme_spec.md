# Specification: Ethereal Watercolor Floral Wedding Theme

This document defines the visual, structural, and behavioral standards for the **Ethereal Watercolor Floral** wedding livestream page.

---

## 1. Visual Identity & Assets

### 🎨 Color Palette
- **Primary Background**: `#FDFCF0` (Warm Ivory) or a multi-color watercolor wash (`#FDF5F7` Pink to `#E8F3F1` Sage).
- **Accents**: `#D4AF37` (Classic Gold) for frames, borders, and icons.
- **Typography**: `#2D3436` (Soft Charcoal) for body; `#8E443D` (Deep Rose) for names/accents.
- **Surface**: `rgba(255, 255, 255, 0.85)` with `backdrop-filter: blur(10px)` (Glassmorphism).

### 🖋️ Typography
- **Headlines/Names**: [Great Vibes](https://fonts.google.com/specimen/Great+Vibes) (Cursive/Calligraphy).
- **Secondary Headers**: [Playfair Display](https://fonts.google.com/specimen/Playfair+Display) (Elegant Serif).
- **Body Text**: [Inter](https://fonts.google.com/specimen/Inter) or [Montserrat](https://fonts.google.com/specimen/Montserrat) (Clean Sans-serif).

### 🖼️ Key Assets
1.  **`watercolor_bg.jpg`**: A full-bleed, subtle watercolor texture.
2.  **`floral_corner_tl.png`, `floral_corner_tr.png`, etc.**: High-resolution watercolor flower clusters (Roses, Peonies, Eucalyptus) for corners.
3.  **`paper_texture.jpg`**: A scanned handmade paper texture used as an overlay on content cards.

---

## 2. Core Components

### 🏛️ Hero Section
- **The Wreath/Ring**: A thin, slightly glowing Gold Circle (SVG) centered on the screen.
- **Signature**: The couple's names (e.g., *Sathwik & Sumanayana*) nested inside the ring in large cursive.
- **Corner Florals**: Four floral clusters positioned absolutely in corners. They should have a subtle "breathe" or "sway" animation (CSS `@keyframes`).

### ⏳ Countdown
- **Style**: A floating pill or glass-card.
- **Behavior**: Real-time ticker. On event start, transitions into a "Live Now" badge with a pulse effect.

### 🎥 Broadcast Hub
- **Frame**: The YouTube/Vimeo iframe should be framed with a white paper margin and gold thin lines.
- **Status Badge**: "LIVE" indicator with a standard red pulse animation.

### 📜 Wish Wall
- **Layout**: "Magazine Style" — a left-side submission form and a right-side scrollable wall of cards.
- **Cards**: Each wish should look like a small physical card (paper texture, soft shadow, elegant border).

---

## 3. Advanced Effects (VFX)

### 🌸 Falling Petals (Canvas)
- **Engine**: HTML5 Canvas overlay.
- **Physics**: Soft gravity, wind-sway (sine wave), and slow rotation.
- **Sprites**: 3-4 variations of watercolor-style petal/leaf PNGs.

### ✨ Interaction
- **Scroll Reveal**: Elements should fade and slide upwards as the user scrolls (staggered delay).
- **Hover States**: Golden glows on buttons; subtle zoom on floral elements.

---

## 4. Technical Integration

### 🔗 Backend (Wishes)
- **Supabase**: Table `wishes` (id, name, message, created_at, event_id).
- **Real-time**: Utilize Supabase Realtime (Channels) to update the wall instantly without refreshing.

### 📅 Countdown Logic
- Target Date should be configurable via a `CONFIG` object in JavaScript.

---
*Created by Eventcast.pro — Cinematic Wedding Livestreaming.*
