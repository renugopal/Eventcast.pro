# 09 — Claude Code Execution Rules

## Required behavior

Claude Code must treat this documentation set as the approved architecture contract. Before coding, it must identify the current roadmap phase, read all documents that govern that phase, inspect the existing repository, and state the smallest implementation plan that reaches the phase exit criteria.

It must not reinterpret deferred features as V1 requirements. It must not replace SRS, R2, Wasabi, SQLite, or the ordered manifest design without an approved decision record.

## Scope discipline

Implement one roadmap phase or one explicitly requested subtask at a time. Avoid unrelated framework upgrades, broad refactors, UI redesigns, or dependency churn. Preserve existing EventCast functionality unless the task explicitly changes it.

When repository reality differs from these documents, report the mismatch, explain its impact, and make the least invasive compliant change. Do not silently rewrite architecture documents to justify an implementation shortcut.

## Production-quality rules

Do not create demo-only implementations in production paths. Do not use in-memory queues for required durability. Do not treat SRS-owned output as the only durable copy; capture each completed segment into the Media Agent spool before callback success. Do not mark uploads successful before provider confirmation. Do not publish SRS's local playlist. Do not implement a self-referential archive-manifest checksum. Do not delete routine local-spool copies for archive-required events before archive verification. Do not use random sleeps as synchronization. Do not claim per-viewer private authorization when using direct public R2 custom-domain objects without the approved signed-access layer. Do not hide provider errors behind generic success responses.

All externally triggered work must be idempotent. All retries must be bounded per attempt, observable, and persist across restart. All file paths must be validated against the spool root. All subprocess arguments must avoid shell interpolation. All secrets and stream keys must be redacted from logs.

## Testing rules

Every change must include focused unit tests and integration tests appropriate to its failure modes. Media ordering, callback duplication, queue recovery, manifest generation, state transitions, provider retries, and deletion guards require tests before the phase is considered complete.

Tests must include negative cases. A successful happy-path stream is not sufficient. Do not weaken tests to make a build pass.

## Database rules

Use additive, reviewed Supabase migrations. Do not edit an already-applied migration. Enforce enums or check constraints for state values where appropriate. Use transactional compare-and-set logic for event transitions. Avoid one database row per HLS segment in Supabase.

SQLite migrations must be versioned and safe across restart. Enable WAL, foreign keys, busy timeout, and integrity checks.

## Configuration rules

All deployable versions and images must be pinned. The exact SRS image must parse/start with the generated configuration and pass a real publish/callback smoke test; do not assume a documentation snippet from another SRS branch is deployable unchanged. Configuration must be typed, validated at startup, and fail fast on missing required values. Secrets must come from the approved secret mechanism, never `.env` committed to source control.

Environment-specific hostnames, bucket names, and credentials must not be hardcoded. Behavioral constants approved in the architecture, such as segment duration and DVR window, should have safe defaults and explicit configuration validation.

## Logging and metrics

Use structured logs with event ID, session ID, node ID, job ID, provider, attempt, and stable error code where applicable. Never log secret keys, full signed URLs, authorization headers, or sensitive customer content.

Add metrics with bounded label cardinality. Do not use event ID or stream key as an unbounded metric label. Event-specific diagnosis belongs in logs and traces.

## Repository placement

Prefer the following logical boundaries while adapting to the existing repository rather than forcing a destructive restructure:

```text
apps/ or existing web root        EventCast control plane
services/media-agent              Go Media Agent
infra/media-node                  SRS, Compose, systemd, firewall, monitoring config
supabase/migrations               Control-plane schema changes
packages/contracts or equivalent  Shared API/state contracts
docs/architecture                 This documentation pack
```

The media node must be independently buildable and deployable from the web application.

## Completion report

At the end of a task, report files changed, migrations added, tests run, test results, configuration changes, operational impact, known limitations, and the next roadmap gate. Do not claim production readiness until the acceptance plan has actually passed.

## Architecture change procedure

If a requested implementation requires violating a current decision, stop that implementation path and draft a new ADR entry containing context, proposed decision, alternatives, reliability impact, cost impact, migration, rollback, and tests. Code follows approval; architecture is not retroactively edited to match code.
