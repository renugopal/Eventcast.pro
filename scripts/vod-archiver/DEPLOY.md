# VOD Archiver — GCP VM Deployment Guide

Deploys the `vod-archiver.js` cron job as a **systemd timer** on the Eventcast
Media Server (GCP VM running Datarhei Restreamer).

---

## Prerequisites

| Requirement | Check |
|---|---|
| GCP VM accessible via SSH | `ssh ubuntu@media.eventcast.pro` |
| Node.js ≥ 18 installed | `node --version` |
| FFmpeg installed | `ffmpeg -version` |
| Restreamer data dir readable | `ls /opt/restreamer/data` |
| R2 bucket has public access ON | Cloudflare Dashboard → R2 → eventcast-media → Settings → Public Access |

---

## Step 1 — SSH into the GCP VM

```bash
ssh ubuntu@media.eventcast.pro
```

---

## Step 2 — Install Node.js 20 (if not present)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # should print v20.x.x
```

---

## Step 3 — Copy the script to the VM

**Option A — from your local machine (run this in PowerShell/Terminal, not on the VM):**

```powershell
scp -r "D:\Eventcast.pro\scripts\vod-archiver" ubuntu@media.eventcast.pro:/tmp/vod-archiver-src
```

**Option B — clone just the scripts folder via git on the VM:**

```bash
# On the VM:
git clone --no-checkout --depth=1 https://github.com/your-org/eventcast.git /tmp/repo
cd /tmp/repo
git sparse-checkout set scripts/vod-archiver
git checkout
cp -r scripts/vod-archiver /tmp/vod-archiver-src
```

---

## Step 4 — Install to /opt/vod-archiver

```bash
sudo mkdir -p /opt/vod-archiver
sudo cp /tmp/vod-archiver-src/vod-archiver.js /opt/vod-archiver/
sudo cp /tmp/vod-archiver-src/package.json     /opt/vod-archiver/

# Install production Node dependencies
cd /opt/vod-archiver
sudo npm install --omit=dev

# Fix ownership so the 'ubuntu' user can run it
sudo chown -R ubuntu:ubuntu /opt/vod-archiver
```

---

## Step 5 — Create the .env file

```bash
sudo nano /opt/vod-archiver/.env
```

Paste the following (fill in the secrets):

```dotenv
# Supabase
SUPABASE_URL=https://lteogzqeuuoxlekhofow.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<paste-service-role-key-from-env.local>

# Cloudflare R2
R2_ACCOUNT_ID=fa92fb66bb8615279773847f8aecae0c
R2_ACCESS_KEY_ID=<paste-r2-access-key-id>
R2_SECRET_ACCESS_KEY=<paste-r2-secret-access-key>
R2_BUCKET_NAME=eventcast-media
R2_PUBLIC_URL=https://pub-fa013cc979d8410e9d307bd2c9e6ecf2.r2.dev
R2_KEY_PREFIX=vods

# Restreamer
RESTREAMER_DATA_DIR=/opt/restreamer/data

# Internals
FFMPEG_BIN=ffmpeg
TEMP_DIR=/tmp/vod-archiver
LOCK_FILE=/tmp/vod-archiver.lock
STALE_THRESHOLD_MS=14400000
```

Secure the file so only root can read the secrets:

```bash
sudo chmod 600 /opt/vod-archiver/.env
sudo chown root:root /opt/vod-archiver/.env
```

---

## Step 6 — Test a dry run

Before installing the timer, verify the script works end-to-end manually:

```bash
# Run as the ubuntu user (same as the service will)
cd /opt/vod-archiver
node vod-archiver.js
```

Expected output when no events are pending:
```
{"ts":"...","level":"INFO","message":"VOD Archiver starting","pid":12345,"node":"v20.x.x"}
{"ts":"...","level":"INFO","message":"No pending events — nothing to do"}
{"ts":"...","level":"INFO","message":"VOD Archiver run complete"}
```

If you have a completed event in Supabase with no `video_url`, the full pipeline
will run: locate → stitch → upload → update → cleanup.

---

## Step 7 — Install the systemd service and timer

```bash
sudo cp /tmp/vod-archiver-src/vod-archiver.service /etc/systemd/system/
sudo cp /tmp/vod-archiver-src/vod-archiver.timer   /etc/systemd/system/

# Reload systemd and enable the timer (not the service directly)
sudo systemctl daemon-reload
sudo systemctl enable --now vod-archiver.timer

# Verify the timer is active
sudo systemctl status vod-archiver.timer
```

Expected output:
```
● vod-archiver.timer - Run VOD Archiver every 5 minutes
   Active: active (waiting)
   Trigger: Sun 2026-05-17 18:00:00 IST; 2min left
```

---

## Step 8 — Trigger a manual run

```bash
sudo systemctl start vod-archiver.service
```

Watch the live logs:

```bash
sudo journalctl -u vod-archiver -f
```

---

## Monitoring & Debugging

### View recent logs
```bash
# Last 100 log lines
sudo journalctl -u vod-archiver -n 100

# All logs from today
sudo journalctl -u vod-archiver --since today

# Follow live output during a run
sudo journalctl -u vod-archiver -f
```

### Check timer schedule
```bash
# See when the timer last fired and when it fires next
sudo systemctl list-timers vod-archiver.timer
```

### Check disk usage on the Restreamer data dir
```bash
du -sh /opt/restreamer/data
```

### Manually reset a stuck 'processing' event
If an event gets stuck with `video_url = 'processing'` and is younger than the
`STALE_THRESHOLD_MS` (4 hours), reset it manually in the Supabase SQL editor:

```sql
UPDATE events
SET video_url = NULL
WHERE video_url = 'processing' AND id = '<your-event-id>';
```

---

## Alternative: crontab (simpler, no systemd)

If you prefer plain cron instead of a systemd timer:

```bash
crontab -e
```

Add this line (runs every 5 minutes, logs to a file):

```
*/5 * * * * /usr/bin/node /opt/vod-archiver/vod-archiver.js >> /var/log/vod-archiver.log 2>&1
```

The `.env` file must be loaded manually when using cron. Wrap the command:

```
*/5 * * * * set -a; source /opt/vod-archiver/.env; set +a; /usr/bin/node /opt/vod-archiver/vod-archiver.js >> /var/log/vod-archiver.log 2>&1
```

---

## Architecture Notes

- **FFmpeg flags explained:**
  - `-allowed_extensions ALL` — lets FFmpeg open HLS playlists that reference local files
  - `-protocol_whitelist file,crypto,data,...` — required for HLS with AES encryption (common in Restreamer)
  - `-c copy` — stream copy, zero re-encoding: a 1-hour stream stitches in ~10 seconds
  - `-movflags +faststart` — moves moov atom to front of MP4 so playback starts instantly
  - `-bsf:a aac_adtstoasc` — converts ADTS-wrapped AAC (used in MPEG-TS) to LATM (required in MP4)

- **R2 vs S3 pricing:** Cloudflare R2 has zero egress fees, which is why it's chosen over GCS/S3 for VOD serving.

- **Multipart upload:** `@aws-sdk/lib-storage` automatically splits uploads into 100 MB chunks with 4 concurrent streams, making it efficient for large MP4 files.

- **Idempotency:** The `video_url = 'processing'` sentinel (guarded by `.is('video_url', null)` on the UPDATE) ensures that even if the cron job fires while a previous run is still in progress, each event is processed exactly once.
