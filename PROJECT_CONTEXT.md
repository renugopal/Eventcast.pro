# EventCast.pro Project Context

**Status:** Authoritative repository-level purpose, architecture map, and
document-precedence guide

**Reviewed:** 2026-07-24

**Current implementation and operational state:** `CURRENT_STATE.md`

## Project purpose

EventCast.pro is an event-media platform for creating and operating branded
event pages, administering studios and events, coordinating live-stream
lifecycle and optional YouTube relay, delivering live playback, and preserving
finalized Event Recordings. The repository contains the control-plane
application, event-page renderer and templates, live-media infrastructure, the
Go Media Agent, database migrations, event instances, and historical planning
and operational artifacts.

This document defines purpose, durable boundaries, and where authoritative
detail lives. It does not claim that target architecture is deployed. Verified
repository and external-state facts belong in `CURRENT_STATE.md`.

## Repository map

| Path | Role |
| --- | --- |
| `eventcast-admin/` | Next.js admin/control-plane application, APIs, Supabase migrations, and tests. Its nested `AGENTS.md` governs framework-specific work. |
| `livestream-infra/services/media-agent/` | Go Media Agent: publisher authorization, session lifecycle, durable local state/spool, upload/manifest/VOD orchestration, relay supervision, and control-plane synchronization. |
| `livestream-infra/infra/media-node/` | SRS, media-node Compose/systemd/firewall/monitoring configuration and operational validation material. |
| `livestream-infra/packages/contracts/` | Shared live-media contracts. |
| `workers/render-event-page/` | Cloudflare Worker that renders event pages from templates/contracts. |
| `workers/hls-signer/` | Existing HLS-related Worker configuration; its present role must be verified before change. |
| `docs/` | Current architecture/contract/planning docs plus explicitly archived `docs/_legacy/`. |
| `*-template*`, named event directories, `events/`, `assets/` | Template sources, generated/published event-page artifacts, and media assets. Treat published/generated artifacts cautiously and verify ownership before editing. |
| `scripts/`, `scratch/` | Operational or investigative utilities and outputs. They are not authoritative architecture or current-state evidence by themselves. |

## Architecture locks

The following repository-level decisions are in force:

1. **Streaming:** SRS plus the **Go EventCast Media Agent** is the only target
   production streaming stack. New design, provisioning, deployment, or
   fallback mechanisms must not create, restore, or select Restreamer, and
   Restreamer must not be used as fallback. Existing production routing must
   not be changed, and legacy components must not be retired, without in-scope
   read-only external verification, explicit deployment authorization, and the
   reviewed cutover sequence.
2. **Media storage:** Cloudflare **R2** holds hot, live, temporary, upload, and
   processing media. **Backblaze B2** is the authoritative durable store for
   finalized Event Recordings.
3. **Excluded storage:** **Wasabi is excluded** from new authoritative design
   and writes. Existing Wasabi code/docs are legacy reconciliation evidence;
   their safe disposition remains a separate reviewed task.
4. **Client boundary:** Browser code, studio UI, public/client APIs, and
   client-visible responses must never receive media-node credentials, raw
   publish tokens, YouTube keys, service-role credentials, credential digests,
   replay nonces, internal URLs, direct database connections, or internal query
   capability.
5. **Media/control-plane boundary:** The control plane handles business state,
   assignment, authorization, and aggregate status. SRS handles ingest/media
   packaging. The Go Media Agent owns durable media lifecycle and
   orchestration. A temporary control-plane outage must not be designed to
   interrupt an already-authorized live media path.
6. **Secret behavior:** Use least privilege, one-time/raw-token non-retrieval
   where designed, hashes/digests only in internal persistence where
   appropriate, replay protection, redacted structured logs, and fail-closed
   authorization.

Other accepted product decisions remain in
`docs/architecture-decisions.md`, including studio-as-tenant, immutable
template releases, the canonical event-contract target, Supabase email plus
mobile OTP, and backend-verified Razorpay with an append-only integer-paise
ledger.

## Authoritative reading and precedence

