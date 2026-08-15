# EventCast.pro - Live Supabase `public.events` Schema Preflight

**Version:** 2.1  
**Query date:** 8 August 2026  
**Mode:** Strictly read-only  
**Scope:** Columns, constraints, indexes, RLS state, RLS policies, and non-system triggers for `public.events`

## 1. Verification result

The live table returned 53 columns. RLS is enabled and not forced. Five RLS policies are active. No non-system triggers are attached. The table has a primary key, tenant-scoped slug uniqueness, foreign keys to `studios` and `photographers`, and checks for legacy deployment status and event visibility.

## 2. Required columns

The live schema requires `id`, `groom_name`, `bride_name`, `event_type`, `event_date`, `event_time`, `template_id`, `studio_id`, `guest_photo_limit`, and `event_visibility`.

This means a completely empty or partially named Draft cannot currently be inserted. The first slice may support Wedding and TLF-001 with the required participant and schedule fields, or a later migration may relax and generalize the participant model. Version 2.1 does not authorize a broad participant-schema redesign in the first slice.

## 3. Important defaults

`id` defaults to `uuid_generate_v4()`. `privacy_status` defaults to `Public`. The legacy `status` defaults to `Active`. `show_timer` defaults to true. `guest_photo_limit` defaults to 50. `guest_photo_wall_enabled` defaults to true. `guest_photo_moderation` defaults to false, which aligns with the accepted Guest Memories Auto Approval default. `event_visibility` defaults to `public`, which is unsafe for Draft insertion unless explicitly overridden and protected by page state.

## 4. Identity and URL foundation

The table enforces `UNIQUE (studio_id, slug)`. This verifies that two studios may use the same slug while one studio cannot duplicate its own slug. It supports the accepted business-subdomain and tenant-scoped event-slug model.

The event UUID remains the immutable internal identity. The nullable slug is a public alias and must not become a streaming, analytics, or storage key.

## 5. Current visibility model

The check constraint allows only `public`, `private`, and `synthetic`. The accepted V1 product model requires Public and Unlisted, while Draft or Published is a separate page status. The current schema therefore requires a controlled future migration rather than overloading visibility to represent every lifecycle condition.

The public-select RLS policy allows non-archived events whose visibility is `public`. It does not check a Published page state because no such column exists. A Draft must never rely on the default public visibility.

## 6. Current lifecycle model

The deployment-status check allows `deploying`, `live`, and `failed`. It does not represent Draft, Published, Ready for Test, Testing, Interrupted, Ended, Replay Processing, Completed, or Archived. `archived_at` provides a genuine archive marker, but the remaining lifecycle and status dimensions are not modeled cleanly.

The legacy `status`, `deployment_status`, `youtube_status`, `privacy_status`, and `event_visibility` fields overlap conceptually. Version 2.1 requires separated event lifecycle, page, stream, YouTube, recording, and media states.

## 7. Schedule model

The schema stores `event_date`, `event_time`, and `timer_target_time`. It has no one authoritative timestamp. Version 2.1 accepts `scheduled_start_at` as the canonical timestamp interpreted in Asia/Kolkata, with legacy date and time fields mirrored only where compatibility requires it.

## 8. Template model

`template_id` is required, but `template_version` does not exist. Canonical template release pinning therefore requires a migration before Version 2.1 template versioning can be fully implemented.

## 9. Legacy columns

The table still stores `restreamer_ingest_url`, `restreamer_stream_key`, `restreamer_url`, `restreamer_hls_url`, and `restreamer_player_url`. These columns are migration debt. They are not dropped in the first Draft Event slice because the current provider UI still depends on the legacy stack.

`auto_delete_date` exists but the accepted page-retention and VOD-retention policies are independent. Its current code use must be checked before it is retained, repurposed, or retired.

## 10. RLS evidence

RLS is enabled. Owners and admins may insert, update, and delete rows for studios in which they hold an owner or admin role. Studio members may select their studio events. Anonymous and authenticated public users may select rows whose visibility is public and whose `archived_at` is null.

No explicit cross-tenant Super Admin policy was present. Platform operations should use a deliberately designed server-side privileged path rather than weakening normal tenant RLS.

## 11. Triggers and indexes

No non-system trigger is attached to the table, so hidden insert or update side effects were not found.

Indexes exist for the primary key, tenant-scoped slug uniqueness, and non-null deployment status. Later lifecycle and page-status query patterns may require new targeted indexes, but no index change is authorized by this preflight.

## 12. First-slice implication

A migration is required for the Route-Based Draft Event Foundation. The migration should be minimal, additive where possible, backward-compatible with the existing public renderer, and limited to fields and policies necessary for Draft persistence, canonical schedule, template version reference, and non-public Draft safety. Exact SQL belongs to the implementation task, not this baseline.
