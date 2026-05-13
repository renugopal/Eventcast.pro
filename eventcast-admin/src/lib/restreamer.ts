
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
      const errText = await res.text();
      throw new Error(`Restreamer Login Failed: ${res.status} ${res.statusText} - ${errText}`);
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

    // 1. Build outputs array
    const outputs = [
      {
        "id": "hls",
        "address": "{memfs}/{processid}.m3u8",
        "options": [
          "-c:v", "copy", 
          "-c:a", "aac", "-b:a", "128k", "-ar", "44100", 
          "-f", "hls", 
          "-hls_time", "2", 
          "-hls_list_size", "10", 
          "-hls_flags", "delete_segments+independent_segments"
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
    const processPayload = {
      id: slug,
      autostart: true,
      reconnect: true,
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
      const res = await fetch(`${this.config.url}/api/v3/process/${slug}`, {
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
