# Live VOD Uploader — Deploy on GCP VM

Uploads HLS archive segments from Restreamer to Cloudflare R2 **during the live event**.

## Safety

| Rule | Behaviour |
|------|-----------|
| Upload fails | Local `.ts` **kept** — retried next poll |
| Upload succeeds | R2 verified → local `.ts` **deleted** |
| `index.m3u8` | Uploaded on change — **never deleted** during stream |
| Live HLS / YouTube | **Not touched** — separate FFmpeg outputs |

## Quick Deploy (GCP VM)

```bash
# 1. Copy files to VM
sudo mkdir -p /opt/eventcast/vod-uploader
# (copy this folder from your dev machine)

# 2. Install deps
cd /opt/eventcast/vod-uploader
npm install

# 3. Configure
cp .env.example .env
nano .env   # fill R2 + Restreamer + Supabase credentials

# 4. Test manually (foreground)
node live-uploader.mjs

# 5. Install systemd service
sudo cp vod-uploader.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable vod-uploader
sudo systemctl start vod-uploader
sudo systemctl status vod-uploader
```

## After Event Ends

```bash
cd /opt/eventcast/vod-uploader
node finalize-vod.mjs chinna-eswari-wedding
```

This will:
1. Upload any remaining segments
2. Add `#EXT-X-ENDLIST` to playlist
3. Update Supabase `vod_link`

## Logs

```bash
journalctl -u vod-uploader -f
```

## Disk

With `DELETE_AFTER_UPLOAD=true`, only ~1–2 minutes of segments stay on disk per active stream (upload lag buffer).

100 GB disk comfortably supports **2 simultaneous 8-hour events**.

## Failure Recovery

If uploader stops mid-event:
1. `systemctl restart vod-uploader` — catch-up resumes automatically
2. Or run `node finalize-vod.mjs <slug>` after event

Unuploaded segments remain on Restreamer disk until uploaded.
