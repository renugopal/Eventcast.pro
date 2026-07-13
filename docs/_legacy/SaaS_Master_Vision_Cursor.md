Eventcast.pro — B2B SaaS Master Vision: Architecture & Execution Plan
Strategic architecture review. Grounded in the current Next.js 16 + Supabase + Datarhei + Cloudflare stack. Numbers calibrated to Andhra Pradesh / Telangana market scale.

3
Foundation shifts required
~30
Concurrent ingests on 1× i9
>95%
CDN cache-hit at scale
4–6 wks
Phase 1 to launch-ready
Three blockers between you and multi-tenant
1. Slug generation in /api/events/generate has no tenant scope. Two studios with overlapping event names will collide.

2. Static event HTML lives as commits in a single GitHub repo. This breaks at ~1,000 events (repo bloat, rate limits, no tenant isolation).

3. requireAdmin() only verifies "is logged in", not "is owner of studio_id". RLS today is anchored to a single admin user, not a tenant model.

1. Multi-tier billing architecture
A wallet-first model launches faster than subscriptions, and every studio can hold both a balance and an active subscription. Razorpay handles INR-native flow; Stripe gets bolted on later for international.

Tier	Audience	Pricing	Domain mapping	Branding	Gross margin
Free Trial	Trial / Discovery	First 3 events free, max 200 viewers each	eventcast.pro/{studio}/{event}	Eventcast watermark	Loss leader — recovers via conversion
Pay-Per-Event	Solo photographers, side hustlers	₹499–₹1,499 per event from prepaid wallet	eventcast.pro/{studio}/{event}	Studio logo, no Eventcast brand	~70% (avg event ≈ ₹150 infra cost)
Pro (Subscription)	Established studios, 4+ events/mo	₹4,999/mo flat + ₹299/event overage	live.studio.com (custom domain)	Full white-label, custom theme	~75% at >6 events/mo
Agency (Reseller)	Live-streaming agencies, 20+ events/mo	₹19,999/mo + volume discount per event	Multiple custom domains, sub-accounts	White-label + sub-studio branding	~80% with bulk infra reservation
Database schema additions
Table	Migration	Why
studios (NEW)	id uuid PK, owner_user_id, slug unique, display_name, custom_domain unique nullable, brand_logo_url, brand_color_hex, plan_tier enum, custom_hostname_id (Cloudflare), created_at	Root tenant entity. Every other row gets a studio_id FK pointing here.
events	ADD COLUMN studio_id uuid REFERENCES studios(id) NOT NULL, slug now unique per (studio_id, slug)	Two studios must be able to both have a "raj-priya-wedding" without collision.
photographers, wishes, page_views, asset_library	ADD COLUMN studio_id uuid REFERENCES studios(id) NOT NULL	Every read/write must be filterable by tenant. Required for RLS.
wallet_balances (NEW)	studio_id PK, balance_paise int, lifetime_topup_paise int, last_event_at	Prepaid credit ledger. One row per studio. Updated atomically with transactions.
transactions (NEW)	id, studio_id, kind enum(topup, debit, refund, subscription), amount_paise, razorpay_payment_id, razorpay_order_id, event_id nullable, status, idempotency_key unique, created_at	Full audit trail. Idempotency key prevents double-charging on webhook retries.
subscriptions (NEW)	studio_id, plan_tier, razorpay_subscription_id, status, current_period_start, current_period_end, cancel_at_period_end	Pro/Agency tier state. Synced from Razorpay subscription webhooks.
pricing_rules (NEW)	plan_tier, event_cost_paise, included_events_per_month, viewer_cap, vod_retention_days	Rules-as-data. Lets you change pricing without redeploying.
audit_log (NEW)	studio_id, actor_user_id, action, target_type, target_id, metadata jsonb, ip, ts	Required for SOC-2-style compliance and customer dispute resolution.
Wallet vs subscription decision
Build the wallet table first. Subscription state can be modeled as a recurring auto-topup against the same wallet — this means one ledger, one source of truth, and one place to debug billing disputes. Razorpay's Subscriptions API still emits payment events that you record as wallet top-ups.

2. Custom domain mapping via Cloudflare for SaaS
Cloudflare for SaaS Custom Hostnames is the right primitive. The flow is fully API-driven and SSL provisioning is automatic — you never touch certificates.

End-to-end provisioning flow
Step 1. Studio enters live.studio.com in admin panel. UI shows the required CNAME: cname.eventcast.pro.

Step 2. Admin panel calls POST /zones/{zoneId}/custom_hostnames with { hostname, ssl: { method: "txt", type: "dv" } }. Cloudflare returns a hostname id and a TXT challenge.

Step 3. Save cf_hostname_id on the studios row. Background poller hits GET /custom_hostnames/{id} every 30s until ssl.status = "active".

