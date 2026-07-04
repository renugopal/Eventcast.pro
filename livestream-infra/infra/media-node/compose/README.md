# infra/media-node/compose

## Status: Phase 0 Task 3 — full stack validated

**Full end-to-end validation (RTMP publish accepted, HLS generated, SRS callbacks succeeding against the real Media Agent) has passed.** The previously confirmed blocker — the Media Agent Phase 0 skeleton implementing only `GET /healthz` and returning `404` for the SRS callback routes — is resolved: the Media Agent now implements `/internal/srs/on-publish`, `/internal/srs/on-hls`, and `/internal/srs/on-unpublish` (`03_DATA_MODEL_AND_API_CONTRACTS.md` "SRS callback contracts"; `services/media-agent` commit `bb286d8`, image `media-agent:phase0-task3`).

Re-validated on the GCP validation VM with the **real** `media-agent:phase0-task3` container (no stub): a synthetic FFmpeg RTMP publish reached SRS, SRS called `on_publish` and 30x `on_hls` and one `on_unpublish` against the real Media Agent, every callback returned HTTP `200 {"code":0}`, and a valid HLS playlist (`local.m3u8`) with 30 `.ts` segments was produced under the SRS output volume. See "GCP VM validation commands" below for the exact commands and results.

## Purpose

Docker Compose stack wiring the pinned SRS container (`infra/media-node/srs`, commit `0284532`) and the pinned Media Agent container (`services/media-agent`, commit `bb286d8`) onto a private Docker network for a single media node, per `04_TECH_STACK_AND_VERSION_POLICY.md` ("Deployment runtime": "A media node may use Docker Compose for SRS, Media Agent, and supporting agents").

## Files

- `docker-compose.yml` — the two-service stack. Every host-identifying value (image tag, container name, host bind port, host bind path) is overridable via an environment variable, all defaulting to the real persistent single-VM values shown below; this is what lets `phase2-integration-test.sh` stand up a fully isolated copy without touching the persistent deployment.
- `.env.example` — non-secret Compose variables (`EVENTCAST_NODE_ID`, `EVENTCAST_LOG_LEVEL`). Copy to `.env` for local use only; never commit a real `.env`.
- `smoke-test.sh` — automated, repeatable end-to-end validation of this stack against its real persistent paths and container names (Phase 0 Task 4). See "Automated smoke test" below.
- `phase2-integration-test.sh` — automated, repeatable RTMP-to-HLS integration proof against a fully isolated, uniquely-named copy of this stack (Phase 2). See "Phase 2 integration test" below.

## Images

| Service | Image | Pin |
|---|---|---|
| `srs` | `ossrs/srs:v6.0-r0` | `sha256:4e293846ad2448ff1a0157aa2c694e7c451fff5046c93b5bc6da0fa0384ef998` (registry digest, resolved in `infra/media-node/srs`) |
| `media-agent` | `media-agent:phase0-task3` | Local build tag from Phase 0 Task 3 (image ID `sha256:df29851bb8bd`), built from `services/media-agent` commit `bb286d8`; no registry digest exists because this image has not been pushed anywhere — the tag is the immutable reference for this locally-built artifact. |

Neither reference is a floating tag (`latest`, `6`, etc.).

## Network and ports

