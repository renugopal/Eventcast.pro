# infra/media-node/monitoring

Datadog Agent configuration, SRS OpenMetrics scrape config, and host/disk checks for a media node. See `../../../04_TECH_STACK_AND_VERSION_POLICY.md` ("Monitoring") and Phase 8 of `../../../06_IMPLEMENTATION_ROADMAP.md` for required alerts (stalled segments, R2 backlog, disk pressure, Media Agent down, missing playback objects).

## Media Agent metrics endpoint

`GET /metrics` (loopback-only, same bind as `/healthz`/`/readyz`, port `8085` by default) serves every Media Agent metric in standard Prometheus text exposition format (`internal/metrics`). It requires no separate scrape credential and exposes no request-controlled or secret-derived label - see `services/media-agent/README.md` "Implemented (v1.2 production readiness and operations)" for the full metric catalog (publish authorization, sessions, callback outcomes, spool usage, queue depth/age, upload attempts/retry/dead-letter, manifest publication, VOD/VOD-gap status, relay status, control-plane sync, reconciliation, database health, process health, shutdown state).

Per ADR-018, Datadog Agent is the current V1 operational choice: point its [OpenMetrics/Prometheus check](https://docs.datadoghq.com/integrations/openmetrics/) at `http://127.0.0.1:8085/metrics` from the same host (never published beyond loopback). Because the metric interface is standard, plain Prometheus + Alertmanager works identically if that stack is adopted later - the architecture is explicitly vendor-neutral at this boundary.

## Alert rules

`alerts.yml` is the documented alert specification, in native Prometheus alerting-rule format, for every critical/warning condition `02_V1_ARCHITECTURE_SPEC.md` "Observability requirements" and this milestone's production-readiness requirements name: R2 confirmation lag (20s warning / 60s critical, the exact spec thresholds), spool disk free space (25% warning / 15% critical, the exact spec thresholds), upload queue backlog, repeated upload failure (dead-letter), failed VOD finalization, VOD-gap pending review, YouTube relay restart-budget exhaustion, SQLite integrity failure, database unhealthy, control-plane cache stale/critically-stale, and service unavailability.

If Prometheus/Alertmanager is used directly, load `alerts.yml` as a rule file. If Datadog is used instead (ADR-018), each rule here is the source of truth a corresponding Datadog Monitor definition (metric alert on the same `media_agent_*` metric name, same threshold, same `for`/evaluation window) must mirror - do not let the two drift; update both together when a threshold changes.

## SRS OpenMetrics exporter

`../srs/srs.conf` already enables SRS's own `exporter { listen 9972; }`, never published to the host (see `../srs/README.md` "Required ports"). Scrape it the same way, from a sibling container or the host's Datadog Agent reaching the private media-node Docker network - not yet wired into a concrete Datadog Agent config file in this directory (host/disk checks and the Datadog Agent container itself remain a deployment-time configuration exercise, not a repository artifact, since they depend on the specific Datadog account/API key supplied through the approved secret mechanism at deploy time, never committed here).
