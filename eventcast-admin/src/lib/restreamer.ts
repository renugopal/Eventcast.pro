
export interface RestreamerConfig {
  url: string;
  username: string;
  password?: string;
}

// ---------------------------------------------------------------------------
// Module-level token cache — shared across all RestreamerClient instances
// within the same Edge worker isolate.  Key: `${url}::${username}`.
// Restreamer (Datarhei Core) tokens last ~1 hour; we refresh at 55 min to
// avoid using a token that is about to expire mid-flight.
// ---------------------------------------------------------------------------
const TOKEN_TTL_MS = 55 * 60 * 1_000; // 55 minutes

interface CachedToken {
  value: string;   // "Bearer <jwt>"
  expiresAt: number; // Date.now() + TTL
}

const _tokenCache = new Map<string, CachedToken>();

/**
 * Health snapshot for a single Restreamer process.
 * Returned by getProcessHealth() — used by the stream health monitor cron.
 */
export interface StreamHealth {
  slug: string;
  /** Datarhei Core process state: 'running' | 'idle' | 'failed' | 'stopped' | 'finished' */
  state: string;
  /** Current input bitrate in kbps (0 when no encoder is connected) */
  bitrateKbps: number;
  /** How long the process has been alive, in seconds */
  runtimeSeconds: number;
  /** Input frames per second (0 when no signal) */
  fps: number;
}

/**
 * Utility to interact with Restreamer (Datarhei Core) API
 */
export class RestreamerClient {
  private config: RestreamerConfig;

  constructor(config: RestreamerConfig) {
    this.config = {
      ...config,
      url: config.url.replace(/\/$/, '')
    };
  }

  /** Cache key scoped to this server+user so multiple configs never collide. */
  private get _cacheKey(): string {
    return `${this.config.url}::${this.config.username}`;
  }

  /**
   * Returns a valid Bearer token, hitting /api/login only when the cache is
   * empty or within 5 minutes of expiry.  All callers within the same Edge
   * worker isolate share the cached value across requests and cron runs.
   *
   * Pass `force = true` to bypass the cache (e.g. after receiving a 401).
   */
  private async getAuthToken(force = false): Promise<string> {
    const key = this._cacheKey;
    const now = Date.now();
    const cached = _tokenCache.get(key);

    if (!force && cached && cached.expiresAt > now) {
      return cached.value;
    }

    // Cache miss, expired, or forced refresh — perform a real login
    const res = await fetch(`${this.config.url}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.config.username,
        password: this.config.password || ''
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Restreamer Login Failed: ${res.status} ${res.statusText} - ${errText}`);
    }

    const data = await res.json();
    if (!data.access_token) {
      throw new Error("Restreamer Login Failed: No access token received");
    }

