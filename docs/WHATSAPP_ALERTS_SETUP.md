# WhatsApp Stream Alerts — Setup Guide

Stream health cron already runs via GitHub Actions. WhatsApp delivery uses **CallMeBot** (free tier).

## 1. Supabase migration

Run once in Supabase SQL Editor (if not already applied):

`eventcast-admin/supabase/migrations/0008_stream_alerts.sql`

## 2. CallMeBot registration

1. Open https://www.callmebot.com/blog/free-api-whatsapp-messages/
2. Add their WhatsApp contact and send the activation message from **your** phone.
3. Copy your **API key** from their site.

## 3. Cloudflare Pages environment variables

In **eventcast-admin** project → Settings → Environment variables (Production):

| Variable | Example | Notes |
|----------|---------|--------|
| `ALERT_WHATSAPP_PHONE` | `+919876543210` | Country code required |
| `ALERT_WHATSAPP_APIKEY` | from CallMeBot | Keep secret |
| `CRON_SECRET` | long random string | Already used by cron |
| `ADMIN_PUBLIC_URL` | `https://eventcast-admin.pages.dev` | Link inside alert message |
| `WHATSAPP_ALERT_COOLDOWN_MINUTES` | `30` | Optional; avoids repeat pings |

Redeploy after saving env vars.

## 4. GitHub Actions secrets

Repository → Settings → Secrets → Actions:

| Secret | Value |
|--------|--------|
| `ADMIN_BASE_URL` | `https://eventcast-admin.pages.dev` |
| `CRON_SECRET` | Same as Cloudflare |

## 5. Test manually

Replace `SECRET` and base URL:

```bash
curl "https://eventcast-admin.pages.dev/api/cron/stream-health-monitor?secret=SECRET"
```

- HTTP 200 + `alertsTriggered: 0` during no live window = healthy.
- During a live event with a broken stream, you should receive one WhatsApp per alert type per 30 minutes.

## Troubleshooting

- No message: verify CallMeBot is still linked to your number.
- Too many messages: increase `WHATSAPP_ALERT_COOLDOWN_MINUTES`.
- Cron never runs: check GitHub Actions tab for failed workflows.