Step 4. Once active, studio's domain proxies through Cloudflare to a single Worker (the tenant router).

Step 5. Worker reads the Host header on every request, resolves to studio_id via Workers KV (cache populated from Postgres), and renders the event page from DB.

Why this beats DIY domain mapping
Universal SSL is free and auto-renewing. No certbot, no port-443 origin server per customer, no DNS-01 challenges to operate. The Worker stays warm in every PoP — tenant resolution is sub-50ms anywhere on Earth. Cost: ~$2/mo per custom hostname above the first 100 (essentially free at your scale).

3. Infrastructure scaling — when do you need more servers?
The bottleneck for this product is concurrent ingests, not viewers. Cloudflare absorbs viewer fan-out essentially for free once cache is hot. Your origin only ever serves ~one copy per cache PoP, regardless of audience size.

Scale tier	Topology	First bottleneck	Cost	When to switch
Today: 1–10 concurrent ingests	1× cloud VM (current 34.100.142.25) + Cloudflare proxy	GCP egress fees if HLS not cached	~₹12k–18k/mo	Already at this stage
10–30 concurrent ingests	1× i9/Threadripper bare-metal in Hyderabad + Cloudflare for SaaS	Disk write IOPS for VOD (10–30 GB per stream)	~₹8k/mo electricity + 1× ₹2L hardware capex	5+ concurrent live streams or 50k+ peak viewers
30–80 concurrent ingests	2-node cluster: stateless ingest pool + shared R2/NFS for VOD	Single-node CPU saturation on RTMP passthrough	+₹2L capex (second node) + load balancer	Sustained >30 simultaneous ingests; revenue >₹5L/mo
80–200 concurrent ingests	3-node geographic cluster: Hyderabad + Vizag + Bengaluru, anycast	Inter-region replication lag for VOD; DB write contention	+₹4L capex + dedicated bandwidth contracts	Revenue >₹15L/mo; clients in multiple metros
200+ concurrent ingests	Kubernetes-based ingest fleet, autoscaling, dedicated transcoding farm	Operational complexity, on-call rotation	Hire infra engineer (₹15L+/yr)	Revenue >₹50L/mo; needs dedicated DevOps headcount
The math behind the numbers
Metric	Calculation basis	Result
Origin egress per stream	3 Mbps ingest × 4 hr event = 5.4 GB raw	~5–8 GB persisted to VOD per event
Cloudflare cache-hit ratio at scale	HLS segments are immutable, cacheable for hours	>95% — origin serves each segment ~once per PoP, not once per viewer
Origin bandwidth at 50,000 concurrent viewers	With 95% cache hit: only 2,500 viewers reach origin, but Cloudflare PoPs serve all	~7.5–15 Mbps origin egress (well within 1 Gbps single-server)
Single i9 ingest capacity	RTMP passthrough (-c copy) at ~50 MB/s per stream	~25–35 simultaneous ingests before disk-write IOPS saturates
Multi-server tipping point	Above 30 sustained ingests, second node cuts CPU peaks in half	Add node #2 around ₹5L MRR (≈40 events/mo)
The single non-obvious tipping point
You will hit a wall at ~30 simultaneous ingests long before you need geo-redundancy. The cause is disk-write IOPS while persisting full-event VOD to local storage (current Datarhei config keeps every segment on the filesystem). The fix is to stream-write VOD directly to R2 instead of local disk — this also un-couples ingest nodes from local state, making the second-node migration trivial. Do this before buying a second server.

One physical server vs two-region cluster
One bare-metal i9 in Hyderabad with Cloudflare for SaaS in front handles up to ~30 concurrent ingests serving 50,000+ peak viewers per stream. Geographic redundancy (Hyderabad + Vizag) becomes a real requirement only when (a) you have paying customers in both metros who care about local SLA, or (b) revenue justifies the second-node capex (~₹2L) plus ops overhead. That tipping point is around ₹5L MRR or ~40 events/month.

4. Security model — tenant isolation in depth
The principle: a custom-domain client must be unable to read, list, modify, or even infer the existence of another studio's data — even if their browser is compromised, even if their session token leaks, even if your app code has a bug. Defense in depth means every layer enforces tenancy independently.