Both services join a private Compose-managed bridge network (`media-node`); SRS reaches the Media Agent by the Compose service/DNS hostname `media-agent`, not a public IP or loopback address (loopback would only resolve inside SRS's own container).

| Port | Service | Published? |
|---|---|---|
| `1935/tcp` | `srs` | Yes, `0.0.0.0:1935` — RTMP ingest is the intended public-facing port (`02_V1_ARCHITECTURE_SPEC.md`) |
| `1985/tcp` (HTTP API), `9972/tcp` (exporter) | `srs` | No — reachable only from sibling containers on the private network, never published to the host |
| `8085/tcp` (`/healthz`) | `media-agent` | Yes, but bound to `127.0.0.1` only — never publicly reachable |

The Media Agent listens on `0.0.0.0:8085` **inside its own container** (`EVENTCAST_MEDIA_AGENT_HTTP_ADDR=0.0.0.0:8085`) so the `srs` container can reach it by hostname; this is safe because the host-side Compose port mapping is loopback-only (`127.0.0.1:8085:8085`), so the service is never reachable from outside the VM regardless of the container-internal bind address.

## Volumes

| Host path | Container path | Service | Purpose |
|---|---|---|---|
| `/opt/eventcast/media-node/config/srs/srs.conf` | `/usr/local/srs/conf/eventcast.conf` (read-only) | `srs` | Pinned, committed SRS config |
| `/opt/eventcast/media-node/data/srs` | `/var/lib/eventcast/srs-output` | `srs` | HLS staging output (`hls_path` in `srs.conf`) |
| `/opt/eventcast/media-node/data/spool` | `/var/lib/eventcast/spool` | `media-agent` | Reserved for the future durable spool (`02_V1_ARCHITECTURE_SPEC.md`); unused by the current Media Agent skeleton, mounted now so the path is stable across phases |

## Health checks and startup ordering

- `media-agent` uses its image's built-in `/media-agent healthcheck` subcommand (a self-contained `GET /healthz` call, no extra HTTP client needed).
- `srs` uses a `bash -c 'echo > /dev/tcp/127.0.0.1/1985'` TCP probe against its own container-local HTTP API — the SRS image ships no `curl`/`wget`/`python3`. This checks the API is accepting connections; it does not use the API from outside the container and does not require publishing the port.
- `srs` declares `depends_on: media-agent: condition: service_healthy`, so SRS does not start until the Media Agent is confirmed healthy.

## Restart policy

Both services use `restart: unless-stopped`, appropriate for a staging node: automatic recovery from a crash or host reboot, but no fighting an operator's explicit `docker compose stop`.

## GCP VM validation commands

All validation ran on the GCP VM (`eventcast-server-new`) via `docker compose`; no Docker, Go, FFmpeg, or SRS install happens on the local Git/SSH control workstation.

```bash
cd /opt/eventcast/media-node/app/compose
cp .env.example .env
docker compose config
docker compose up -d
docker compose ps                              # expect both "healthy"
curl -sS http://127.0.0.1:8085/healthz         # expect HTTP 200
ss -ltnp | grep -E ':1935|:1985|:9972|:8085'   # 1935 public, others absent/loopback

# Synthetic RTMP publish (H.264/AAC, ~14s)
ffmpeg -re -f lavfi -i testsrc=size=640x360:rate=30 \
  -f lavfi -i sine=frequency=1000:sample_rate=48000 -pix_fmt yuv420p \
  -c:v libx264 -profile:v main -g 60 -keyint_min 60 -sc_threshold 0 -b:v 1500k \
  -c:a aac -b:a 128k -ar 48000 -f flv rtmp://127.0.0.1:1935/live/teststream

docker compose logs srs --tail 30               # inspect on_publish result
docker compose restart
docker compose ps                               # expect both "healthy" again
docker compose down                              # removes only this stack's containers/network
docker images                                    # confirm srs/media-agent images preserved
```

Validated on the GCP VM for this task: `docker compose config` produced a clean resolved config; `docker compose up -d` started both containers, and both reported `healthy` (Media Agent first, then SRS per the dependency gate); `GET http://127.0.0.1:8085/healthz` returned `200` on VM loopback; `1935/tcp` was listening publicly (`0.0.0.0`/`[::]`) while `1985`/`9972` had no host binding at all and `8085` was loopback-only. A synthetic ~20s FFmpeg RTMP publish reached SRS (RTMP handshake succeeded); SRS called `on_publish` once, `on_hls` 30 times, and `on_unpublish` once against the real `media-agent:phase0-task3` container, and every callback returned HTTP `200 {"code":0}`; the SRS output volume contained a valid `local.m3u8` playlist referencing 30 `.ts` segments. `docker compose restart` brought both services back to `healthy`. `docker compose down` removed exactly this stack's two containers and its network, leaving all other host state, the pulled/built images, and the persistent `data/srs` and `data/spool` directories untouched; the temporary synthetic-stream output under `data/srs/live` was removed afterward as test cleanup, not by Compose itself.

## Automated smoke test

`smoke-test.sh` (Phase 0 Task 4) automates everything under "GCP VM validation commands" above into a single repeatable, non-interactive script. It must run on the GCP VM only (it requires Docker, Docker Compose, and FFmpeg); it never installs or requires any of those on the local Git/SSH control workstation.

```bash
cd /opt/eventcast/media-node/app/compose
./smoke-test.sh
echo "exit code: $?"   # 0 = every check passed
```

What it does, in order: validates `docker compose config`; starts the stack; waits (bounded, default 60s) for both containers' Docker healthchecks to report `healthy`; verifies `GET http://127.0.0.1:8085/healthz` returns `200`; verifies `1935/tcp` is listening publicly, `8085/tcp` is loopback-only (`127.0.0.1`, not `0.0.0.0`), and `1985/tcp`/`9972/tcp` are not published at all; runs a synthetic FFmpeg RTMP publish to a uniquely-named test stream (`smoketest-<unix-timestamp>`) bounded by both `-t 15` (the expected clean stop — placed as an output option immediately before `-f flv <url>`, not after the URL, which was the placement bug in the original manual validation that let a publish run past its intended duration) and an outer `timeout` hard cap (25s, force-kill after 5 more); verifies the real Media Agent's logs show a successful `on_publish`, at least one successful `on_hls`, and a successful `on_unpublish` for that stream; verifies a non-empty `local.m3u8` HLS playlist and at least one `.ts` segment were written; restarts the stack and re-waits (bounded, default 60s) for both containers healthy again.

A `trap` on `EXIT`/`INT`/`TERM` always runs cleanup regardless of pass or fail: `docker compose down --remove-orphans` (removes only this stack's containers and network) and deletion of only that run's own `data/srs/live/smoketest-<timestamp>/` output directory. Docker images and the persistent `data/srs`/`data/spool` directory structure are never touched by cleanup. Any failed check prints a `[smoke-test][FAIL] ...` line naming the check and exits non-zero; no step in the script prints secrets (this Phase 0 flow carries no publish tokens yet, and `.env`/`.env.example` values are never echoed).

Validated on the GCP VM for this task: a full run of `smoke-test.sh` passed all checks end to end (config validation, startup, health, port exposure, bounded RTMP publish, all three callbacks, HLS playlist/segments, restart recovery) and printed `all checks passed`; the trap-driven cleanup removed the run's containers, network, and temporary stream output while leaving the `media-agent:phase0-task3`/`ossrs/srs:v6.0-r0` images and the `data/srs`/`data/spool` directories intact. The bounded FFmpeg publish exited cleanly via `-t 15` well inside the 25s hard timeout on every run.

## Phase 2 integration test

`phase2-integration-test.sh` is the automated, non-interactive RTMP-to-HLS integration proof required for v1.2 Phase 2. Unlike `smoke-test.sh`, it never touches the persistent deployment: every resource it creates (Compose project name, both container names, the built Media Agent image tag, the host temp directory, and both host ports) is suffixed with a run ID unique to that invocation, so it always stands up an isolated, uniquely-named copy of this same stack — safe to run even alongside a real deployment on the standard paths/ports/names.

```bash
cd infra/media-node/compose
./phase2-integration-test.sh              # full run: functional stream + reconnect + ~12 min soak
QUICK=1 ./phase2-integration-test.sh      # functional + reconnect only, no soak (used to prove a
                                           # second, fully independent run never collides with a
                                           # prior run's resources)
```

What it does, in order: builds the **current** `services/media-agent` source into a uniquely-tagged image (or reuses one via `MEDIA_AGENT_IMAGE=<tag>`); validates `docker compose config`; starts an isolated copy of this stack under a unique project name, with unique container names and unique loopback-only host ports (auto-selected, never colliding with the persistent deployment's `8085`/`1935`); waits for both services healthy; runs direct HTTP contract checks against the Media Agent (method handling, malformed JSON, success shape) independent of SRS; publishes a short synthetic FFmpeg RTMP stream — attached to the run's own private Compose network and addressing SRS by its service DNS name (`srs:1935`), never via a host-published port — using a stream key in the documented `<ingest_id>?token=<secret>` form; verifies `on_publish`/`on_hls`/`on_unpublish` all reached the Media Agent, that HLS segments were produced and are real, readable H.264/AAC MPEG-TS (checked via `ffmpeg -i` stream inspection, no `ffprobe` needed), and that the synthetic secret token never appears in Media Agent logs; stops that publisher cleanly and republishes the **same** stream name to prove a reconnect leaves the stack healthy and produces a second `on_publish`/`on_unpublish` pair; then (unless `QUICK=1`) runs a further ~12-minute soak publish on a new stream, sampling the HLS playlist's `EXT-X-MEDIA-SEQUENCE` and both services' health every 90 seconds and requiring the sequence to strictly advance and both services to stay healthy at every sample, and finally verifies segment count, codec readability, callback success, and secret redaction for the soak stream too.

The publisher and its one-shot stream-inspection calls run only inside temporary `--rm` containers of a pinned, digest-referenced test image (`mwader/static-ffmpeg`, resolved the same way as the SRS pin in `../srs/README.md`); FFmpeg is never installed on the VM or required on the local workstation. A `trap` on `EXIT`/`INT`/`TERM` always tears down exactly this run's Compose project (containers + its own network), any leftover publisher containers, the uniquely-tagged built image (unless `MEDIA_AGENT_IMAGE` reused an existing one), and the run's own `/tmp` directory — never the persistent deployment's containers, images, or `/opt/eventcast` data.

The full two-hour, multi-stream, hardware-encoder soak required for release qualification (`06_IMPLEMENTATION_ROADMAP.md` Phase 1 exit criteria) is a separate, later operational gate; it is out of scope for this automated code-delivery proof.

## Current Phase 0 limitations

- No systemd unit supervises this Compose application yet (`infra/media-node/systemd` is still a placeholder).
- No firewall rules restrict access to the published `1935/tcp` port yet (`infra/media-node/firewall` is still a placeholder) — this is deployment-environment configuration, not something this Compose file can enforce.
- No monitoring agent (Datadog) is wired into this stack yet (`infra/media-node/monitoring` is still a placeholder); the SRS exporter and Media Agent are reachable only from sibling containers on the private network once one is added.
- No publish authorization, ingest-secret validation, or durable spool capture exists yet, consistent with the Media Agent's own Phase 0 limitations — every well-formed SRS callback currently succeeds.
