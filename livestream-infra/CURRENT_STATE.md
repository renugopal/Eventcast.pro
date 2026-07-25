# EventCast livestream infrastructure state

**Local snapshot date:** 2026-07-25
**Evidence boundary:** Local Git and repository content were inspected for this
update. The isolated SRS HLS result below was directly verified on the Linode
on 2026-07-25; other Linode facts retain their stated evidence boundary. This
file does not authorize deployment, secret access, host changes, or Git
mutation.

## Local Git baseline

| Item | Verified value |
| --- | --- |
| Repository root | `D:\Eventcast.pro` |
| Branch | `main` |
| `HEAD` | `f44cd3e616cf456ae00fb25fea6aab69adc1b630` |
| Staged entries | 0 |
| Remote Git tip | Unverified; no remote query/fetch was performed |

The worktree is dirty. The deployment-hardening slice is deliberately
uncommitted and includes tracked changes under
`infra/media-node/{DEPLOYMENT.md,compose/README.md,compose/deploy.sh,compose/docker-compose.yml,compose/rollback.sh}`
plus untracked local contract helpers/tests, release documentation, and the
manual Media Agent release workflow.
Unrelated dirty and untracked work exists elsewhere and remains user-owned.
This snapshot does not claim ownership of it.

## Authoritative target and local implementation

- Target stack: SRS + Go EventCast Media Agent only; no Restreamer fallback.
- R2 is for hot/live/temporary/processing media; B2 is authoritative for
  finalized Event Recordings; Wasabi is excluded from new authoritative use.
- The tracked Compose file pins SRS to
  `ossrs/srs@sha256:4e293846ad2448ff1a0157aa2c694e7c451fff5046c93b5bc6da0fa0384ef998`.
- Production Compose requires a `MEDIA_AGENT_IMAGE` immutable registry digest;
  no production default image is selected locally.
- `deploy.sh` and `rollback.sh` reject mutable or malformed Media Agent image
  references. Local release-preparation material now specifies future private
  GHCR publication as `ghcr.io/renugopal/eventcast-media-agent`, with a
  `linux/amd64` `v<semver>-<12-char-committed-sha>` tag and deployment only by
  canonical digest. No package, registry login, image, tag, or digest was
  created or queried in this local-only update.

## Prior directly observed Linode evidence — not rechecked in this phase

The following was directly verified in earlier authorized remote phases on
2026-07-25. It is historical evidence for this snapshot, not a claim about the
VM's state at the instant this local-only update was made.

| Area | Last directly observed result |
| --- | --- |
| Host bootstrap | Hostname `eventcast-media-node-akm-01`; `eventcast-admin` exists with passwordless sudo; controlled package/kernel upgrade completed; kernel `6.8.0-136-generic` after reboot |
| Docker | Docker Engine `29.6.2` and Docker Compose `v5.3.1` were active; no EventCast containers were running |
| Host layout | `/opt/eventcast/media-node` skeleton existed; its compliance with the current provisional SRS output contract was not established by this local update |
| Systemd | EventCast unit template was installed but disabled and inactive |
| SSH hardening | `eventcast-admin` key login and passwordless sudo succeeded; effective settings were `passwordauthentication no`, `kbdinteractiveauthentication no`, `permitrootlogin without-password`, `pubkeyauthentication yes` |
| Network controls | UFW and Linode cloud firewall were not changed |
| Application deployment | No SRS or Media Agent Compose stack was deployed; no EventCast application containers were running |

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

## Active deployment blocker and next recommended phase

The isolated publish/readability gate passed directly on 2026-07-25 using the
exact pinned SRS and publisher images, the tracked HLS paths, a temporary
`root:65532`/`2750` output directory, and only `http_hooks` disabled for
isolation. With the `/bin/sh -c 'umask 0027; exec ...'` wrapper, SRS created
directories as `0:65532`/`2750` and real playlists/segments as
`0:65532`/`0640`; UID/GID `65532:65532` could read but not write, no world
permissions existed, and `SIGTERM` cleanly stopped the exec-wrapped PID 1.

The local release-preparation contract now includes a manual-only GitHub
Actions workflow, clean committed-source enforcement, an allowlisted Media
Agent build context, reproducible build flags/OCI metadata, and a real-release
manifest/checksum format. The workflow has `contents: read` and
`packages: write` only; it uses the ephemeral Actions `GITHUB_TOKEN`, never a
local PAT, and cannot commit release evidence back to the repository.

The exact next recommended phase is review and separately approve staging and
committing this local release-preparation slice. Only after that, separately
approve a manual private-GHCR build/publish run. VM registry access,
immutable-digest pull/verification, secret-safe environment provisioning,
Compose preflight, and deployment remain independent gates.

## Historical facts and prohibited actions

- Older GCP validation claims and legacy v1.2 runbook statements are historical
  only; they do not establish the current Linode, cloud, Docker, routing, or
  production state.
- Current external state for DNS, firewalls, Supabase, R2, B2, YouTube, node
  registration, GHCR package visibility/publication, and live traffic is
  unverified here.
- Still prohibited without separate approval: VM changes, Docker daemon or
  registry access, image build/pull/push, deployment, secret access, DNS,
  firewall changes, node registration, storage changes, staging, commit, push,
  and remote Git operations.

## Linked records

- Project-wide state index: [`../docs/project-state/EVENTCAST_PROJECT_STATE.md`](../docs/project-state/EVENTCAST_PROJECT_STATE.md)
- Repository-wide state and authority: [`../CURRENT_STATE.md`](../CURRENT_STATE.md), [`../PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md), [`../AGENTS.md`](../AGENTS.md)
- Deployment implementation: [`infra/media-node/DEPLOYMENT.md`](infra/media-node/DEPLOYMENT.md), [`infra/media-node/compose/README.md`](infra/media-node/compose/README.md)
