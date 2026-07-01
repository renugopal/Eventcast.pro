# infra/media-node

## Purpose

Deployment configuration for a media node: SRS, Docker Compose, systemd supervision, host firewall rules, and monitoring config. This directory is currently a placeholder created during the Phase 0 repository baseline (`06_IMPLEMENTATION_ROADMAP.md`). No deployment files exist yet.

## Governing documents

1. `../../01_SYSTEM_ARCHITECTURE.md` — Media node section
2. `../../02_V1_ARCHITECTURE_SPEC.md` — normative runtime behavior
3. `../../04_TECH_STACK_AND_VERSION_POLICY.md` — pinned SRS image, Compose/systemd runtime, Datadog monitoring choice
4. `../../08_OPERATIONS_RUNBOOK.md` — deployment, rollout, and rollback procedure

## Subdirectories

- `srs/` — pinned SRS (`ossrs/srs:v6.0-r0` or verified digest) configuration. Every configuration change must be validated against the exact pinned image before rollout (real publish + callback smoke test), not assumed from a documentation snippet.
- `compose/` — Docker Compose definitions for SRS, Media Agent, and supporting agents on a single node. Images must be pinned by tag plus digest. Host directories, SQLite, and spool data must persist independently of containers.
- `systemd/` — unit files supervising the Compose application on the host.
- `firewall/` — host firewall rules (RTMP ingest, loopback-only Media Agent HTTP, monitoring egress).
- `monitoring/` — Datadog Agent configuration, SRS OpenMetrics scrape config, host/disk checks.

## Deployment rules

A single-node deployment is permitted only for local development, proof-of-concept, and controlled beta. Paid production requires at least two independently assigned media nodes. New images must roll out to a non-live canary node, then one production node without assigned critical events, and only then to remaining nodes. See `../../08_OPERATIONS_RUNBOOK.md`.
