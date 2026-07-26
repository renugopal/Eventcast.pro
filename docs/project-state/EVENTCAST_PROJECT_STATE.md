# EventCast project state

**Snapshot date:** 2026-07-26 (updated: release-workflow redesign validation commit)
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
- Near-term exclusions (see
  [`../../livestream-infra/02_V1_ARCHITECTURE_SPEC.md`](../../livestream-infra/02_V1_ARCHITECTURE_SPEC.md)
  for the authoritative decision): no server-side ABR, no GPU transcoding
  dependency, no load balancer, no LL-HLS.
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
- Latest-main CI directly verified the relay startup diagnostic classifier and
  its synchronized terminal-log assertion: source-not-ready input diagnostics
  use the bounded uncounted retry, while destination and ambiguous failures
  consume the restart budget.
- A Linode media-node host bootstrap and SSH-hardening phase was directly
  verified in a prior authorized operation; it was not rechecked during this
  local documentation phase.
- The Media Agent release workflow redesign (Phase 2) is complete and
  validated: commits `899f8c530160129eb678efcac8e8bb7be9cb7c60` and
  `f88f6c533b6121f1bd27cf51baed5ec2ddf08e71` (the Phase 2 validated
  implementation baseline) are on `main`. Main CI (`livestream-infra CI`, run
  `30182379874`) succeeded for `f88f6c533b6121f1bd27cf51baed5ec2ddf08e71` with
  all 7 jobs green, and an
  authorized negative `workflow_dispatch` (`Media Agent immutable release`,
  run `30182697404`) confirmed the redesigned committed-evidence cross-check
  fails closed, before any push, on a mismatched `previous_image_reference`.
  The state-record commit `eef2a6edad5d2abe847872b4f04012041812c644` (`chore:
  update state records after workflow redesign validation`) then completed
  Phase 2: `livestream-infra CI` run `30183379572` — source SHA
  `eef2a6edad5d2abe847872b4f04012041812c644`, conclusion `success` — passed
  all 7 jobs, and current `main` is green.
  See [`../../livestream-infra/CURRENT_STATE.md`](../../livestream-infra/CURRENT_STATE.md)
  for the full gate-by-gate record.

## Current livestream infrastructure status

The local SRS/Media Agent Compose configuration and host-bootstrap material
exist. The host is not authorized for deployment by this document.

The first private GHCR Media Agent image has been published and retained.
The canonical immutable reference is:
`ghcr.io/renugopal/eventcast-media-agent-private@sha256:4d3c65b38843c89c97f81cab631183442b52ed7cd8a308941f8222eb385b77da`
Tag `v1.0.0-1e6142d9b5b1` is a human discovery label only; `deploy.sh` and
`rollback.sh` accept only the digest reference. The earlier
`ghcr.io/renugopal/eventcast-media-agent` package was directly observed as
public and is excluded permanently from deployment and rollback.

The first authorized publish run (30174042836, 2026-07-26) succeeded in
building and pushing the image but failed at the post-publish visibility check:
GHCR defaulted the new package to public because the repository is public. The
workflow correctly caught this and emitted no release evidence. The package was
manually changed to private. Recovery evidence (`.release` manifest and
`.release.sha256` checksum) was reconstructed from directly verified registry
metadata and is committed. The isolated HLS readability proof is complete; see
the livestream state for its exact evidence boundary.

The release workflow's structural defects — it assumed the package did not
exist before any run and had no post-publish gate hardening for an existing
private package — have been resolved. The redesigned `media-agent-release.yml`
(commits `899f8c530160129eb678efcac8e8bb7be9cb7c60` and
`f88f6c533b6121f1bd27cf51baed5ec2ddf08e71`) is on `main`, `livestream-infra CI`
run `30182379874` succeeded for `f88f6c533b6121f1bd27cf51baed5ec2ddf08e71` with
all 7 jobs green, and an authorized negative `workflow_dispatch` (run
`30182697404`) confirmed the redesigned committed-evidence cross-check fails
closed before any push — a successful negative gate validation, not an active
CI blocker. No real v1.0.1 (or later) publish has been authorized; the next
successful Media Agent release remains a separate future authorization. No
deployment or VM pull has occurred; the Linode VM remains undeployed with no
EventCast containers running, and no real livestream has been performed.

The state-record commit `eef2a6edad5d2abe847872b4f04012041812c644` (`chore:
update state records after workflow redesign validation`) is the current `main`
tip. Its `livestream-infra CI` run `30183379572` — source SHA
`eef2a6edad5d2abe847872b4f04012041812c644`, trigger `push`, status
`completed`, conclusion `success` — passed all 7 jobs, and current `main` is
green. No new `media-agent-release.yml` dispatch has occurred since the
authorized negative test run `30182697404`. Run `30182379874` was the prior
successful implementation-baseline CI, and the directly observed latest-main
`livestream-infra CI` run `30172348444` (commit
`1e6142d9b5b10af38c1c668272ae37accfb49a5d`) remains historical, not an active
blocker; it passed Media Agent image build, Compose rendering, shell syntax, Go
format/vet/build/test/race, and deterministic SRS + MinIO + relay integration.
VM pull and deployment remain separate approvals.
See [`../../livestream-infra/CURRENT_STATE.md`](../../livestream-infra/CURRENT_STATE.md)
for the GCP retirement status and the full next-gated-work sequence.

## Pending major work

1. Authorize and execute the next real Media Agent publish (v1.0.1 or later)
   using the redesigned, validated `media-agent-release.yml`. This is a
   separate future authorization; no real publish beyond v1.0.0 has occurred.
2. Provision deployment secrets through an approved mechanism, then perform
   separately approved Linode deployment preflight, secure private-GHCR
   authentication planning, immutable-digest image pull, SRS + Media Agent
   deployment, end-to-end validation, and — only afterward — a production-like
   soak test and a controlled real event, each under separate approval. No
   deployment or VM pull has occurred; the Linode VM remains undeployed with
   no EventCast containers running; no real livestream has been performed.
3. Reconcile legacy Wasabi/Restreamer-era material with the current R2/B2 and
   SRS/Media Agent decisions without treating legacy text as live state.
4. Verify current external deployment, routing, migration, and storage state
   only through separately authorized read-only checks.
5. Provider/infra boundary audit and `D:\Eventcast-infra` extraction remain
   future work, not part of the completed release-workflow redesign phase. Do
   not move the whole `livestream-infra` directory; a future
   `D:\Eventcast-infra` would hold only provider/infrastructure
   responsibilities; extraction/classification requires a separate read-only
   Infra Boundary Audit; no file movement has been authorized.
6. GCP retirement: `eventcast-server-new` (zone `asia-south1-a`, logical alias
   `media-node-staging-02`) is owner-reported TERMINATED/stopped with its
   static IP retained; GCP has not been fully retired. This is owner-reported,
   not newly cloud-verified in this phase. Do not delete the GCP VM, disk,
   static IP, or related resources until Linode deployment and end-to-end
   validation are complete. See
   [`../../livestream-infra/CURRENT_STATE.md`](../../livestream-infra/CURRENT_STATE.md)
   for the detailed record.

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
- This snapshot was updated locally on 2026-07-26. Remote facts cited by the
  linked livestream record retain their own last-verified boundary.