Authority is category-specific. Use the narrowest applicable source only
within its category and within all higher-level safety and architecture
constraints:

1. **Operating, security, evidence, and approval rules:** root `AGENTS.md`.
2. **Subtree instructions:** an applicable nested `AGENTS.md` adds rules for its
   subtree but cannot weaken root safety, evidence, architecture, or approval
   requirements.
3. **Architecture decisions:** the latest applicable reviewed entry in
   `docs/architecture-decisions.md`. This file maps and summarizes those
   decisions; it does not silently supersede an ADR.
4. **Project map and source classification:** this file.
5. **Domain detail within ADR constraints:** the applicable current domain
   documents:
   - `docs/event-contract.md`
   - `docs/template-package-spec.md`
   - `docs/media-processing.md`
   - `docs/streaming-lifecycle.md`
   - `docs/payments-ledger.md`
   - `docs/test-plan.md`
   - `docs/implementation-plan.md`
   - `docs/implementation-status.md`
6. **Observed local facts and explicitly unverified external context:**
   `CURRENT_STATE.md`; it describes state but cannot override architecture.
7. **Implementation evidence:** current code, contracts, tests, and focused
   runbooks, interpreted under the governing instructions, ADRs, and domain
   documents.
8. **Still-applicable baseline mechanics:** `livestream-infra/` documents for
   SRS/Media Agent mechanics only. Their Restreamer-fallback or Wasabi-archive
   statements are superseded by the reviewed cross-repository ADRs.

If this context document and an applicable ADR appear to conflict, stop and
report the conflict. Do not select a conflicting architecture statement as
authoritative without an explicit superseding reviewed ADR or owner decision.

When current code and an authoritative target document differ, report
"implemented state" and "target state" separately. Do not edit either side
silently to erase the gap.

## Historical and non-authoritative sources

- `docs/_legacy/` is archival by directory contract.
- `MASTER_PLAN.md`, `TASK_LOG.md`, `PROJECT_DIARY.md`, and
  `PROJECT_DIARY_TELUGU.md` preserve useful history but contain stale
  Restreamer, GCP, and product-completion claims. They are not current-state
  sources.
- Untracked `.cursor/` and `.claude/` files are local agent/tool settings, not
  repository architecture authority.
- Scratch scripts, event provisioning scripts, comments claiming a migration
  was applied, and old deployment-validation notes are leads to verify, not
  proof of present remote state.
- Prior ChatGPT Project conversations may explain intent or point to evidence,
  but they do not verify local Git, Supabase, GCP, Cloudflare, B2, R2, YouTube,
  or any other remote system.

## Known documentation conflicts

The 2026-07-02 `livestream-infra` v1.2 pack describes Wasabi as the finalized
archive, while the newer 2026-07-13 cross-repository ADR set locks B2 as the
authoritative finalized store and marks Wasabi legacy/superseded. For new work,
the newer cross-repository ADR and the locks in this file govern. The older
pack remains valuable for SRS/Media Agent durability mechanics but requires a
separate reviewed reconciliation before it can again be treated as wholly
normative.

The untracked `.cursor/rules/youtube-only-streaming.mdc` describes a temporary
YouTube-only event policy and forbids HLS wiring. That may describe an
operational period, but it does not override the SRS + Go Media Agent target.
Verify live deployment and event policy externally before operational work;
never infer it from this local rule.

## Change control

- Architecture changes require a reviewed ADR; implementation and logs follow
  the decision rather than retroactively redefining it.
- Continuity updates follow `AGENTS.md` and never expand current-task
  authorization. Refresh `CURRENT_STATE.md` from direct evidence only when the
  current request authorizes that exact path, and add a concise material-work
  entry only when it separately authorizes `MATERIAL_WORK_LOG.md`. A read-only
  or no-write task reports verification or a pending continuity refresh without
  mutating either file. Editing, staging, and committing remain separate
  permissions.
- Unknown pricing, tax, capacity, retention, remote application state, and
  deployment state remain `TBD` or `unverified`; do not invent them.