    const token = `Bearer ${data.access_token}`;
    _tokenCache.set(key, { value: token, expiresAt: now + TOKEN_TTL_MS });
    return token;
  }

  /**
   * Evict the cached token for this server.  Call this when a downstream
   * request returns HTTP 401 so the next getAuthToken() fetches a fresh one.
   */
  private invalidateToken(): void {
    _tokenCache.delete(this._cacheKey);
  }

  /**
   * Create or Update a streaming channel (process)
   * This sets up the ingest and the HLS output
   */
  async setupChannel(slug: string, youtubeKey?: string) {
    console.log(`Setting up Restreamer channel for ${slug}...`);
    const authHeader = await this.getAuthToken();

    // 1. Build outputs array
    const outputs = [
      {
        "id": "hls",
        "address": "{data}/{processid}.m3u8",
        "options": [
          "-c:v", "copy", 
          "-c:a", "aac", "-b:a", "128k", "-ar", "44100", 
          "-f", "hls", 
          "-hls_time", "4", 
          "-hls_list_size", "0", 
          "-hls_playlist_type", "event",
          "-hls_flags", "independent_segments"
        ]
      }
    ];

    if (youtubeKey) {
      outputs.push({
        "id": "youtube",
        "address": `rtmp://a.rtmp.youtube.com/live2/${youtubeKey}`,
        "options": ["-c:v", "copy", "-c:a", "copy", "-f", "flv"]
      });
    }

    // 2. Create/Update the main process (Ingest -> Outputs)
    // We add metadata to make it visible in the Restreamer UI
    const processPayload = {
      id: slug,
      autostart: true,
      reconnect: true,
      metadata: {
        "restreamer-ui": {
          "channel": {
            "id": slug,
            "name": slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
          }
        }
      },
      input: [
        {
          "id": "0",
          "address": `{rtmp,name=${slug}}`,
          "options": ["-fflags", "+genpts"]
        }
      ],
      output: outputs
    };

    // Use POST to create the process
    let res = await fetch(`${this.config.url}/api/v3/process`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(processPayload)
    });

    // Check if it already exists (409 Conflict, or 400 with specific message in V3)
    let shouldUpdate = false;
    let errText = '';
    
    if (res.status === 409) {
      shouldUpdate = true;
    } else if (res.status === 400) {
      errText = await res.text();
      if (errText.includes("process already exists")) {
        shouldUpdate = true;
      }
    }

    if (shouldUpdate) {
      res = await fetch(`${this.config.url}/api/v3/process/${slug}`, {
        method: 'PUT',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(processPayload)
      });
    } else if (!res.ok && res.status !== 400) {
      // If it wasn't a 400 that we already parsed, parse it now
      errText = await res.text();
    }

    if (!res.ok) {
      throw new Error(`Restreamer Process Error: ${errText}`);
    }

    return {
      ingestUrl: `rtmp://34.100.142.25/${slug}`,
      streamKey: 'live',
      hlsUrl: `${this.config.url}/data/${slug}.m3u8`,
      playerUrl: `${this.config.url}/ui/player.html?query=data/${slug}.m3u8`
    };
  }

  /**
   * Restart a channel (process) completely
   */
  async restartChannel(slug: string) {
    console.log(`Restarting Restreamer channel for ${slug}...`);
    try {
      const authHeader = await this.getAuthToken();
      const res = await fetch(`${this.config.url}/api/v3/process/${slug}/command`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'restart' })
      });
      if (res.status === 401) { this.invalidateToken(); }
      return res.ok;
    } catch (err) {
      console.error("Restreamer restart failed:", err);
      return false;
    }
  }

  /**
   * Delete a channel (process) from Restreamer
   */
  async deleteChannel(slug: string) {
    console.log(`Deleting Restreamer channel for ${slug}...`);
    try {
      const authHeader = await this.getAuthToken();
      const res = await fetch(`${this.config.url}/api/v3/process/${slug}`, {
        method: 'DELETE',
        headers: { 'Authorization': authHeader }
      });
      if (res.status === 401) { this.invalidateToken(); }
      return res.ok;
    } catch (err) {
      console.error("Restreamer deletion failed:", err);
      return false;
    }
  }

  /**
   * Delete all VOD/HLS media files for a channel from the data filesystem.
   * The media server stores files as: {slug}.m3u8, {slug}0000.ts, {slug}0001.ts, ...
   * This must be called AFTER deleteChannel() to clean up persistent storage.
   */
  async deleteChannelFiles(slug: string): Promise<{ deleted: number; errors: number }> {
    console.log(`Deleting media files for channel: ${slug}...`);
    const authHeader = await this.getAuthToken();

    // 1. List all files in the data filesystem
    const listRes = await fetch(`${this.config.url}/api/v3/fs/data`, {
      headers: { 'Authorization': authHeader }
    });

    if (!listRes.ok) {
      throw new Error(`Failed to list data filesystem: ${listRes.status} ${listRes.statusText}`);
    }

    const files: Array<{ name: string }> = await listRes.json();

    // 2. Filter to files that belong to this event slug (m3u8 playlist + all .ts segments)
    const targetFiles = files.filter(f => f.name.startsWith(slug));

    if (targetFiles.length === 0) {
      console.log(`No media files found for slug: ${slug}`);
      return { deleted: 0, errors: 0 };
    }

    console.log(`Found ${targetFiles.length} media files to delete for slug: ${slug}`);

    // 3. Delete all matching files concurrently — allSettled so one failure doesn't block others
    const results = await Promise.allSettled(
      targetFiles.map(file =>
        fetch(`${this.config.url}/api/v3/fs/data/${encodeURIComponent(file.name)}`, {
          method: 'DELETE',
          headers: { 'Authorization': authHeader }
        })
      )
    );

    const deleted = results.filter(
      r => r.status === 'fulfilled' && (r.value as Response).ok
    ).length;
    const errors = results.length - deleted;

    console.log(`Media cleanup complete for ${slug}: ${deleted} deleted, ${errors} errors`);
    return { deleted, errors };
  }

  /**
   * Toggle a specific output (e.g., youtube) for a process
   */
  async toggleOutput(slug: string, outputId: string, enabled: boolean, outputConfig?: any) {
    try {
      const authHeader = await this.getAuthToken();
      
      // 1. Get current process config
      const getRes = await fetch(`${this.config.url}/api/v3/process/${slug}`, {
        headers: { 'Authorization': authHeader }
      });
      
      if (!getRes.ok) throw new Error("Could not find process");
      const process = await getRes.json();
      
      let outputs = [...(process.config.output || [])];
      
      if (enabled) {
        // Add if not already there
        if (!outputs.find((o: any) => o.id === outputId)) {
          if (!outputConfig) throw new Error("Output config required to enable");
          outputs.push(outputConfig);
        }
      } else {
        // Remove the output
        outputs = outputs.filter((o: any) => o.id !== outputId);
      }
      
      // 2. Update process with new output array
      const updatedConfig = { ...process.config, output: outputs };
      const putRes = await fetch(`${this.config.url}/api/v3/process/${slug}`, {
        method: 'PUT',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatedConfig)
      });
      
      return putRes.ok;
    } catch (err) {
      console.error(`Failed to toggle output ${outputId} for ${slug}:`, err);
      return false;
    }
  }

  /**
   * Fetch live health metrics for a single process (state, bitrate, fps, uptime).
   * Returns null if the process does not exist on the media server.
   * Uses the Datarhei Core /api/v3/process/{id}/state endpoint.
   */
  async getProcessHealth(slug: string): Promise<StreamHealth | null> {
    try {
      const authHeader = await this.getAuthToken();
      const res = await fetch(`${this.config.url}/api/v3/process/${slug}/state`, {
        headers: { 'Authorization': authHeader }
      });

      if (res.status === 401) { this.invalidateToken(); return null; }
      if (res.status === 404) return null; // Channel was never created for this event

      if (!res.ok) {
        throw new Error(`State fetch failed: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      const inputProgress = data.progress?.input?.[0];

      return {
        slug,
        state: data.state ?? 'unknown',
        bitrateKbps: inputProgress?.bitrate_kbit ?? 0,
        runtimeSeconds: data.runtime_seconds ?? inputProgress?.time ?? 0,
        fps: inputProgress?.fps ?? 0,
      };
    } catch (err) {
      console.error(`getProcessHealth failed for ${slug}:`, err);
      return null;
    }
  }

  /**
   * Get all active processes
   */
  async getAllProcesses() {
    try {
      const authHeader = await this.getAuthToken();
      const res = await fetch(`${this.config.url}/api/v3/process`, {
        headers: { 'Authorization': authHeader }
      });

      if (res.status === 401) { this.invalidateToken(); return []; }
      if (!res.ok) throw new Error("Failed to fetch processes");

      return await res.json();
    } catch (err) {
      console.error("Restreamer get all processes failed:", err);
      return [];
    }
  }
}
