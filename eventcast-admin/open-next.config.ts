import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext Cloudflare adapter configuration for the Admin app.
 *
 * Deliberately minimal. No incremental-cache, queue, or tag-cache override is
 * configured, because doing so would require R2/KV/D1 bindings that this
 * application does not currently need — the Admin app talks to Supabase, R2,
 * and B2 over the network using environment variables only. Overrides should
 * be added if and when real caching behavior proves they are required, not
 * pre-emptively because the adapter supports them.
 */
export default defineCloudflareConfig();
