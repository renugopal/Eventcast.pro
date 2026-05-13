
export interface RestreamerConfig {
  url: string;
  username: string;
  password?: string;
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

  private async getAuthToken(): Promise<string> {
    const res = await fetch(`${this.config.url}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.config.username,
        password: this.config.password || ''
      })
    });

    if (!res.ok) {
      throw new Error(`Restreamer Login Failed: ${res.statusText}`);
    }

    const data = await res.json();
    if (!data.access_token) {
      throw new Error("Restreamer Login Failed: No access token received");
    }

    return `Bearer ${data.access_token}`;
  }

  /**
   * Create or Update a streaming channel (process)
   * This sets up the ingest and the HLS output
   */
  async setupChannel(slug: string, youtubeKey?: string) {
    console.log(`Setting up Restreamer channel for ${slug}...`);
    const authHeader = await this.getAuthToken();

    // 1. Create/Update the main process (Ingest -> HLS)
    const processPayload = {
      id: slug,
      type: "ffmpeg",
      autostart: true,
      reconnect: true,
      config: [
        {
          "id": "input",
          "type": "input",
          "address": `rtmp://0.0.0.0/live/${slug}`,
          "options": ["-fflags", "+genpts"]
        },
        {
          "id": "output_hls",
          "type": "output",
          "address": `memfs://${slug}.m3u8`,
          "options": [
            "-c:v", "copy", 
            "-c:a", "aac", "-b:a", "128k", "-ar", "44100", 
            "-f", "hls", 
            "-hls_time", "2", 
            "-hls_list_size", "10", 
            "-hls_flags", "delete_segments+independent_segments"
          ]
        }
      ]
    };

    const res = await fetch(`${this.config.url}/api/v1/process`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(processPayload)
    });

    if (!res.ok && res.status !== 409) { // 409 means it already exists
      const err = await res.json();
      throw new Error(`Restreamer Process Error: ${JSON.stringify(err)}`);
    }

    // 2. If YouTube key is provided, add the YouTube Publication
    if (youtubeKey) {
      console.log(`Adding YouTube publication for ${slug}...`);
      const pubPayload = {
        id: "youtube",
        type: "ffmpeg",
        autostart: true,
        reconnect: true,
        config: [
          {
            "id": "input",
            "type": "input",
            "address": `memfs://${slug}.m3u8`
          },
          {
            "id": "output_rtmp",
            "type": "output",
            "address": `rtmp://a.rtmp.youtube.com/live2/${youtubeKey}`,
            "options": ["-c:v", "copy", "-c:a", "copy", "-f", "flv"]
          }
        ]
      };

      const pubRes = await fetch(`${this.config.url}/api/v1/process/${slug}/publication`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(pubPayload)
      });

      if (!pubRes.ok && pubRes.status !== 409) {
        const err = await pubRes.json();
        console.error("Restreamer Publication Error:", err);
      }
    }

    return {
      ingestUrl: `rtmp://34.100.142.25/live`,
      streamKey: slug,
      hlsUrl: `${this.config.url}/memfs/${slug}.m3u8`,
      playerUrl: `${this.config.url}/ui/player.html?query=memfs/${slug}.m3u8`
    };
  }

  /**
   * Delete a channel (process) from Restreamer
   */
  async deleteChannel(slug: string) {
    console.log(`Deleting Restreamer channel for ${slug}...`);
    try {
      const authHeader = await this.getAuthToken();
      const res = await fetch(`${this.config.url}/api/v1/process/${slug}`, {
        method: 'DELETE',
        headers: {
          'Authorization': authHeader
        }
      });
      return res.ok;
    } catch (err) {
      console.error("Restreamer deletion failed:", err);
      return false;
    }
  }
}
