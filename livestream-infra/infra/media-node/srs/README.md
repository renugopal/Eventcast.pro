# infra/media-node/srs

## Purpose

Pinned SRS configuration for the EventCast Media Node (Phase 0, Task 2 of `06_IMPLEMENTATION_ROADMAP.md`). SRS is the RTMP ingest and HLS packaging engine only: it accepts H.264/AAC publishes, remuxes to MPEG-TS HLS on a host-mounted staging directory, and calls the Media Agent for publish authorization and segment handoff. It does not own durability, upload, or the public manifest (`01_SYSTEM_ARCHITECTURE.md`, `02_V1_ARCHITECTURE_SPEC.md`).

## Pinned image

```text
ossrs/srs:v6.0-r0
ossrs/srs@sha256:4e293846ad2448ff1a0157aa2c694e7c451fff5046c93b5bc6da0fa0384ef998
```

The digest was resolved on the GCP validation VM with `docker pull ossrs/srs:v6.0-r0` followed by `docker inspect ... --format '{{index .RepoDigests 0}}'`, per `04_TECH_STACK_AND_VERSION_POLICY.md` ("Production V1 pins `ossrs/srs:v6.0-r0` or its verified immutable digest"). Do not replace this pin with a floating tag (`latest`, `6`, etc.) or a different digest without re-running the validation below.

## Configuration file

`srs.conf` is the only file in this directory. It is a direct implementation of the baseline template in `02_V1_ARCHITECTURE_SPEC.md` ("Pinned SRS baseline"), adapted for a multi-container Docker deployment:

- RTMP ingest, HLS packaging (`hls_path /var/lib/eventcast/srs-output`), and `http_hooks` callbacks are enabled.
- `http_server`, `rtc_server`, and `http_remux` (FLV/WebRTC) are explicitly disabled — SRS does not serve viewers directly in V1, so these are unnecessary attack surface.
- `http_api` and `exporter` are enabled for internal use only (see "Required ports" and "Internal callback assumptions" below).

## Required ports

| Port | Purpose | Exposure |
|---|---|---|
| `1935/tcp` | RTMP ingest (OBS/Kiloview publish) | Public-facing, per `02_V1_ARCHITECTURE_SPEC.md` ("RTMP over TCP port 1935 is the V1 publishing protocol") |
| `1985/tcp` | SRS HTTP API (diagnostics/reload) | Never published to the host; reachable only from other containers on the private media-node Docker network |
| `9972/tcp` | Prometheus/OpenMetrics exporter | Never published to the host; reachable only from other containers on the private media-node Docker network |

Ports `80` and `443` are not used by this configuration and must not be added here — HLS viewer delivery goes through Cloudflare/R2, never directly from SRS (`02_V1_ARCHITECTURE_SPEC.md` "HLS over HTTPS is the V1 viewer protocol... MUST come from Cloudflare/R2 delivery, not directly from SRS or the media-node public IP").

## Internal callback assumptions

`http_hooks` points at `http://media-agent:8085/internal/srs/on-publish`, `.../on-hls`, and `.../on-unpublish` — the exact paths defined in `03_DATA_MODEL_AND_API_CONTRACTS.md` ("SRS callback contracts"). `media-agent` is the planned Compose service name/network alias for the EventCast Media Agent container on the shared private media-node Docker network (see `infra/media-node/compose`, not yet implemented). It is intentionally not `127.0.0.1`: in a multi-container Compose deployment, SRS and the Media Agent run in separate network namespaces, so a loopback address would only resolve inside the SRS container itself and could never reach the Media Agent. `http_api` and `exporter` follow the same private-network-only model: they bind to their container's network interface but are never published to the host, so they are reachable only from sibling containers (Media Agent, monitoring agent) on that private network, never from the public internet or the host's public interface.

This is a placeholder wiring for Phase 0/1: the Media Agent's `/internal/srs/on-*` handlers do not exist yet (`services/media-agent` Phase 0 skeleton only implements `GET /healthz`). Real end-to-end callback handling is Phase 1/2 work.

## GCP VM validation commands

All validation ran on the GCP VM (`eventcast-server-new`) via Docker; no Docker, Go, FFmpeg, or SRS install happens on the local Git/SSH control workstation.

