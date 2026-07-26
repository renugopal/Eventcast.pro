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

### Remaining gates before deployment

1. **Next real publish (v1.0.1 or later).** No real publish beyond v1.0.0 has
   been authorized. The redesigned workflow is validated but a future
   successful release run is a separate future authorization.
2. **VM registry access and immutable-digest pull/verification.** Requires
   separately approved secret-safe provisioning of registry pull access on the
   Linode host. No deployment or VM pull has occurred; the Linode VM remains
   undeployed with no EventCast containers running.
3. **Compose preflight and deployment.** Remain independent gates after (2).
4. **Provider/infra boundary audit and `D:\Eventcast-infra` extraction.**
   Remain future work and are not part of this phase.

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
