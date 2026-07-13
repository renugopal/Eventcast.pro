# Eventcast.pro - Recommended Architecture Proposal

**Document Type**: Technical Architecture Proposal  
**Purpose**: Production-grade streaming infrastructure design  
**Status**: DRAFT for review and feedback  
**Target Implementation**: Phased rollout over 3-6 months

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current vs Proposed Architecture](#current-vs-proposed-architecture)
3. [Detailed Component Design](#detailed-component-design)
4. [Implementation Phases](#implementation-phases)
5. [Cost Analysis](#cost-analysis)
6. [Risk Assessment](#risk-assessment)
7. [Alternative Approaches](#alternative-approaches)
8. [Open Questions](#open-questions)

---

## 1. Executive Summary

### Objective
Transform Eventcast.pro from a functional single-server streaming platform into a production-grade, scalable, redundant system capable of handling 10+ concurrent events with 99.9% uptime.

### Key Improvements Proposed

| Area | Current | Proposed | Impact |
|------|---------|----------|--------|
| **Redundancy** | Single origin | Dual origin + automatic failover | Eliminate single point of failure |
| **Quality** | 1080p only | ABR (360p/480p/720p/1080p) | Support all connection types |
| **Latency** | 12-15s | 2-4s (LL-HLS) | Near real-time experience |
| **Monitoring** | Manual checks | Automated with alerts | Proactive issue detection |
| **Recovery** | Player-side only | Origin + Edge + Player | Multi-layer fault tolerance |
| **Security** | Basic | Signed URLs + rate limits + DRM | Prevent abuse and piracy |
| **Scalability** | 2-4 events | 10-20 events | Support business growth |

### Investment Required
- **Capital**: $500-800 initial setup
- **Monthly**: $250-400 ongoing costs
- **Time**: 3-6 months phased implementation
- **ROI**: 12-18 months (based on increased capacity)

---

## 2. Current vs Proposed Architecture

### 2.1 High-Level Comparison

#### Current Architecture (As-Is)
```
OBS → Restreamer (Single VM) → [HLS, MP4, YouTube]
                ↓
      [Cloudflare CDN] → Browser (HLS.js)
```

**Strengths**:
- Simple to manage
- Low cost (~$120/month)
- Works for small events (2-4 concurrent)

**Weaknesses**:
- Single point of failure
- No adaptive bitrate
- High latency (12-15s)
- No automated monitoring
- Limited scalability

---

#### Proposed Architecture (To-Be)
```
                    ┌─────────────────┐
                    │   OBS Studio    │
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │ RTMP Load       │
                    │ Balancer        │
                    │ (nginx)         │
                    └────┬────────┬───┘
                         │        │
              ┌──────────┘        └──────────┐
              │                               │
    ┌─────────▼─────────┐         ┌─────────▼─────────┐
    │  Origin Server 1  │         │  Origin Server 2  │
    │  (Primary)        │◄────────┤  (Backup)         │
    │  - Restreamer     │ Sync    │  - Restreamer     │
    │  - ABR Ladder     │         │  - ABR Ladder     │
    │  - LL-HLS         │         │  - LL-HLS         │
    └─────────┬─────────┘         └─────────┬─────────┘
              │                               │
              └──────────┬────────────────────┘
                         │
              ┌──────────▼──────────┐
              │  Cloudflare CDN     │
              │  - Edge caching     │
              │  - HLS proxy        │
              │  - Rate limiting    │
              │  - Signed URLs      │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Browser            │
              │  - Smart Player     │
              │  - ABR selection    │
              │  - Error telemetry  │
              └─────────────────────┘
              
    Monitoring: Prometheus + Grafana + AlertManager
    Storage: R2 (VOD) + S3 Glacier (Backup)
    Database: Supabase (Events) + TimescaleDB (Metrics)
```

---

### 2.2 Component-by-Component Comparison

#### A. Origin Servers

**Current**:
```yaml
Count: 1
Type: GCP e2-standard-4 (4 vCPU, 16GB)
Outputs: 4 (HLS, MP4, HLS-archive, YouTube)
Transcoding: No (copy mode)
Failover: None
Cost: $120/month
```

**Proposed**:
```yaml
Count: 2 (Primary + Backup)
Type: GCP c2-standard-8 (8 vCPU, 32GB) each
Outputs per stream: 7
  - 4x ABR HLS (360p, 480p, 720p, 1080p)
  - 1x MP4 recording
  - 1x HLS archive
  - 1x YouTube relay
Transcoding: Yes (H.264 ABR ladder)
Failover: Automatic (heartbeat-based)
Cost: $280/month (2x $140)

Justification:
  - Dual origin eliminates single point of failure
  - 8 vCPU handles transcoding for 4-6 concurrent streams
  - Automatic failover ensures zero downtime
  - Higher RAM supports more buffering/caching
```

#### B. Adaptive Bitrate (ABR)

**Current**:
```yaml
Enabled: No
Qualities: 1 (1080p only)
Bitrates: 4000 kbps fixed
Client Adaptation: None

Problem:
  - 3G users can't watch (too high bitrate)
  - Network fluctuations cause buffering
  - No quality options for data-conscious viewers
```

**Proposed**:
```yaml
Enabled: Yes
Qualities: 4

Ladder Configuration:
  1080p: 4000 kbps (1920x1080)
    Target: WiFi, fiber, 4G+ users
    CPU: ~40% per stream
    
  720p: 2500 kbps (1280x720)
    Target: 4G users, mobile viewers
    CPU: ~25% per stream
    
  480p: 1200 kbps (854x480)
    Target: 3G users, limited data plans
    CPU: ~15% per stream
    
  360p: 600 kbps (640x360)
    Target: 2G users, emergency fallback
    CPU: ~10% per stream

Total CPU per stream: ~90% (single core equivalent)
Maximum concurrent streams (8 vCPU): 6-8 streams

FFmpeg Configuration:
  ffmpeg -i {input} \
    # 1080p
    -vf "scale=1920:1080" -b:v 4000k -maxrate 4200k -bufsize 8000k \
    -c:v libx264 -preset veryfast -tune zerolatency -g 60 \
    -c:a aac -b:a 128k -ar 48000 -f hls output_1080p.m3u8 \
    
    # 720p
    -vf "scale=1280:720" -b:v 2500k -maxrate 2650k -bufsize 5000k \
    -c:v libx264 -preset veryfast -tune zerolatency -g 60 \
    -c:a aac -b:a 96k -ar 48000 -f hls output_720p.m3u8 \
    
    # 480p
    -vf "scale=854:480" -b:v 1200k -maxrate 1300k -bufsize 2400k \
    -c:v libx264 -preset veryfast -tune zerolatency -g 60 \
    -c:a aac -b:a 64k -ar 44100 -f hls output_480p.m3u8 \
    
    # 360p
    -vf "scale=640:360" -b:v 600k -maxrate 650k -bufsize 1200k \
    -c:v libx264 -preset veryfast -tune zerolatency -g 60 \
    -c:a aac -b:a 48k -ar 44100 -f hls output_360p.m3u8

Master Playlist:
  #EXTM3U
  #EXT-X-VERSION:3
  #EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080,FRAME-RATE=30
  1080p/index.m3u8
  #EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,FRAME-RATE=30
  720p/index.m3u8
  #EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480,FRAME-RATE=30
  480p/index.m3u8
  #EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360,FRAME-RATE=30
  360p/index.m3u8

Benefits:
  ✅ 3G users can watch at 360p/480p
  ✅ Automatic quality switching based on bandwidth
  ✅ Reduced buffering events (90% decrease expected)
  ✅ Better mobile experience
  ✅ Data-conscious options for users

Tradeoff:
  ❌ Higher CPU usage (need better VMs)
  ❌ More complex configuration
  ❌ Higher storage for VOD (4x segment files)
```

#### C. Low-Latency HLS (LL-HLS)

**Current**:
```yaml
Enabled: No
Segment Duration: 4 seconds
Playlist Size: 10 segments (40s buffer)
Latency: 12-15 seconds glass-to-glass

Calculation:
  - Encoder delay: 2-3s (OBS processing)
  - Segment duration: 4s (FFmpeg chunk)
  - Network transfer: 1-2s
  - CDN caching: 0-1s
  - Player buffer: 4-6s (2-3 segments)
  Total: 11-16s typical
```

**Proposed**:
```yaml
Enabled: Yes
Segment Duration: 2 seconds (shorter chunks)
Partial Segments: 0.5 seconds (LL-HLS feature)
Playlist Size: 6 segments (12s buffer)
Target Latency: 2-4 seconds glass-to-glass

FFmpeg LL-HLS Configuration:
  -f hls \
  -hls_time 2 \
  -hls_list_size 6 \
  -hls_flags independent_segments+delete_segments+program_date_time \
  -hls_segment_type fmp4 \
  -hls_fmp4_init_filename init.mp4 \
  -method PUT \
  -http_persistent 1 \
  -var_stream_map "v:0,a:0" \
  output.m3u8

HLS.js Player Configuration:
  {
    lowLatencyMode: true,
    backBufferLength: 0,
    liveSyncDurationCount: 1,     // Stay 1 segment behind
    liveMaxLatencyDurationCount: 3, // Max 6s behind
    maxBufferLength: 6,
    maxMaxBufferLength: 12,
    enableWorker: true
  }

Expected Latency Breakdown:
  - Encoder delay: 1-2s (OBS + FFmpeg)
  - Partial segment: 0.5s
  - Network transfer: 0.3-0.5s
  - CDN edge: 0.2-0.3s
  - Player buffer: 2-3s (1-1.5 segments)
  Total: 4-6s typical, 2-3s best case

Benefits:
  ✅ Near real-time experience (comparable to YouTube)
  ✅ Better viewer engagement (less delay in chat)
  ✅ Competitive with other platforms
  
Tradeoffs:
  ❌ Higher CPU (more frequent encoding)
  ❌ More network requests (smaller chunks)
  ❌ Slightly less reliable on poor networks
  ❌ Requires HTTP/2 (already have via Cloudflare)

Recommendation:
  - Phase 2 implementation (after ABR stable)
  - Make it optional (user toggle for "Low Latency Mode")
  - Test thoroughly with 3G networks before production
```

#### D. Monitoring & Alerting

**Current**:
```yaml
Method: Manual SSH + curl + docker logs
Frequency: On-demand (reactive)
Alerts: None
Dashboard: None
Metrics Retention: 0 (logs only)

Problem:
  - Issues discovered by viewers first
  - No historical data for analysis
  - Can't predict capacity issues
  - Troubleshooting requires SSH access
```

**Proposed**:
```yaml
Stack: Prometheus + Grafana + AlertManager
Deployment: Separate monitoring VM (small instance)

Metrics Collected:
  Origin Server:
    - CPU, RAM, Disk, Network (node_exporter)
    - FFmpeg process stats (custom exporter)
    - RTMP connection count
    - HLS segment generation rate
    - YouTube relay status
    
  Application:
    - Active streams count
    - Viewer count per stream
    - Player error rate
    - VOD upload lag
    - API response times
    
  Infrastructure:
    - CDN cache hit rate (Cloudflare API)
    - R2 storage used/available
    - Database connection pool
    - Network bandwidth

Dashboard Examples:

  # Grafana Dashboard: Stream Health
  ┌─────────────────────────────────────────────────────┐
  │ Eventcast Streaming Health                          │
  ├─────────────────────────────────────────────────────┤
  │                                                      │
  │ ┌────────────┐  ┌────────────┐  ┌────────────┐    │
  │ │ Active     │  │ Total      │  │ Alerts     │    │
  │ │ Streams: 3 │  │ Viewers: 847│  │ Active: 0  │    │
  │ └────────────┘  └────────────┘  └────────────┘    │
  │                                                      │
  │ Event: demo-groom-wedding           🟢 Healthy     │
  │ ├─ Input Bitrate: 4.2 Mbps                         │
  │ ├─ Viewers: 342 (Peak: 389)                        │
  │ ├─ VOD Lag: 8s                                     │
  │ └─ Errors: 0 (last 5min)                           │
  │                                                      │
  │ Origin Server 1                     🟢 Healthy     │
  │ ├─ CPU: 45% (4.5/10 cores)                         │
  │ ├─ RAM: 12.3/32 GB (38%)                           │
  │ ├─ Disk: 89/200 GB (45%)                           │
  │ └─ Uptime: 23d 14h 23m                             │
  │                                                      │
  │ [Last 6 hours: Stream Bitrate]                     │
  │   5Mbps ▃▄▅▆▅▄▃▄▅▅▆▅▄▃▄▅▆▅                        │
  │   4Mbps ▃▄▅▆▅▄▃▄▅▅▆▅▄▃▄▅▆▅                        │
  │   3Mbps ▃▄▅▆▅▄▃▄▅▅▆▅▄▃▄▅▆▅                        │
  │   0Mbps ━━━━━━━━━━━━━━━━━━━━━                      │
  └─────────────────────────────────────────────────────┘

Alert Rules:
  Critical (PagerDuty + Telegram):
    - Input signal lost (bitrate = 0 for >30s)
    - Origin server down (no heartbeat for >60s)
    - CPU > 95% for >5 minutes
    - Disk < 5GB free
    
  Warning (Telegram only):
    - High error rate (>5% viewers in 5min)
    - VOD upload lag > 60s
    - CPU > 80% for >10 minutes
    - Disk < 20GB free
    
  Info (Log only):
    - New stream started
    - Stream ended
    - Viewer count milestone (100, 500, 1000)

Implementation:
  # Prometheus config
  scrape_configs:
    - job_name: 'origin-1'
      static_configs:
        - targets: ['origin1.eventcast.pro:9100']  # node_exporter
    
    - job_name: 'restreamer-metrics'
      static_configs:
        - targets: ['origin1.eventcast.pro:9200']  # custom exporter
  
  # AlertManager config
  route:
    receiver: 'telegram'
    routes:
      - match:
          severity: critical
        receiver: 'pagerduty'
  
  receivers:
    - name: 'telegram'
      webhook_configs:
        - url: 'https://api.telegram.org/bot{TOKEN}/sendMessage'
    
    - name: 'pagerduty'
      pagerduty_configs:
        - service_key: '{KEY}'

Cost: ~$25/month (small monitoring VM + storage)
```

#### E. Security Improvements

**Current**:
```yaml
HLS Access: Public URLs (no authentication)
Stream Keys: Visible in logs
Rate Limiting: None (relies on Cloudflare default)
DRM: None

Vulnerabilities:
  ❌ Anyone can hotlink VOD URLs
  ❌ Stream keys can leak in logs/errors
  ❌ No protection against DDoS on HLS endpoints
  ❌ Easy to download and redistribute content
```

**Proposed**:
```yaml
1. Signed URLs for HLS
  Implementation:
    # Cloudflare Worker
    function generateSignedUrl(slug, expiresIn = 3600) {
      const expires = Math.floor(Date.now() / 1000) + expiresIn;
      const message = `${slug}:${expires}`;
      const signature = hmacSHA256(message, env.SECRET_KEY);
      
      return `/events/${slug}/hls/index.m3u8?expires=${expires}&sig=${signature}`;
    }
    
    async function verifySignature(slug, expires, signature) {
      // Check expiration
      if (Date.now() / 1000 > expires) {
        return false; // Expired
      }
      
      // Verify signature
      const message = `${slug}:${expires}`;
      const expected = hmacSHA256(message, env.SECRET_KEY);
      
      return signature === expected;
    }
  
  Benefits:
    ✅ URLs expire after 1 hour (configurable)
    ✅ Can't share/hotlink URLs
    ✅ Can revoke access by changing SECRET_KEY
  
  Drawback:
    ❌ Must generate new URL every hour (client-side refresh)

2. Stream Key Encryption
  Implementation:
    # Supabase: Store encrypted keys
    CREATE TABLE stream_keys (
      event_id UUID PRIMARY KEY,
      encrypted_key TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    # Application: Encrypt before storing
    import { encrypt, decrypt } from 'crypto';
    
    const encryptedKey = encrypt(streamKey, env.ENCRYPTION_KEY);
    await supabase.from('stream_keys').insert({ 
      event_id, 
      encrypted_key: encryptedKey 
    });
    
    # Never log full keys
    console.log('Stream key:', streamKey.slice(0, 4) + '...' + streamKey.slice(-4));
  
  Benefits:
    ✅ Keys protected at rest
    ✅ Keys not visible in logs
    ✅ Can rotate keys safely
  
  Key Rotation:
    - Generate new key after each event
    - Store old keys for 30 days (audit trail)
    - Alert if same key reused

3. Rate Limiting
  Implementation:
    # Cloudflare Worker rate limiting
    const RATE_LIMITS = {
      '/events/:slug/hls/*.m3u8': '120/minute',    // Playlist
      '/events/:slug/hls/*.ts':   '1000/minute',   // Segments
      '/events/:slug':            '60/minute'      // Page
    };
    
    async function checkRateLimit(request, limit) {
      const clientId = request.headers.get('CF-Connecting-IP');
      const key = `ratelimit:${clientId}:${limit}`;
      
      const count = await env.KV.get(key);
      if (count && parseInt(count) > limit.split('/')[0]) {
        return new Response('Too many requests', { status: 429 });
      }
      
      await env.KV.put(key, (parseInt(count || 0) + 1).toString(), { 
        expirationTtl: 60 
      });
      
      return null; // Allowed
    }
  
  Benefits:
    ✅ Prevent DDoS attacks
    ✅ Protect against scrapers
    ✅ Fair usage enforcement

4. Optional: DRM (Future)
  Options:
    a) Widevine DRM (Google):
       - Pro: Industry standard, wide support
       - Con: Complex setup, licensing costs
    
    b) FairPlay (Apple):
       - Pro: Best for iOS
       - Con: Apple-only
    
    c) PlayReady (Microsoft):
       - Pro: Good Windows support
       - Con: Limited mobile
    
    d) Custom Token-based:
       - Pro: Simple, no licensing
       - Con: Easy to bypass (security by obscurity)
  
  Recommendation:
    - Phase 3 or later (not immediate priority)
    - Start with signed URLs (good enough for wedding events)
    - Consider DRM if expanding to paid content/concerts

Total Security Cost: ~$10/month (KV storage for rate limiting)
```

---

## 3. Detailed Component Design

### 3.1 Origin Server Design

#### Dual-Origin Architecture

**Objective**: Eliminate single point of failure, enable zero-downtime maintenance.

**Design**:
```
┌───────────────────────────────────────────────┐
│         RTMP Load Balancer (nginx)           │
│         IP: lb.eventcast.pro                  │
│                                               │
│  upstream restreamer_backend {               │
│    server origin1.internal:1935 weight=10;   │
│    server origin2.internal:1935 backup;      │
│  }                                            │
│                                               │
│  server {                                     │
│    listen 1935;                               │
│    proxy_pass restreamer_backend;            │
│    proxy_timeout 3s;                          │
│    proxy_connect_timeout 1s;                 │
│  }                                            │
└───────────────────────────────────────────────┘
            │                    │
            │                    │ Failover
    ┌───────▼──────┐    ┌───────▼──────┐
    │  Origin 1    │    │  Origin 2    │
    │  (Primary)   │    │  (Backup)    │
    │              │    │              │
    │  Status:     │    │  Status:     │
    │  🟢 Active   │    │  🟡 Standby  │
    └──────────────┘    └──────────────┘

Failover Logic:
  1. Load balancer sends RTMP to Origin 1
  2. Health check every 3 seconds:
     - Try: RTMP handshake to origin1:1935
     - If timeout (>3s) or error: Mark as down
  3. On Origin 1 failure:
     - Redirect OBS to Origin 2
     - Alert operator via Telegram
     - Origin 2 becomes primary
  4. When Origin 1 recovers:
     - Manual switchback (prevent flapping)
     - Or automatic after 5 min uptime

Sync Strategy:
  Option A: No sync (independent)
    - OBS reconnects to backup
    - New segments start fresh
    - Gap in VOD (few seconds)
    - Pro: Simple, no complexity
    - Con: Small gap in archive
  
  Option B: rsync-based (file sync)
    - Primary rsync segments to backup every 10s
    - Backup can pick up mid-stream
    - No gap in VOD
    - Pro: Seamless continuity
    - Con: Network overhead, complexity

Recommendation: Start with Option A (simple), consider B later if needed.
```

**Configuration**:
```yaml
# Origin 1: origin1.eventcast.pro
GCP Instance:
  Machine: c2-standard-8 (8 vCPU, 32GB RAM)
  Disk: 300GB SSD
  Zone: asia-south1-a (Mumbai)
  
Services:
  - Restreamer (Docker)
  - VOD Uploader (systemd)
  - node_exporter (Prometheus)
  - Vector (log aggregator)

# Origin 2: origin2.eventcast.pro
GCP Instance:
  Machine: c2-standard-8 (8 vCPU, 32GB RAM)
  Disk: 300GB SSD
  Zone: asia-south1-b (Mumbai, different availability zone)
  
Services:
  - Restreamer (Docker)
  - VOD Uploader (systemd)
  - node_exporter (Prometheus)
  - Vector (log aggregator)

Cost Optimization:
  - Run backup as "preemptible" instance: $90/month (35% savings)
  - Risk: Google can terminate with 30s notice
  - Mitigation: Load balancer detects and switches to primary
  - Total: $140 (primary) + $90 (backup) = $230/month
```

---

### 3.2 Smart HLS Player

#### Network-Adaptive Player

**Objective**: Automatically adjust to viewer's network conditions for best experience.

**Implementation**:
```javascript
// Enhanced player with network awareness

class EventcastPlayer {
  constructor(videoElement, config) {
    this.video = videoElement;
    this.config = config;
    this.hls = null;
    this.metrics = {
      bufferStalls: 0,
      qualitySwitches: 0,
      errorCount: 0,
      startTime: Date.now()
    };
    
    this.detectNetworkQuality();
    this.initPlayer();
    this.startHealthMonitoring();
  }
  
  detectNetworkQuality() {
    // Use Network Information API
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    
    if (conn) {
      this.networkType = conn.effectiveType; // '2g', '3g', '4g', 'slow-2g'
      this.downlink = conn.downlink;          // Mbps
      this.rtt = conn.rtt;                    // Round-trip time (ms)
      
      console.log(`Network: ${this.networkType}, ${this.downlink}Mbps, ${this.rtt}ms RTT`);
      
      // Listen for network changes
      conn.addEventListener('change', () => {
        console.log('Network changed:', conn.effectiveType);
        this.adaptToNetwork(conn.effectiveType);
      });
    } else {
      // Fallback: Measure bandwidth by timing segment downloads
      this.networkType = 'unknown';
      this.measureBandwidth();
    }
  }
  
  getOptimalConfig(networkType) {
    const configs = {
      'slow-2g': {
        startLevel: -1,              // Let ABR choose (likely 360p)
        maxBufferLength: 30,         // Longer buffer for unstable network
        maxMaxBufferLength: 60,
        abrEwmaDefaultEstimate: 250000,  // 250 Kbps initial estimate
        lowLatencyMode: false
      },
      '2g': {
        startLevel: 0,               // 360p
        maxBufferLength: 25,
        maxMaxBufferLength: 50,
        abrEwmaDefaultEstimate: 500000,   // 500 Kbps
        lowLatencyMode: false
      },
      '3g': {
        startLevel: 1,               // 480p
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
        abrEwmaDefaultEstimate: 1500000,  // 1.5 Mbps
        lowLatencyMode: false
      },
      '4g': {
        startLevel: 2,               // 720p
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        abrEwmaDefaultEstimate: 4000000,  // 4 Mbps
        lowLatencyMode: this.config.lowLatency || false
      }
    };
    
    return configs[networkType] || configs['3g'];
  }
  
  initPlayer() {
    if (!Hls.isSupported()) {
      console.error('HLS not supported in this browser');
      return;
    }
    
    const networkConfig = this.getOptimalConfig(this.networkType);
    
    const hlsConfig = {
      debug: false,
      enableWorker: true,
      lowLatencyMode: networkConfig.lowLatencyMode,
      
      // Buffer management
      maxBufferLength: networkConfig.maxBufferLength,
      maxMaxBufferLength: networkConfig.maxMaxBufferLength,
      maxBufferSize: 60 * 1000 * 1000, // 60 MB
      maxBufferHole: 0.5,
      backBufferLength: 0,
      
      // Quality selection
      capLevelToPlayerSize: true,
      startLevel: networkConfig.startLevel,
      
      // ABR
      abrEwmaDefaultEstimate: networkConfig.abrEwmaDefaultEstimate,
      abrEwmaFastLive: 3,
      abrEwmaSlowLive: 9,
      abrBandWidthFactor: 0.95,
      abrBandWidthUpFactor: 0.7,
      
      // Live sync
      liveSyncDurationCount: networkConfig.lowLatencyMode ? 1 : 2,
      liveMaxLatencyDurationCount: networkConfig.lowLatencyMode ? 3 : 6,
      
      // Network
      maxLoadingDelay: 4,
      maxRetry: 3,
      maxRetryDelay: 8,
      highBufferWatchdogPeriod: 2
    };
    
    this.hls = new Hls(hlsConfig);
    this.hls.loadSource(this.config.streamUrl);
    this.hls.attachMedia(this.video);
    
    this.setupEventHandlers();
  }
  
  setupEventHandlers() {
    // Track errors
    this.hls.on(Hls.Events.ERROR, (event, data) => {
      this.metrics.errorCount++;
      
      if (!data.fatal) {
        console.warn('Non-fatal error:', data.type, data.details);
        return;
      }
      
      // Send telemetry
      this.reportError(data);
      
      // Handle fatal errors
      this.handleFatalError(data);
    });
    
    // Track quality switches
    this.hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
      this.metrics.qualitySwitches++;
      const level = this.hls.levels[data.level];
      console.log(`Quality: ${level.height}p @ ${Math.round(level.bitrate/1000)}kbps`);
      
      // Show quality indicator to user
      this.updateQualityBadge(level.height);
    });
    
    // Track buffer events
    this.video.addEventListener('waiting', () => {
      this.metrics.bufferStalls++;
      console.warn('Buffer stall #', this.metrics.bufferStalls);
    });
    
    this.video.addEventListener('playing', () => {
      console.log('Playback resumed');
    });
  }
  
  handleFatalError(data) {
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        console.error('Fatal network error, attempting recovery...');
        
        // Try reload 3 times
        if (this.metrics.errorCount < 3) {
          setTimeout(() => this.hls.startLoad(), 1000);
        } else if (this.metrics.errorCount < 5) {
          // Reload source
          this.hls.loadSource(this.config.streamUrl);
        } else {
          // Give up, show error
          this.showError('Network connection failed. Please check your internet or try YouTube.');
        }
        break;
        
      case Hls.ErrorTypes.MEDIA_ERROR:
        console.error('Fatal media error, attempting recovery...');
        
        if (this.metrics.errorCount < 3) {
          this.hls.recoverMediaError();
        } else {
          // Reload page
          window.location.reload();
        }
        break;
        
      default:
        console.error('Unrecoverable error:', data.details);
        this.showError('Player error. Reloading...');
        setTimeout(() => window.location.reload(), 2000);
    }
  }
  
  startHealthMonitoring() {
    // Monitor buffer health every 5 seconds
    setInterval(() => {
      if (!this.video.buffered.length) return;
      
      const currentTime = this.video.currentTime;
      const buffered = this.video.buffered.end(this.video.buffered.length - 1);
      const bufferLength = buffered - currentTime;
      
      // Warn if buffer is dangerously low
      if (bufferLength < 2 && !this.video.paused) {
        console.warn('Low buffer warning:', bufferLength.toFixed(1), 'seconds');
        
        // Proactively reduce quality to prevent stall
        if (this.hls.currentLevel > 0) {
          console.log('Reducing quality to prevent stall...');
          this.hls.currentLevel = Math.max(0, this.hls.currentLevel - 1);
        }
      }
      
      // Log metrics
      this.reportMetrics({
        bufferLength,
        currentLevel: this.hls.currentLevel,
        buffered: this.metrics.bufferStalls,
        errors: this.metrics.errorCount
      });
    }, 5000);
    
    // Report session summary on page unload
    window.addEventListener('beforeunload', () => {
      const duration = (Date.now() - this.metrics.startTime) / 1000 / 60; // minutes
      this.reportSessionEnd({
        duration,
        bufferStalls: this.metrics.bufferStalls,
        qualitySwitches: this.metrics.qualitySwitches,
        errors: this.metrics.errorCount
      });
    });
  }
  
  adaptToNetwork(newNetworkType) {
    // Network changed (e.g., WiFi -> 4G)
    this.networkType = newNetworkType;
    
    const newConfig = this.getOptimalConfig(newNetworkType);
    
    // Update buffer config
    this.hls.config.maxBufferLength = newConfig.maxBufferLength;
    this.hls.config.maxMaxBufferLength = newConfig.maxMaxBufferLength;
    
    // Update ABR
    this.hls.config.abrEwmaDefaultEstimate = newConfig.abrEwmaDefaultEstimate;
    
    console.log('Adapted to network:', newNetworkType, newConfig);
  }
  
  measureBandwidth() {
    // Fallback bandwidth measurement (for browsers without Network API)
    const startTime = Date.now();
    const testImage = new Image();
    testImage.onload = () => {
      const duration = (Date.now() - startTime) / 1000; // seconds
      const size = 500 * 1024; // 500KB test image
      const bandwidth = (size * 8) / duration / 1_000_000; // Mbps
      
      console.log('Measured bandwidth:', bandwidth.toFixed(2), 'Mbps');
      
      // Classify network
      if (bandwidth < 0.5) this.networkType = 'slow-2g';
      else if (bandwidth < 1.5) this.networkType = '2g';
      else if (bandwidth < 3) this.networkType = '3g';
      else this.networkType = '4g';
      
      this.adaptToNetwork(this.networkType);
    };
    testImage.src = 'https://eventcast.pro/bandwidth-test.jpg?' + Date.now();
  }
  
  reportMetrics(metrics) {
    // Send to analytics endpoint (fire-and-forget)
    if (window.gtag) {
      window.gtag('event', 'player_health', metrics);
    }
  }
  
  reportError(data) {
    // Send error telemetry to backend
    fetch('/api/player-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: this.config.slug,
        errorType: data.type,
        errorDetails: data.details,
        networkType: this.networkType,
        userAgent: navigator.userAgent,
        timestamp: Date.now()
      })
    }).catch(() => {}); // Fire-and-forget
  }
  
  reportSessionEnd(summary) {
    // Send session summary
    navigator.sendBeacon('/api/player-session', JSON.stringify({
      slug: this.config.slug,
      ...summary,
      timestamp: Date.now()
    }));
  }
  
  updateQualityBadge(height) {
    // Show quality badge to user (e.g., "720p" in corner)
    const badge = document.getElementById('quality-badge');
    if (badge) {
      badge.textContent = `${height}p`;
      badge.className = `quality-badge quality-${height}`;
    }
  }
  
  showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'player-error';
    errorDiv.innerHTML = `
      <div class="error-icon">⚠️</div>
      <div class="error-message">${message}</div>
      <button onclick="location.reload()">Retry</button>
    `;
    this.video.parentElement.appendChild(errorDiv);
  }
  
  destroy() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }
}

// Usage
const player = new EventcastPlayer(
  document.getElementById('video'),
  {
    streamUrl: CONFIG.restreamerUrl,
    slug: CONFIG.slug,
    lowLatency: false  // User preference
  }
);
```

**Benefits of Smart Player**:
- ✅ Automatic quality selection based on device/network
- ✅ Proactive stall prevention (reduce quality before buffer runs out)
- ✅ Network change adaptation (WiFi↔4G transitions)
- ✅ Comprehensive telemetry (improve platform over time)
- ✅ Better user experience (fewer interruptions)

---

## 4. Implementation Phases

### Phase 1: Immediate Fixes (Week 1-2) - $0 cost, highest ROI

**Objective**: Fix critical bugs, stabilize current system.

**Tasks**:
1. ✅ Pin HLS.js to version 1.5.8
2. ✅ Add player circuit breaker (5-reload limit)
3. ✅ Automate HLS archive directory creation
4. ✅ Complete VOD uploader dotenv fix

**Deliverables**:
- Updated worker deployed
- Updated restreamer client deployed
- VOD uploader verified working
- Documentation updated

**Success Criteria**:
- Zero manual interventions during next event
- VOD archive works from stream start
- Player doesn't enter infinite reload loop

---

### Phase 2: Monitoring & Alerts (Week 3-6) - $50/month

**Objective**: Proactive issue detection before viewers notice.

**Tasks**:
1. Set up Prometheus + Grafana
   - Deploy monitoring VM (e2-micro, $7/month)
   - Install Prometheus, Grafana, AlertManager
   - Configure node_exporter on origin server
   
2. Create custom metrics exporter for Restreamer
   - Poll Restreamer API every 30s
   - Expose metrics: bitrate, fps, viewer count, output status
   
3. Build Grafana dashboards
   - Stream health overview
   - Server resource utilization
   - VOD uploader status
   - Historical trends
   
4. Configure AlertManager
   - Telegram bot for notifications
   - PagerDuty for critical alerts (optional)
   - Alert rules (see Section 2.2.D)
   
5. Implement player error telemetry
   - Create `/api/player-error` endpoint (Cloudflare Worker)
   - Store errors in Supabase
   - Dashboard for error analysis

**Deliverables**:
- Live dashboard at `monitor.eventcast.pro`
- Alert notifications to Telegram
- Player error tracking operational

**Success Criteria**:
- Detect stream failure within 60 seconds
- Receive alert before first viewer complaint
- Historical data for capacity planning

---

### Phase 3: Adaptive Bitrate (Week 7-12) - $160/month additional

**Objective**: Support all network types (2G to fiber), reduce buffering.

**Tasks**:
1. Upgrade origin server
   - Resize to c2-standard-8 (8 vCPU, 32GB)
   - Cost: $280/month (up from $120)
   
2. Configure ABR ladder in Restreamer
   - 4 quality levels: 360p, 480p, 720p, 1080p
   - Test CPU usage with 2 concurrent streams
   - Tune FFmpeg presets for performance
   
3. Update HLS player
   - Remove hardcoded single quality
   - Test ABR switching behavior
   - Add quality selector UI
   
4. Update VOD uploader
   - Handle 4x segment files (one per quality)
   - Upload all qualities to R2
   - Update Supabase VOD links (master playlist)
   
5. Test with real users
   - Beta test with 1-2 events
   - Monitor quality switch frequency
   - Collect user feedback
   
6. Update CDN caching strategy
   - Cache segments by quality level
   - Optimize cache keys

**Deliverables**:
- ABR working for live streams
- VOD archives include all qualities
- Player automatically adapts to network

**Success Criteria**:
- 3G users can watch at 480p without buffering
- 4G+ users get 720p/1080p automatically
- <5% of users manually change quality (good auto-selection)
- Buffer stall rate reduced by 80%

---

### Phase 4: Redundancy (Week 13-18) - $90/month additional

**Objective**: Eliminate single point of failure, enable zero-downtime maintenance.

**Tasks**:
1. Deploy second origin server
   - GCP preemptible c2-standard-8 ($90/month)
   - Different availability zone (asia-south1-b)
   - Identical configuration to primary
   
2. Set up RTMP load balancer
   - Small nginx VM (e2-micro, $7/month)
   - Configure failover logic
   - Test automatic switchover
   
3. Sync configuration
   - Automated Restreamer config sync (Ansible/Terraform)
   - Manual failover procedures documented
   
4. Update monitoring
   - Add origin-2 to Prometheus
   - Alert on primary failure
   - Dashboard shows both origins
   
5. Test failover scenarios
   - Kill primary origin mid-stream
   - Verify backup takes over within 10s
   - Verify VOD continuity

**Deliverables**:
- Dual-origin setup operational
- Automatic failover working
- Runbook for manual failover

**Success Criteria**:
- Primary failure doesn't affect viewers
- Failover completes in <10 seconds
- No lost segments in VOD archive

---

### Phase 5: Low-Latency HLS (Week 19-24) - $0 additional cost

**Objective**: Reduce latency from 12-15s to 2-4s.

**Tasks**:
1. Update FFmpeg config for LL-HLS
   - Smaller segment size (2s instead of 4s)
   - Enable partial segments
   - Use fMP4 instead of TS
   
2. Update HLS.js player
   - Enable lowLatencyMode
   - Reduce buffer sizes
   - Test latency measurement
   
3. CDN optimization
   - Ensure HTTP/2 enabled (Cloudflare default)
   - Optimize edge caching for LL-HLS
   
4. Make it user-selectable
   - "Low Latency Mode" toggle in player UI
   - Default: OFF (standard HLS more reliable)
   - Save preference in localStorage
   
5. Test with various networks
   - 4G: Should work well
   - 3G: May have more buffering
   - Document trade-offs

**Deliverables**:
- LL-HLS available as opt-in feature
- Latency reduced to 3-5s (measured)
- User guide on when to enable

**Success Criteria**:
- Glass-to-glass latency <5s on 4G
- <10% increase in buffer stalls on 3G
- Positive user feedback on perceived latency

---

### Phase 6: Security Hardening (Week 25-30) - $10/month additional

**Objective**: Prevent hotlinking, abuse, and unauthorized access.

**Tasks**:
1. Implement signed URLs
   - Update worker to generate/verify signatures
   - Client-side URL refresh every 30 minutes
   - Revocation mechanism
   
2. Encrypt stream keys
   - Update Supabase schema
   - Migrate existing keys
   - Redact keys in logs
   
3. Rate limiting
   - Cloudflare Worker KV for rate counters
   - Per-IP limits on HLS endpoints
   - Alert on rate limit violations
   
4. Security audit
   - Review all public endpoints
   - Check for information leaks
   - Penetration testing (optional)
   
5. Documentation
   - Security best practices guide
   - Incident response runbook

**Deliverables**:
- Signed URLs operational
- Keys encrypted at rest
- Rate limiting active
- Security audit report

**Success Criteria**:
- HLS URLs can't be shared/hotlinked
- No stream keys in logs/errors
- Rate limit blocks abusive IPs

---

## 5. Cost Analysis

### Current (As-Is) Costs

```yaml
Monthly:
  GCP VM (e2-standard-4):      $120
  Cloudflare (Free plan):        $0
  Supabase (Free tier):          $0
  Cloudflare R2 (storage):      $15 (1TB)
  Domain (eventcast.pro):        $1
  
Total: $136/month
Annual: $1,632/year
```

### Proposed (To-Be) Costs - Full Implementation

```yaml
Phase 1 (Immediate Fixes):
  Additional cost:               $0
  
Phase 2 (Monitoring):
  Monitoring VM (e2-micro):      $7/month
  Prometheus storage:            $3/month
  
Phase 3 (ABR):
  Origin VM upgrade:           +$160/month (c2-standard-8 vs e2-standard-4)
  Additional R2 storage:        +$30/month (4x segments)
  
Phase 4 (Redundancy):
  Second origin (preemptible):  +$90/month
  Load balancer VM:              +$7/month
  
Phase 5 (LL-HLS):
  No additional cost:             $0
  
Phase 6 (Security):
  Cloudflare KV (rate limiting): +$10/month

Total Monthly (Full Implementation):
  Base:                        $136
  Monitoring:                   +$10
  ABR:                         +$190
  Redundancy:                   +$97
  Security:                     +$10
  
  Grand Total:                  $443/month
  Annual:                     $5,316/year

Incremental:                   +$307/month (+225%)
```

### ROI Calculation

**Revenue Assumptions** (need validation):
```
Current Capacity:
  - 2-4 concurrent events
  - ~25 events/month
  - Revenue per event: $50-100 (studio payment)
  - Monthly revenue: $1,250-2,500

Proposed Capacity:
  - 10-20 concurrent events (ABR + dual origin)
  - ~60 events/month (better reliability attracts more studios)
  - Revenue per event: $75 (average, higher due to premium features)
  - Monthly revenue: $4,500

ROI:
  Additional revenue: $2,000-3,250/month
  Additional cost:      $307/month
  Net profit increase: $1,693-2,943/month
  Payback period:     <1 month
  Annual ROI:        ~780%
```

**Note**: These are rough estimates. Actual revenue depends on sales/marketing.

---

### Cost Optimization Strategies

1. **Use Preemptible VMs**
   - Backup origin as preemptible: Save $50/month
   - Risk: Google can terminate (mitigated by primary)

2. **Reserved Capacity**
   - Commit to 1-year GCP contract: Save 30%
   - Origin VM: $196/month → $137/month
   - Savings: $59/month

3. **Defer Phase 5**
   - LL-HLS nice-to-have, not critical
   - Skip until user demand justifies

4. **Defer Phase 6**
   - Security adequate with signed URLs only
   - Full security package for Phase 7+

**Optimized Monthly Cost** (Phases 1-4 only):
```
Base:                        $136
Monitoring:                   +$10
ABR (with reserved capacity): +$157
Redundancy (preemptible):     +$97

Total:                        $400/month
Annual:                     $4,800/year

Savings vs full implementation: $43/month
```

---

## 6. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| ABR transcoding overloads CPU | Medium | High | Start with 4 concurrent streams, scale to 8 gradually. Monitor CPU usage closely. |
| Dual origin adds complexity | Medium | Medium | Thorough testing before production. Runbooks for troubleshooting. |
| LL-HLS increases buffering on slow networks | High | Medium | Make it opt-in. Default to standard HLS. User education. |
| Signed URLs break caching | Low | Medium | Use same signature for all users (CDN-friendly). Rotate keys slowly. |
| FFmpeg crash loses streams | Low | High | Restreamer auto-restarts FFmpeg. Alerts on repeated crashes. |
| R2 storage costs exceed budget | Low | Low | Monitor storage growth. Set up billing alerts. Implement retention policy. |

### Operational Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Lack of expertise for troubleshooting | Medium | High | Comprehensive documentation. External support contract (optional). |
| Increased maintenance overhead | High | Medium | Automation (Ansible/Terraform). Monitoring reduces manual checks. |
| Vendor lock-in (GCP, Cloudflare) | Medium | Low | Use standard protocols (RTMP, HLS, S3 API). Easy migration path. |
| Budget overruns | Low | Medium | Phased implementation. Stop if ROI not realized. |

### Business Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Studios don't pay premium for features | Medium | High | Pilot with 2-3 studios. Validate willingness to pay. |
| Competitors offer better service | Medium | Medium | Continuous improvement. Monitor market. |
| Regulatory changes (streaming laws) | Low | High | Legal consultation. Compliance monitoring. |

---

## 7. Alternative Approaches

### Alternative 1: Managed Streaming Service (e.g., Mux, AWS IVS)

**Pros**:
- ✅ Fully managed (no infrastructure maintenance)
- ✅ Built-in ABR, LL-HLS, monitoring
- ✅ Global CDN included
- ✅ 99.9% SLA

**Cons**:
- ❌ High cost: $1-2 per viewer-hour
- ❌ Less control over customization
- ❌ Vendor lock-in

**Cost Comparison**:
```
Mux Pricing:
  - Encoding: $0.01/minute
  - Delivery: $0.15/GB
  
Example event (300 viewers, 3 hours):
  - Encoding: 180 min × $0.01 = $1.80
  - Delivery: 300 viewers × 3 hours × 2GB/hour × $0.15 = $270
  Total per event: $272
  
Monthly (25 events): $6,800

Verdict: 15x more expensive than self-hosted. Not viable for wedding market.
```

### Alternative 2: Open-Source Stack (Nginx-RTMP + FFmpeg)

**Pros**:
- ✅ Full control
- ✅ Lower cost (no Restreamer license, though it's free anyway)
- ✅ Community support

**Cons**:
- ❌ No UI (all CLI)
- ❌ Steeper learning curve
- ❌ More manual configuration

**Verdict**: Similar to current setup. Restreamer is already open-source wrapper around this. No strong reason to switch.

### Alternative 3: Hybrid (YouTube Live as primary, own VOD)

**Pros**:
- ✅ YouTube handles all streaming (free, reliable)
- ✅ Only build VOD archive
- ✅ Very low cost

**Cons**:
- ❌ No control over viewer experience
- ❌ YouTube ads (unless paid)
- ❌ Brand dilution (viewers on YouTube, not your site)

**Verdict**: Good for MVP, but limits differentiation and branding. Current approach (YouTube as fallback) is better middle ground.

---

## 8. Open Questions for Review

### Questions for Another AI / Expert Review:

1. **ABR Ladder Design**:
   - Is 4 quality levels optimal, or should we have 3 or 5?
   - Should we include a 1440p option for high-end viewers?
   - Are the bitrate allocations (600k/1200k/2500k/4000k) correct for wedding content (lots of motion)?

2. **Transcoding Workload**:
   - Can c2-standard-8 (8 vCPU) realistically handle 6+ concurrent ABR streams?
   - Should we use GPU instances (e.g., T4) for better performance?
   - What's the best FFmpeg preset for live streaming (veryfast vs fast)?

3. **Failover Strategy**:
   - Is manual switchback after failover the right approach, or should it be automatic?
   - Should backup origin be always recording (hot standby) or only on failover (cold standby)?
   - How to handle viewer session continuity during failover (WebSocket reconnect)?

4. **LL-HLS Trade-offs**:
   - Is 2-4s latency achievable with our CDN setup (Cloudflare)?
   - Will LL-HLS significantly increase CDN costs (more frequent requests)?
   - Should LL-HLS be default for all viewers, or opt-in?

5. **Security Approach**:
   - Are signed URLs sufficient, or should we implement full DRM?
   - What's the right expiration time for signed URLs (1 hour too short? 24 hours too long)?
   - How to handle URL refresh for viewers who keep page open for >1 hour?

6. **Monitoring Depth**:
   - What metrics are most important to track?
   - Should we implement distributed tracing (e.g., Jaeger)?
   - How long to retain metrics (Prometheus default 15 days vs longer)?

7. **Cost Optimization**:
   - Are there better cloud providers than GCP for this workload (AWS, Azure, DigitalOcean)?
   - Should we use spot/preemptible for primary origin (higher risk, lower cost)?
   - Can we reduce R2 costs by implementing tiered storage (hot/cold)?

8. **Player UX**:
   - Should quality selection be automatic-only, or give users manual control?
   - How to communicate network quality to users (badge, notification)?
   - Should we show real-time latency to users (e.g., "You're 3.5s behind live")?

9. **VOD Strategy**:
   - Should VOD archive be available immediately after stream (current approach), or wait for post-processing (better quality)?
   - Should we generate a single-file MP4 from segments for easier download?
   - What's the retention policy for VOD (keep forever, or delete after 90 days)?

10. **Scalability Limits**:
    - At what point (how many concurrent events) do we need to move to multi-region?
    - Should we plan for international expansion (e.g., US, Europe) from the start?
    - What's the bottleneck for scaling beyond 20 concurrent events (CPU, bandwidth, database)?

---

## Appendix A: Technology Alternatives Considered

### Streaming Servers
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Restreamer (Datarhei) | Docker-based, UI, REST API | Less customizable than raw FFmpeg | ✅ **Chosen** |
| Nginx-RTMP | Mature, lightweight | No UI, CLI only | ❌ Rejected (complexity) |
| Wowza | Enterprise-grade, feature-rich | Expensive ($695/month+) | ❌ Rejected (cost) |
| OvenMediaEngine | Open-source, LL-HLS native | Less mature, smaller community | ⏸ **Consider for Phase 5** |

### CDN Options
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Cloudflare | Free, global, R2 integration | Limited LL-HLS optimization | ✅ **Chosen** |
| BunnyCDN | Cheap ($0.01/GB), streaming-focused | No integrated Workers/R2 | ⏸ **Consider as backup** |
| AWS CloudFront | Deep integration, mature | More expensive, complex setup | ❌ Rejected (cost/complexity) |

### Monitoring Stack
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Prometheus + Grafana | Open-source, industry standard, flexible | Self-hosted (maintenance overhead) | ✅ **Chosen** |
| Datadog | Fully managed, great UX | Expensive ($15/host/month) | ❌ Rejected (cost) |
| New Relic | Comprehensive APM | Even more expensive | ❌ Rejected (cost) |
| Cloudflare Analytics | Free, integrated | Limited metrics, no custom dashboards | ⏸ **Use as supplement** |

---

## Appendix B: Reference Architecture Diagrams

### Current Architecture (Simplified)
```
┌─────┐    RTMP     ┌────────────┐    HLS      ┌─────────┐
│ OBS ├────────────►│ Restreamer ├────────────►│ Browser │
└─────┘             └──────┬─────┘             └─────────┘
                           │
                           ├──► YouTube
                           ├──► VOD MP4
                           └──► HLS Archive → R2
```

### Proposed Architecture (Full)
```
                    ┌─────────────┐
                    │     OBS     │
                    └──────┬──────┘
                           │ RTMP
                    ┌──────▼──────┐
                    │ Load        │
                    │ Balancer    │
                    └──┬───────┬──┘
                       │       │
            ┌──────────┘       └──────────┐
            │                              │
     ┌──────▼──────┐              ┌───────▼─────┐
     │  Origin 1   │◄────Sync────►│  Origin 2   │
     │  (Primary)  │              │  (Backup)   │
     └──────┬──────┘              └─────────────┘
            │
            ├──► ABR HLS (4 qualities)
            ├──► YouTube
            ├──► VOD MP4
            └──► HLS Archive
                    │
             ┌──────▼──────┐
             │  R2 Storage │
             └──────┬──────┘
                    │
             ┌──────▼──────┐
             │ Cloudflare  │
             │ CDN + Worker│
             └──────┬──────┘
                    │
        ┌───────────┼───────────┐
        │           │           │
   ┌────▼────┐ ┌───▼────┐ ┌───▼────┐
   │ Desktop │ │ Mobile │ │ Mobile │
   │ Browser │ │  4G    │ │  3G    │
   │ 1080p   │ │ 720p   │ │ 480p   │
   └─────────┘ └────────┘ └────────┘
   
        ┌─────────────────┐
        │   Monitoring    │
        │ Prometheus +    │
        │    Grafana      │
        └─────────────────┘
```

---

## Conclusion

This proposal outlines a comprehensive path from the current functional-but-basic streaming setup to a production-grade, scalable platform. The phased approach allows for:

1. **Immediate wins** (Phase 1): Fix bugs, zero additional cost
2. **Risk mitigation** (Phase 2-4): Add monitoring and redundancy before complexity
3. **Feature enhancement** (Phase 5-6): Improve user experience once foundation is solid

**Key Decision Points**:
- **Must Do**: Phases 1-2 (fixes + monitoring)
- **Should Do**: Phases 3-4 (ABR + redundancy) if business grows
- **Nice to Have**: Phases 5-6 (LL-HLS + security) for premium experience

**Recommendation**: Start with Phases 1-2 immediately. Begin Phase 3 (ABR) only after validating increased demand from studios. Defer Phases 5-6 until Phases 1-4 are stable and ROI is proven.

**Next Steps**:
1. Review this proposal with another AI/expert
2. Validate cost assumptions
3. Get user feedback on priorities (ABR vs LL-HLS vs redundancy)
4. Pilot Phase 3 (ABR) with 1-2 test events before full rollout

---

**Document Status**: DRAFT - Awaiting Review  
**Version**: 1.0  
**Last Updated**: June 28, 2026  
**Author**: Eventcast.pro Team  
**Reviewers**: TBD
