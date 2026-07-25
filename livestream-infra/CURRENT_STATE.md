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
| `HEAD` | `1e6142d9b5b10af38c1c668272ae37accfb49a5d` |
| Staged entries | 0 |
| Remote Git tip | `1e6142d9b5b10af38c1c668272ae37accfb49a5d` (aligned with local `main` as of 2026-07-26) |

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
`.release.sha256` checksum) is being added to `releases/` in this commit,
reconstructed from the directly verified registry metadata above.

### Remaining gates before deployment

1. **Release workflow redesign (required before next publish).** The current
   `media-agent-release.yml` assumes the package does not exist (HTTP 404
   pre-check). That assumption is permanently false. Additionally, the workflow
   has no step to set package visibility to private before the post-publish
   check. Both defects must be resolved in a separately approved workflow
   change before any future authorized publish run.
2. **VM registry access and immutable-digest pull/verification.** Requires
   separately approved secret-safe provisioning of registry pull access on the
   Linode host.
3. **Compose preflight and deployment.** Remain independent gates after (2).

The directly observed latest-main `livestream-infra CI` run `30172348444`
succeeded for commit `1e6142d9b5b10af38c1c668272ae37accfb49a5d`. It passed
Media Agent image build, Compose rendering, shell syntax, Go format/vet/build/
test/race, and deterministic SRS + MinIO + relay integration.

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