```bash
# Resolve and pin the exact digest
docker pull ossrs/srs:v6.0-r0
docker inspect ossrs/srs:v6.0-r0 --format '{{index .RepoDigests 0}}'

# Config syntax/startup check against the pinned digest
docker run --rm -v "$PWD/srs.conf:/usr/local/srs/conf/eventcast.conf" \
  ossrs/srs@sha256:4e293846ad2448ff1a0157aa2c694e7c451fff5046c93b5bc6da0fa0384ef998 \
  ./objs/srs -t -c conf/eventcast.conf

# Isolated network with a stub "media-agent" host alias, then run SRS
docker network create srs-validate-net
docker run -d --name stub-media-agent --network srs-validate-net \
  --network-alias media-agent <stub HTTP server on :8085 returning {"code":0}>
docker run -d --name srs-validate --network srs-validate-net \
  -v "$PWD/srs.conf:/usr/local/srs/conf/eventcast.conf:ro" \
  -v /tmp/srs-validate-output:/var/lib/eventcast/srs-output \
  -p 127.0.0.1:11935:1935 \
  ossrs/srs@sha256:4e293846ad2448ff1a0157aa2c694e7c451fff5046c93b5bc6da0fa0384ef998 \
  ./objs/srs -c conf/eventcast.conf

# Confirm only 1935 is host-published (loopback), 1985/9972 are not
docker port srs-validate
ss -ltnp | grep -E ':1935|:1985|:9972'

# Synthetic RTMP publish (H.264/AAC, ~14s) from the VM itself
ffmpeg -re -f lavfi -i testsrc=size=640x360:rate=30 \
  -f lavfi -i sine=frequency=1000:sample_rate=48000 -pix_fmt yuv420p \
  -c:v libx264 -profile:v main -g 60 -keyint_min 60 -sc_threshold 0 -b:v 1500k \
  -c:a aac -b:a 128k -ar 48000 -f flv rtmp://127.0.0.1:11935/live/teststream

# Inspect logs, HLS output, and stub callback log, then tear down
docker logs srs-validate
docker logs stub-media-agent
find /tmp/srs-validate-output -type f
docker rm -f srs-validate stub-media-agent
docker network rm srs-validate-net
rm -rf /tmp/srs-validate-output
```

Validation performed for this commit confirmed: config parses and starts cleanly against the pinned digest with no errors or warnings beyond expected informational stats notices; the container stayed running for the full test; `1935/tcp` was listening (published loopback-only for the test, `1985`/`9972` not published at all); a 14-second synthetic H.264/AAC RTMP publish was accepted (`on_publish` logged, `response={"code":0}`); three 4-second HLS `.ts` segments plus `local.m3u8` were generated under the staging path; `on_publish`, two `on_hls`, and `on_unpublish` callbacks all reached `http://media-agent:8085/internal/srs/on-*` and were logged by the stub receiver with the exact expected paths and payload shape from `03_DATA_MODEL_AND_API_CONTRACTS.md`.

## Current Phase 0 limitations

- No Docker Compose file exists yet to wire SRS and the Media Agent onto a real shared network (`infra/media-node/compose` is still a placeholder) — the `media-agent` hostname resolves only once that Compose network exists.
- The Media Agent does not yet implement `/internal/srs/on-publish`, `/internal/srs/on-hls`, or `/internal/srs/on-unpublish` (Phase 1/2 work); validation used a temporary stub HTTP receiver, not the real Media Agent.
- No publish authorization, ingest-secret validation, or durable spool capture exists yet — this configuration only proves SRS itself starts cleanly, accepts RTMP, packages HLS, and attempts callbacks with the correct URLs.
- No systemd supervision, firewall rules, or production host mount paths are defined here — `/var/lib/eventcast/srs-output` must exist as a persistent host mount before real deployment, per `02_V1_ARCHITECTURE_SPEC.md` ("Local staging and durable spool").
- No long-duration, multi-stream, or failure-injection testing has been performed; this is a single short synthetic publish only, sufficient for Phase 0 exit criteria and not for Phase 1/9 acceptance.
