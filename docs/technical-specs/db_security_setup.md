# 🧠 Knowledge Item: Database & Security Architecture

This document tracks the data management and security principles of Eventcast Pro.

## 🗄️ Database (Supabase)
- **Primary Tables**: `events`, `wishes`, `photographers`.
- **Security**: Row Level Security (RLS) is enabled. Service Role Key is used for server-side logic.

## 🛡️ Admin Panel Security
- **Path Exclusion**: `robots.txt` disallows `/admin`.
- **Environment Variables**: Sensitive keys managed via `.env.local`.

## 🏷️ Event Metadata Logic
- **Slug Generation**: Groom Name + Bride Name + Event Type.
- **Social Metadata**: Dynamic OG tags via Cloudinary and absolute URLs.