Layer	Mechanism	Threat blocked
Edge (Cloudflare Worker)	Worker reads Host header, looks up studio_id in KV cache (synced from custom_hostnames table). Issues short-lived JWT scoped to studio_id and injects into request as a header. Origin trusts only Worker-signed JWTs.	A malicious request to live.studio-A.com cannot trick the origin into serving studio-B data.
API (Next.js routes)	Every mutating route calls requireAdmin(req) which extracts studio_id from JWT claims. All Supabase queries use .eq("studio_id", auth.studioId).	Lateral movement via stolen session cookie is contained to one studio.
Database (Supabase RLS)	Row Level Security policies enforce studio_id on every SELECT/INSERT/UPDATE/DELETE.	Even if app code has a bug and forgets a WHERE clause, Postgres refuses to leak rows.
Storage (R2 / Cloudinary)	All assets stored under prefix /studio_id/event_id/. Pre-signed URLs include studio_id binding. CDN refuses requests where path prefix mismatches signed claim.	Direct asset URL guessing across studios is blocked.
Streaming (RTMP ingest)	Stream key is per-event UUID, not the literal string "live". Datarhei process auth verifies key matches event row before accepting.	Stream-key sniffing or guessing cannot hijack another studio event.
CSP / Frame protection	Custom-domain pages serve with Content-Security-Policy: frame-ancestors 'self' https://*.eventcast.pro. Admin panel sets X-Frame-Options: DENY.	Clickjacking and embedding admin in malicious iframes blocked.
Audit & rate limits	audit_log captures every mutation. Cloudflare WAF rate-limits per-Host on /api routes. Razorpay webhook signature verified before mutation.	Abuse, scraping, and webhook spoofing get visibility and throttling.
RLS policies (Postgres-enforced tenant isolation)
Table & operation	Policy	Effect
events (SELECT)	USING (studio_id IN (SELECT studio_id FROM studio_members WHERE user_id = auth.uid()))	A logged-in user only sees events for studios they own or are a member of.
events (INSERT/UPDATE/DELETE)	WITH CHECK (studio_id IN (SELECT studio_id FROM studio_members WHERE user_id = auth.uid() AND role IN ('owner','admin')))	Only owners/admins of the studio can mutate events.
wishes (INSERT, public)	WITH CHECK (event_id IN (SELECT id FROM events WHERE published = true))	Anonymous guests can post wishes only to published events. Studio_id is enforced via the event row.
wishes (SELECT, public)	USING (event_id IN (SELECT id FROM events WHERE published = true))	Public reads only published events. Internal notes never leak.
wallet_balances	USING (studio_id IN (SELECT studio_id FROM studio_members WHERE user_id = auth.uid()))	Studios cannot peek at each other balances even with stolen API keys.
audit_log	USING (studio_id IN (SELECT studio_id FROM studio_members WHERE user_id = auth.uid()))	Cross-tenant audit reads blocked at the database layer, not just the app.
Critical: stop using SUPABASE_SERVICE_ROLE_KEY in API routes
The current /api/events/generate uses the service role key, which bypasses RLS entirely. This is acceptable for a single-admin tool, but fatal for multi-tenant: a bug that forgets a WHERE studio_id = ? clause leaks every studio's data. Switch the admin panel to call Supabase with the user's JWT so RLS is the backstop, and reserve the service role key for narrow background jobs (cron, webhooks).

The hidden tenancy hole: HTML injection in generated config
The audit already flagged that user input (groom name, intro text) is regex-replaced into index.html with no escaping. In a multi-tenant world this is far more dangerous: studio A could deliberately inject script tags that run when studio B's QA team previews their event. Migrating event rendering from GitHub-committed HTML to a server-rendered Worker (which auto-escapes via React rendering) closes this entire class of bug.

5. Phased execution plan — what to code first
Three phases. Each ends with a shippable, billable product. Do not start phase N+1 until phase N is in production.

Foundation: multi-tenancy + DB rewrite
4–6 weeks
Goal: any studio can sign up, create events under their own slug, and have those events be database-isolated from every other studio. No billing yet, no custom domains yet.

Task	Touches	Why
Create studios + studio_members tables, backfill owner row	Supabase migration 0001_multitenancy.sql	Foundation. Everything else hangs off studio_id.
Add studio_id NOT NULL to events, wishes, photographers, page_views	Supabase migration 0002_tenant_scope.sql	Tenant isolation cannot be optional. Backfill from current single-admin row.
Rewrite slug to {studio.slug}-{event_slug}; uniqueness per (studio_id, slug)	eventcast-admin/src/app/api/events/generate/route.ts	Today two studios with a "raj-priya-wedding" would collide. Critical bug at >1 tenant.
Replace requireAdmin to also resolve and return studio_id from JWT claims	eventcast-admin/src/lib/auth.ts	Every API route already calls this. One change, dozens of routes get tenant-aware.
Migrate event HTML out of GitHub commits into Postgres + Edge Worker rendering	New Cloudflare Worker: render-event-page	GitHub-as-CMS will not survive 1,000+ events: repo bloat, rate limits, no tenant isolation. Render from DB on the edge.
Build studio signup flow (email verify, slug picker, default brand)	eventcast-admin/src/app/signup/page.tsx	Cannot onboard users without it. Gates the funnel from the AI bot.
Wire RLS policies; remove SUPABASE_SERVICE_ROLE_KEY usage from generate route	Supabase migration 0003_rls_policies.sql + generate/route.ts	Service-role key bypasses RLS. Admin panel should use the user JWT so DB enforces tenancy.
Monetization + white-label custom domains
6–8 weeks
Goal: studios pay (wallet + subscription), Pro tier studios get a working live.studio.com, and the Eventcast brand is fully removable per studio.

