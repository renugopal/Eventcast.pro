# EventCast project state

**Snapshot date:** 2026-07-25
**Evidence boundary:** This document distinguishes repository facts, directly
observed remote evidence, and unverified historical reports. It is a project
index, not a deployment authorization or an architecture decision record.

## Authority and architecture

- Repository operating, security, and approval rules: [`../../AGENTS.md`](../../AGENTS.md).
- Architecture map and document precedence: [`../../PROJECT_CONTEXT.md`](../../PROJECT_CONTEXT.md).
- Architecture decisions: [`../architecture-decisions.md`](../architecture-decisions.md).
- Target streaming stack: **SRS + Go EventCast Media Agent only**. Restreamer
  is legacy and is not a fallback.
- Hot/live/temporary/processing media: Cloudflare R2. Finalized Event
  Recordings: Backblaze B2. Wasabi is excluded from new authoritative use.
- Client-visible surfaces must not expose media-node credentials, raw publish
  tokens, service credentials, keys, internal URLs, or direct database access.

## Workspaces and state records

| Area | Workspace/path | State record |
| --- | --- | --- |
| Repository-wide application and architecture | `D:\Eventcast.pro` | [`../../CURRENT_STATE.md`](../../CURRENT_STATE.md) |
| Media node, SRS, and Go Media Agent infrastructure | `D:\Eventcast.pro\livestream-infra` | [`../../livestream-infra/CURRENT_STATE.md`](../../livestream-infra/CURRENT_STATE.md) |
| Control plane/admin application | `D:\Eventcast.pro\eventcast-admin` | Repository-wide state; no dedicated current-state file is established here |
| Event-page rendering Worker | `D:\Eventcast.pro\workers\render-event-page` | Repository-wide state; no dedicated current-state file is established here |

## Completed or established work

- Repository-wide operating rules, source precedence, architecture locks, and
  a root evidence snapshot were established locally.
- The locked architecture and migration target are documented; target status
  does not establish a deployed production stack.
- Local media-node deployment hardening now has immutable Media Agent image
  validation, rollback digest validation, and a verified SRS shared-output
  contract: the pinned SRS image with `umask 0027` creates group-readable,
  non-world-readable HLS output for Media Agent UID/GID `65532:65532`.
- A Linode media-node host bootstrap and SSH-hardening phase was directly
  verified in a prior authorized operation; it was not rechecked during this
  local documentation phase.

## Current livestream infrastructure status

The local SRS/Media Agent Compose configuration and host-bootstrap material
exist. The host is not authorized for deployment by this document. Local
release preparation now specifies a future private GHCR package at
`ghcr.io/renugopal/eventcast-media-agent`, manual Actions publication, and
digest-only deployment identity. No package, image, tag, digest, registry
login, or external visibility setting was created or verified by this local
update. A published immutable Media Agent release and secret-safe environment
provisioning remain required before deployment can proceed. The isolated HLS
readability proof is complete; see the livestream state for its exact evidence
boundary.
See [`../../livestream-infra/CURRENT_STATE.md`](../../livestream-infra/CURRENT_STATE.md).

## Pending major work

1. Review, stage, and commit the local GHCR release-preparation contract; then
   separately approve its first manual immutable build/publish/manifest run.
2. Provision deployment secrets through an approved mechanism, then perform
   separately approved deployment, health, rollback, and live-media gates.
3. Reconcile legacy Wasabi/Restreamer-era material with the current R2/B2 and
   SRS/Media Agent decisions without treating legacy text as live state.
4. Verify current external deployment, routing, migration, and storage state
   only through separately authorized read-only checks.

## Approval boundaries and prohibited actions

- Local source edits, staging, commits, pushes, releases, remote Git queries,
  cloud changes, and remote host changes are separate approvals.
- Do not deploy or roll back services, edit DNS/firewalls, create or inspect
  credentials, change storage, apply migrations, or change a VM merely because
  a local contract or document exists.
- Do not introduce Restreamer, select Wasabi for new work, or override a locked
  architecture decision without a reviewed ADR or explicit owner decision.

## Known risks and evidence freshness

- The SRS HLS ownership/mode gate passed only for the exact pinned image,
  tracked HLS paths, and the validated `umask 0027` exec wrapper. Changing
  image, command, output path, or mount contract requires a new validation.
- Repository-local Git refs do not prove the current remote tip without a
  separately authorized remote query.
- Historical GCP, Cloudflare, Supabase, storage, and production-routing claims
  are not current facts unless their linked workstream record labels them as
  directly observed evidence.
- This snapshot was updated locally on 2026-07-25. Remote facts cited by the
  linked livestream record retain their own last-verified boundary.
