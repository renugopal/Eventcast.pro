# EventCast livestream infrastructure state

**Local snapshot date:** 2026-07-26
**Evidence boundary:** Local Git and repository content were inspected for this
update. GHCR package metadata and image manifest were directly observed via
read-only API access on 2026-07-26. The isolated SRS HLS result below was
directly verified on the Linode on 2026-07-25; other Linode facts retain their
stated evidence boundary. This file does not authorize deployment, secret
access, host changes, or Git mutation.

## Local Git baseline

| Item | Verified value |
| --- | --- |
| Repository root | `D:\Eventcast.pro` |
| Branch | `main` |
| Phase 2 validated implementation baseline | `f88f6c533b6121f1bd27cf51baed5ec2ddf08e71` — source SHA for successful CI run `30182379874` and negative gate test run `30182697404`; local `main` and remote tip were aligned at this SHA as of 2026-07-26, before this state-record commit |
| Phase 2 state-record commit | `eef2a6edad5d2abe847872b4f04012041812c644` — `chore: update state records after workflow redesign validation`; local `main` and `origin/main` were confirmed aligned at this SHA on 2026-07-26 |
| Staged entries | 0 |

The worktree remains dirty only in unrelated user-owned paths; no livestream
infrastructure file is currently staged. This snapshot does not claim
ownership of unrelated tracked or untracked work.

## Authoritative target and local implementation

- Target stack: SRS + Go EventCast Media Agent only; no Restreamer fallback.
- R2 is for hot/live/temporary/processing media; B2 is authoritative for
  finalized Event Recordings; Wasabi is excluded from new authoritative use.
- The tracked Compose file pins SRS to
  `ossrs/srs@sha256:4e293846ad2448ff1a0157aa2c694e7c451fff5046c93b5bc6da0fa0384ef998`.
- Production Compose requires a `MEDIA_AGENT_IMAGE` immutable registry digest;
  no production default image is selected locally.
- `deploy.sh` and `rollback.sh` reject mutable or malformed Media Agent image
  references. The private package `ghcr.io/renugopal/eventcast-media-agent-private`
  now exists at v1.0.0; deployment requires only the canonical immutable digest.
  The tag `v1.0.0-1e6142d9b5b1` is a human discovery label only; `deploy.sh`
  and `rollback.sh` accept only the production digest reference. The earlier
  `ghcr.io/renugopal/eventcast-media-agent` package was directly observed as
  public and is permanently excluded from deployment and rollback references.

## Prior directly observed Linode evidence — not rechecked in this phase

The following was directly verified in earlier authorized remote phases on
2026-07-25. It is historical evidence for this snapshot, not a claim about the
VM's state at the instant this local-only update was made.

| Area | Last directly observed result |
| --- | --- |
| Provider and region | Linode/Akamai; region Mumbai |
| Host bootstrap | Hostname `eventcast-media-node-akm-01`; `eventcast-admin` exists with passwordless sudo; controlled package/kernel upgrade completed; kernel `6.8.0-136-generic` after reboot |
| Docker | Docker Engine `29.6.2` and Docker Compose `v5.3.1` were active; no EventCast containers were running |
| Host layout | `/opt/eventcast/media-node` skeleton existed; its compliance with the current provisional SRS output contract was not established by this local update |
| Systemd | EventCast unit template was installed but disabled and inactive |
| SSH hardening | `eventcast-admin` key login and passwordless sudo succeeded; effective settings were `passwordauthentication no`, `kbdinteractiveauthentication no`, `permitrootlogin without-password`, `pubkeyauthentication yes` |
| Network controls | UFW and Linode cloud firewall were not changed |
| Application deployment | No SRS or Media Agent Compose stack was deployed; no EventCast application containers were running |