Task	Touches	Why
Razorpay integration: orders, webhooks, idempotent ledger writes	eventcast-admin/src/app/api/billing/{webhook,topup,refund}/route.ts	Wallet-first lets you launch without subscription complexity. Webhook idempotency is non-negotiable.
Wallet UI: balance widget, top-up modal, transaction history	eventcast-admin/src/app/components/Wallet.tsx	Studios need to see why an event creation was blocked (insufficient balance).
Pre-flight credit check in generate route (deduct on success, refund on failure)	eventcast-admin/src/app/api/events/generate/route.ts	Prevents free events. Refund-on-failure makes it safe to retry.
Cloudflare for SaaS custom hostname API integration	eventcast-admin/src/lib/cloudflare-saas.ts	POST /zones/{id}/custom_hostnames with hostname+ssl. Polls until SSL active. Stores hostname_id on studio row.
Cloudflare Worker: Host header → studio_id resolution, JWT injection, page render	workers/tenant-router/index.ts	Single Worker handles all custom domains. Reads KV (synced from Postgres). Sub-50ms tenant resolution worldwide.
White-label theming: per-studio logo, color, font in template at render time	wedding-template-01/script.js + Worker render	Removes Eventcast brand entirely on Pro tier. Required for the value prop.
Subscription plans: Razorpay Subscriptions API, plan_tier sync	eventcast-admin/src/app/api/billing/subscriptions/route.ts	Pro tier MRR. Sync state from Razorpay webhooks (created/charged/halted/cancelled).
Scale + AI ops
8–12 weeks
Goal: stateless ingest pool, geo-redundancy, AI sales bot self-onboarding new studios, anti-theft hardening, and full per-tenant observability so you can price correctly.

Task	Touches	Why
Move stateful VOD off media-server filesystem to R2 with streaming write	restreamer FFmpeg output config + workers/r2-archiver	Required before horizontal scaling. Stateless ingest nodes need shared storage.
Multi-region ingest pool (Hyderabad primary, Vizag standby) with anycast RTMP	Infrastructure: Terraform + DNS routing	Geo-redundancy. Studio in Vizag should not go through Hyderabad for ingest.
AI Sales Bot: Vertex AI/Gemini on landing page with cost-savings calculator	New Cloudflare Worker + landing page chat widget	Auto-onboarding. Generates demo links bound to a real studio_id (not a fake).
Stream Health Bot: WhatsApp alerts with auto-recovery actions	eventcast-admin/src/app/api/cron/stream-health-monitor (extend existing)	Already partially built. Add Datarhei process auto-restart on bitrate=0 for >60s.
Wishes Moderation Bot: Vertex AI for spam/toxicity detection	eventcast-admin/src/app/api/wishes/moderate (already in roadmap)	Pre-publish queue. Studios get to approve before guests see.
Anti-theft hardening: signed HLS URLs with studio_id binding, hotlink protection	workers/hls-signer/index.ts + Cloudflare WAF rules	Prevents another studio embedding your stream on their site. Required at Agency tier.
Observability: Posthog/Datadog dashboards, per-studio usage, cost-per-stream tracking	eventcast-admin/src/app/components/AdminAnalytics.tsx + APM agent	You cannot price tiers correctly without per-tenant cost attribution.
6. The first commit you should make this week
Day 1 of Phase 1
Migration 0001: Create studios and studio_members tables. Backfill one row for your current admin user as the first studio (slug eventcast).

Migration 0002: Add nullable studio_id column to events, photographers, wishes, page_views. Backfill all existing rows with the eventcast studio id. Then make the column NOT NULL.

Code change: Update requireAdmin() in src/lib/auth.ts to also load the user's primary studio and return { userId, studioId }. Every API route already calls this — they all become tenant-aware in one PR.

Validation: Run the existing event-create flow end-to-end. It should still work identically because there is exactly one studio. This is the safe, reversible foundation that everything else builds on.

Why this order is correct
You cannot build billing without tenant scoping (who do you charge?). You cannot do custom domains without tenant scoping (who does the domain belong to?). You cannot do AI auto-onboarding without tenant scoping (what does the bot create?). Phase 1 is not glamorous, but it unblocks every revenue feature in the deck. Ship it first, ship it boring, ship it right.

Source: live audit of eventcast-admin, docs/Admin_Panel_Full_Audit.md, and BOT_STRATEGY.md as of May 17, 2026.