Base host bootstrap and SSH hardening are complete. Private-GHCR authentication
and the immutable Media Agent/SRS pulls have since completed (see "Linode
deployment gate status" immediately below). The production SRS + Media Agent
Compose stack has since been started with a provisioned `.env`, and a first
end-to-end synthetic RTMP-to-HLS livestream has been performed and validated
on this host — see "Gate 10B — first end-to-end RTMP-to-HLS validation
(2026-07-29)" below.

## Linode deployment gate status (through Gate 6C)

**Evidence boundary**: Gates 1, 1.5, the Linode Cloud Firewall audit, 2, 4, 5,
and 6C below were executed externally through ChatGPT Work and reported to the
repository maintainer; they were **not independently re-run or verified by
Claude Code** in any session. Gate 6B (bundle manifest construction) **was**
verified directly by Claude Code from this repository's Git-blob content. This
section is the current authoritative gate record and supersedes the older
"private-GHCR pull/deployment has not been completed" framing found elsewhere
in this file's history.

| Gate | Result | Provenance |
| --- | --- | --- |
| 1 — first read-only SSH preflight | PASSED WITH WARNINGS | External (ChatGPT Work) |
| 1.5 — host directory/permission remediation | PASS | External (ChatGPT Work) |
| Linode Cloud Firewall audit | PASS | External (ChatGPT Work) |
| 2 — private GHCR authentication | PASS | External (ChatGPT Work) |
| 4 — Media Agent immutable pull | PASS | External (ChatGPT Work) |
| 5 — SRS immutable verification | PASS | External (ChatGPT Work) |
| 6A — deployment bundle presence on host | FAIL (bundle absent at that time) | External (ChatGPT Work) |
| 6B — deployment bundle manifest construction | PASS | **Claude Code, this repository's Git-blob content** |
| 6C — deployment bundle installation | PASS | External (ChatGPT Work) |

**Gate 1 (PASSED WITH WARNINGS)**: hostname exactly `eventcast-media-node-akm-01`;
Ubuntu 24.04.4; 2 vCPU; ~3.8 GiB RAM; ~70 GiB disk free; Docker `29.6.2` active;
zero containers; `eventcast-media-node.service` inactive and disabled; TCP
`1935` not listening; UFW inactive; no Restreamer, excluded public package,
`bc43702`, or `media-agent:v1.2-*` artifacts found; no host write occurred.

**Gate 1.5 (PASS)**: `/opt/eventcast/media-node/data/spool` = `65532:65532`,
mode `0750`, empty. `/opt/eventcast/media-node/data/db` = `65532:65532`, mode
`0750`, empty. `/opt/eventcast/media-node/data/srs` = `root:65532`, mode
`2750`, empty, setgid bit present. The forbidden top-level
`/opt/eventcast/media-node/srs-output` path is absent.

**Linode Cloud Firewall audit (PASS)**: firewall `eventcast-media-node-fw-01`
is enabled and attached only to the intended node. Inbound default `Drop`;
outbound default `Accept`. TCP `22` and ICMP are allowed. `1935`, `1985`,
`9972`, and `8085` are all blocked. RTMP `1935` must remain blocked until a
separately approved publisher-CIDR rule is added, and only immediately before
first container start.

**Gate 2 (PASS)**: `/root/.docker` = `root:root`, mode `0700`.
`/root/.docker/config.json` = `root:root`, mode `0600`. `docker login`
succeeded. Config file contents were never printed or read.

**Gate 4 (PASS)**: exact approved image confirmed present —
`ghcr.io/renugopal/eventcast-media-agent-private@sha256:4d3c65b38843c89c97f81cab631183442b52ed7cd8a308941f8222eb385b77da`.

**Gate 5 (PASS)**: exact approved image confirmed present —
`ossrs/srs@sha256:4e293846ad2448ff1a0157aa2c694e7c451fff5046c93b5bc6da0fa0384ef998`.

**Gate 6A (FAIL, expected)**: the deployment bundle was confirmed absent from
the host at the time this gate was checked — this failure is exactly why Gate
6B/6C exist and is not an anomaly.

**Gate 6B (PASS, Claude-session-verified)**: the minimum five-file non-secret
production bundle was identified and verified directly from this repository's
Git-blob content (bypassing this Windows checkout's CRLF working-tree
conversion): `livestream-infra/infra/media-node/compose/docker-compose.yml`,
`compose/deploy.sh`, `compose/rollback.sh`,
`compose/lib/validate-image-reference.sh`, and `livestream-infra/infra/media-node/srs/srs.conf`.
Canonical checksums, ownership/mode targets, symlink checks, shell-syntax
checks, and CRLF-freedom were all confirmed. See the deployment plan record for
the full manifest.

**Gate 6C (PASS)**: the five files above were installed atomically on the host
from exact Git blob content, with checksums, ownership, modes, zero CR bytes,
and shell syntax verified post-install. Created:
`/opt/eventcast/media-node/app/compose` and
`/opt/eventcast/media-node/app/compose/lib`, both `root:root`, mode `0750`.
Installed: `app/compose/docker-compose.yml`, `app/compose/deploy.sh`,
`app/compose/rollback.sh`, `app/compose/lib/validate-image-reference.sh`, and
`config/srs/srs.conf` (the pre-existing `config/srs` directory was reused
unchanged). No temporary files remain. `config/assignments` was untouched.
`.env` remains absent. Zero containers running; service still inactive; TCP
`1935` still not listening. No Compose render, firewall change, Docker-auth
change, image change, or repository/Git mutation occurred as part of this
gate.

**Status update (2026-07-29)**: the `.env` contract audit, `.env`
provisioning, Compose render, first container start, and a first end-to-end
validation publish have all since completed — see "Gate 10B — first
end-to-end RTMP-to-HLS validation (2026-07-29)" below for the full record.
**Current next action**: a production-like soak test, then a controlled real
event, each still requires separate approval.

## GCP retirement status — owner-reported, not newly cloud-verified this phase

The following facts about the legacy GCP validation VM were reported by the
account owner and are recorded here for retention/deletion-safety purposes
only. They were not established through a new GCP API or console query during
this documentation phase; see the "Historical facts and prohibited actions"
evidence-boundary note below.

| Field | Owner-reported value |
| --- | --- |
| Resource name | `eventcast-server-new` |
| Zone | `asia-south1-a` |
| Logical alias | `media-node-staging-02` |
| Compute state | TERMINATED / stopped |
| Static IP | Retained |
| Retirement status | GCP has not been fully retired |

**Do not delete** the GCP VM, its disk, its static IP, or any related resource
until Linode deployment and end-to-end validation are complete.

**DNS note (2026-07-29)**: during Gate 10B, `live.eventcast.pro` was found
still resolving to the GCP VM's old IP (`34.100.142.25`) rather than the
Linode host, and was corrected to `172.105.52.253`. This confirms the GCP
IP was still live in DNS up to that point — a relevant fact for any future
GCP retirement decision, independent of the VM's own reported compute state
above.

## SRS runtime identity and provisional shared-output contract

An earlier authorized inspection pulled and inspected only the exact pinned SRS
digest above. Docker metadata had no configured `User`; the default effective
runtime identity was UID/GID `0:0`. The configured command was
`./objs/srs -c conf/eventcast.conf`. The Media Agent Dockerfile declares
UID/GID `65532:65532`, and its SRS-output mount is read-only.

`SRS_OUTPUT_HOST_DIR` has this verified preflight contract:

| Requirement | Exact value |
| --- | --- |
| Owner UID | `0` |
| Group GID | `65532` |
| Mode | `2750` |
| Purpose | SRS writes as owner; Media Agent group may traverse/read through its read-only mount; no access for others |

`compose/deploy.sh` only validates this exact existing directory; it never
creates it, changes its ownership, or changes its mode. No SRS Compose `user:`
override is configured or approved. The tracked Compose command uses
`umask 0027; exec ./objs/srs -c conf/eventcast.conf` through `/bin/sh`.

## Gate 10B — first end-to-end RTMP-to-HLS validation (2026-07-29)

The first successful end-to-end RTMP-to-HLS validation was performed against
the deployed Linode stack using a synthetic FFmpeg publisher (controlled test
traffic, not a real event).

**Identifiers**

| Field | Value |
| --- | --- |
| Event ID | `f097036e-e02e-4554-992a-b4c66e863a09` |
| Assignment ID | `26cc7be0-796c-41bd-b80a-c0ed62c003a4` |
| Media node | `media-node-staging-02` |
| Node UUID | `0c7d321f-43a6-42b9-93d4-ee641f6f307f` |
| Linode hostname | `eventcast-media-node-akm-01` |
| Linode public IP | `172.105.52.253` |
| Ingest hostname | `live.eventcast.pro` |

**Root cause found before the successful retry**: `live.eventcast.pro` still
resolved to the retired/old GCP IP `34.100.142.25` rather than the Linode
host. The Cloudflare A record (DNS-only, no proxy) was corrected to
`172.105.52.253`. After correction, and while a temporary firewall rule was
active, `Test-NetConnection live.eventcast.pro:1935` succeeded. The earlier
FFmpeg timeout was therefore caused by stale DNS, not by the publisher, SRS,
Media Agent, or the Linode firewall.

**Successful controlled publisher result**: `classification=success`,
`wrapper_exit_code=0`, `ffmpeg_exit_code=0`, `process_started=True`,
`timed_out=False`, `sanitized_failure_category=none`, `frames_sent=146`,
`elapsed_seconds=5.14`; publisher process exit code `0`; no publisher stderr.

**Server-side evidence**: SRS container found; Media Agent container found;
SRS handshake count `1`; SRS publish count `5`; SRS `on_publish` count `1`;
Media Agent `on_publish` count `2`; Media Agent accept count `1`; Media Agent
reject count `0`; HLS playlist count `1`; HLS segment count `14`.

**Cleanup completed**: the temporary Linode firewall rule for TCP `1935` from
`122.175.55.11/32` was removed; `Test-NetConnection live.eventcast.pro:1935`
returned `False` afterward; assignment deactivation returned HTTP `200`; the
retry relay file was deleted; current state is safe idle — no active stream,
assignment disabled, TCP `1935` externally closed, R2 disabled, YouTube
disabled.

**Interpretation**: Gate 10B proves the complete path — synthetic FFmpeg
publisher → public DNS → Linode firewall → SRS RTMP ingest → Media Agent
authorization → HLS playlist and segments. A production-like soak test and a
controlled real event both remain separate, not-yet-performed, future
approvals (see "Remaining gates before deployment" below).

## v1.0.0 publish event and recovery status

### Publish attempt — workflow run 30174042836 (2026-07-26)

The first authorized publish run of `media-agent-release.yml` completed with a
post-publish failure. All pre-publish gates passed: source validation (three
independent assertions), build-context allowlist, gofmt, go vet/build/test,
and package absence check. The image was built and pushed successfully.

The post-publish metadata check (`require private package metadata after first
publish`) failed with message `published package visibility is not private`.
GHCR assigned public visibility to the newly created package because the linked
repository `renugopal/Eventcast.pro` is public. The check correctly exited 1.
The evidence and artifact upload steps were skipped; no workflow-generated
manifest artifact was produced.

The package `eventcast-media-agent-private` was then manually changed to
private visibility in the GitHub GHCR UI.

### Directly observed v1.0.0 image state (2026-07-26)

| Field | Observed value |
| --- | --- |
| Package visibility | `private` (manually corrected) |
| Tag | `v1.0.0-1e6142d9b5b1` |
| Canonical immutable digest | `sha256:4d3c65b38843c89c97f81cab631183442b52ed7cd8a308941f8222eb385b77da` |
| Canonical immutable reference | `ghcr.io/renugopal/eventcast-media-agent-private@sha256:4d3c65b38843c89c97f81cab631183442b52ed7cd8a308941f8222eb385b77da` |
| Platform | `linux/amd64` |
| OCI `revision` label | `1e6142d9b5b10af38c1c668272ae37accfb49a5d` ✓ |
| OCI `source` label | `https://github.com/renugopal/Eventcast.pro` ✓ |
| OCI `version` label | `v1.0.0-1e6142d9b5b1` ✓ |

Image content is valid. Recovery evidence (`.release` manifest and
`.release.sha256` checksum) was added to `releases/` in commit `36a46f7`,
reconstructed from the directly verified registry metadata above.

### Release workflow redesign (Phase 2) — completed

`media-agent-release.yml` was redesigned and validated in two commits:

- `899f8c530160129eb678efcac8e8bb7be9cb7c60` —
  `fix(media-agent-release): redesign workflow for existing private package`.
  Removed the old HTTP 404 package-absence gate; the workflow now requires the
  existing private package to return HTTP 200 with `container` type, `private`
  visibility, and the correct repository linkage before any push. Made
  `previous_image_reference` a mandatory input, added a fail-closed committed
  release-evidence cross-check (Gate R-4, via
  `scripts/validate-release-evidence.sh`), fail-closed tag-uniqueness and
  previous-reference verification against the GHCR Packages API, post-publish
  tag-to-digest identity verification with bounded retry, and OCI
  label/`linux/amd64` platform verification. Future release evidence uses the
  eight-field `release-v2` schema; the committed v1.0.0 five-field `release-v1`
  evidence remains immutable and unchanged. No automated first-package
  bootstrap path exists anymore, and no PAT or new secret was introduced.
- `f88f6c533b6121f1bd27cf51baed5ec2ddf08e71` —
  `fix(media-agent-release): group workflow output writes`. A follow-up
  ShellCheck SC2129 fix (grouped four separate `$GITHUB_OUTPUT` appends into
  one redirect); no gate, input, output, permission, package name, evidence
  schema, API check, retry, or concurrency semantics changed.

**Successful main CI (`livestream-infra CI`, run `30182379874`)** — source SHA
`f88f6c533b6121f1bd27cf51baed5ec2ddf08e71`, conclusion `success`. All 7 jobs
passed: static policy checks (release workflow), gofmt/vet/build/test/race,
docker compose config render, shell syntax, actionlint, build media-agent
image, and the deterministic SRS + MinIO + relay integration test. This run
superseded the earlier failed run `30181011031` (actionlint SC2129), which the
`f88f6c5` commit fixed.

**Authorized negative release-gate test (`Media Agent immutable release`, run
`30182697404`)** — source SHA `f88f6c533b6121f1bd27cf51baed5ec2ddf08e71`,
dispatched with an intentionally incorrect but format-valid
`previous_image_reference`. Conclusion: expected `failure`, at Gate R-4
(`validate release evidence and require previous_image_reference matches`),
message `previous_image_reference does not match latest committed release
evidence`. The publish job was skipped; `docker/build-push-action` did not
execute; the workflow-run artifact count was 0; no image was published. GHCR
package visibility remained `private`, version count remained 1, the existing
tag remained `v1.0.0-1e6142d9b5b1`, and the existing digest remained
`sha256:4d3c65b38843c89c97f81cab631183442b52ed7cd8a308941f8222eb385b77da`.
This was a successful negative gate validation, not an active CI blocker.

**Phase 2 completion — state-record commit
`eef2a6edad5d2abe847872b4f04012041812c644`** (`chore: update state records
after workflow redesign validation`) pushed the validated implementation and
this state-record update to `main`. The resulting `livestream-infra CI` run
`30183379572` — source SHA `eef2a6edad5d2abe847872b4f04012041812c644`,
trigger `push`, status `completed`, conclusion `success` — passed all 7 jobs.
Current `main` is green. No new `media-agent-release.yml` dispatch occurred
after the authorized negative test run `30182697404`, and GHCR package state
remained unchanged (private visibility, version count 1, tag
`v1.0.0-1e6142d9b5b1`, digest
`sha256:4d3c65b38843c89c97f81cab631183442b52ed7cd8a308941f8222eb385b77da`).

### Remaining gates before deployment

Gates 1 through 6C (Linode read-only preflight, host directory remediation,
firewall audit, private-GHCR authentication, immutable Media Agent/SRS pulls,
and non-secret deployment-bundle installation) are complete — see "Linode
deployment gate status" above for the full record and provenance. The next
gated work, in order, each requiring separate approval:

1. **Next real publish (v1.0.1 or later).** No real publish beyond v1.0.0 has
   been authorized. The redesigned workflow is validated but a future
   successful release run is a separate future authorization. (Unrelated to
   the livestream publish validation in items 2-8 below — this item concerns
   the Media Agent Docker image release workflow.)
2. **Read-only `.env` contract audit.** ✅ Complete.
3. **`.env` provisioning.** ✅ Complete.
4. **Compose render.** ✅ Complete.
5. **First container start.** ✅ Complete.
6. **End-to-end validation.** ✅ Complete — see "Gate 10B — first end-to-end
   RTMP-to-HLS validation (2026-07-29)" above.
7. **Production-like soak test.** Still open, under separate approval.
8. **Controlled real event.** Still open, under separate approval, after (7)
   passes. No real (non-synthetic) livestream has been performed to date.
9. **GCP retirement.** Only after successful Linode validation and a period of
   stability observation; see "GCP retirement status" above for the current
   owner-reported VM state and the do-not-delete condition.

**Provider/infrastructure repository boundary (future work, not part of this
phase).** A provider/infra boundary audit and a future `D:\Eventcast-infra`
extraction remain future work. Guardrails for that future work:
- Do not move the whole `livestream-infra` directory.
- A future `D:\Eventcast-infra` would contain only provider/infrastructure
  responsibilities, not application or architecture material.
- Extraction and classification require a separate, dedicated **read-only**
  Infra Boundary Audit before any move is proposed.
- **No file movement has been authorized.**

**Near-term architecture exclusions (unchanged; see
[`01_SYSTEM_ARCHITECTURE.md`](01_SYSTEM_ARCHITECTURE.md),
[`02_V1_ARCHITECTURE_SPEC.md`](02_V1_ARCHITECTURE_SPEC.md), and
[`05_DECISIONS.md`](05_DECISIONS.md) for the authoritative decisions).** No
server-side ABR, no GPU transcoding dependency, no load balancer, no LL-HLS.

The directly observed latest-main `livestream-infra CI` run `30172348444`
succeeded for commit `1e6142d9b5b10af38c1c668272ae37accfb49a5d`. It passed
Media Agent image build, Compose rendering, shell syntax, Go format/vet/build/
test/race, and deterministic SRS + MinIO + relay integration. It has since
been superseded on `main` by run `30182379874` (above).

## Prior SRS readability gate

The isolated publish/readability gate passed directly on 2026-07-25 using the
exact pinned SRS and publisher images, the tracked HLS paths, a temporary
`root:65532`/`2750` output directory, and only `http_hooks` disabled for
isolation. With the `/bin/sh -c 'umask 0027; exec ...'` wrapper, SRS created
directories as `0:65532`/`2750` and real playlists/segments as
`0:65532`/`0640`; UID/GID `65532:65532` could read but not write, no world
permissions existed, and `SIGTERM` cleanly stopped the exec-wrapped PID 1.

## Historical facts and prohibited actions

- Older GCP validation claims and legacy v1.2 runbook statements are historical
  only; they do not establish the current Linode, cloud, Docker, routing, or
  production state.
- Current external state for DNS, Supabase, R2, B2, YouTube, node
  registration, and live traffic is unverified here. The Linode Cloud
  Firewall and GHCR package visibility/publication/pull state are recorded
  above ("Linode deployment gate status") as externally reported through
  ChatGPT Work, not independently re-verified by Claude Code.
- Still prohibited without separate approval: VM changes, Docker daemon or
  registry access, image build/pull/push, deployment, secret access, DNS,
  firewall changes, node registration, storage changes, staging, commit, push,
  and remote Git operations.

## Linked records

- Project-wide state index: [`../docs/project-state/EVENTCAST_PROJECT_STATE.md`](../docs/project-state/EVENTCAST_PROJECT_STATE.md)
- Repository-wide state and authority: [`../CURRENT_STATE.md`](../CURRENT_STATE.md), [`../PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md), [`../AGENTS.md`](../AGENTS.md)
- Deployment implementation: [`infra/media-node/DEPLOYMENT.md`](infra/media-node/DEPLOYMENT.md), [`infra/media-node/compose/README.md`](infra/media-node/compose/README.md)
