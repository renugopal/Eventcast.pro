# packages/contracts

Shared API and state contracts between the EventCast control plane and the Media Agent.

The source of truth is [`contracts.json`](contracts.json), a single language-neutral file. The semantics behind every field and value come from [`../../03_DATA_MODEL_AND_API_CONTRACTS.md`](../../03_DATA_MODEL_AND_API_CONTRACTS.md) and must stay aligned with:

- the committed SRS callback handler, [`../../services/media-agent/internal/srs/srs.go`](../../services/media-agent/internal/srs/srs.go)
- the committed SRS configuration, [`../../infra/media-node/srs/srs.conf`](../../infra/media-node/srs/srs.conf)
- the applied Supabase migration, `0019_livestream_control_plane.sql` (in the `eventcast-admin` repo's `supabase/migrations/`)

Two hand-written representations of `contracts.json` exist so far:

- [`go/contracts.go`](go/contracts.go) — Go structs/constants for the Media Agent.
- [`typescript/contracts.ts`](typescript/contracts.ts) — TypeScript types/consts for the EventCast control plane.

Each representation has a validation test that fails if it drifts from `contracts.json` (see "Validation" below). This is a hand-maintained package, not a code-generation target: `contracts.json` is edited first, then `go/contracts.go` and `typescript/contracts.ts` are updated by hand to match, and the validation tests confirm they still agree.

## Contract categories

### 1. SRS callback payloads

SRS posts the same JSON envelope shape to `on_publish`, `on_hls`, and `on_unpublish` — the fields relevant to each action are populated and the rest are zero-valued/absent. `contracts.json` → `srsCallbacks.envelopeFields` lists every field once, with its wire name (`jsonName`), type, and whether the Media Agent's handler treats it as required.

| Field (Go/JSON name) | Type | Required | Used by |
|---|---|---|---|
| `action` | string | **yes** | all three |
| `client_id` | string | no | all three |
| `ip` | string | no | all three |
| `vhost` | string | no | all three |
| `app` | string | no | all three |
| `stream` | string | **yes** | all three (carries the non-secret ingest identifier) |
| `param` | string | no | `on_publish`, `on_unpublish` (may carry a secret stream token — never logged) |
| `file` | string | no | `on_hls` (path of the completed segment under the SRS staging root) |
| `url` | string | no | `on_hls` |
| `m3u8` | string | no | `on_hls` |
| `duration` | number | no | `on_hls` |
| `seq_no` | integer | no | `on_hls` |

`action` and `stream` are required for every action because the committed handler (`srs.go`) rejects any callback where either is empty, regardless of which action it is. Per-action "relevant fields" (`contracts.json` → `srsCallbacks.actions.<name>.relevantFields`) document which of the optional fields that action actually populates; this is documentation only; the wire shape doesn't change per action.

The success response (`{"code": 0}`) and its shape are also part of the contract (`srsCallbacks.successResponse`).

### 2. Internal API error codes

Stable, machine-readable codes shared by internal APIs and Media Agent jobs (`errorCodes.values`): `AUTH_INVALID`, `ASSIGNMENT_MISMATCH`, `PUBLISH_WINDOW_CLOSED`, `DUPLICATE_PUBLISHER`, `SPOOL_FILE_MISSING`, `SPOOL_FILE_UNSTABLE`, `R2_AUTH`, `R2_RETRYABLE`, `R2_OBJECT_MISMATCH`, `MANIFEST_GAP`, `MANIFEST_PUBLISH_FAILED`, `YOUTUBE_RELAY_FAILED`, `WASABI_AUTH`, `WASABI_RETRYABLE`, `ARCHIVE_MISMATCH`, `DISK_PRESSURE`, `STATE_CONFLICT`. This set is exactly the `media_jobs.last_error_code` `CHECK` constraint in `0019_livestream_control_plane.sql`.

### 3. Media node states

`mediaNodeStates.values`: `provisioning`, `healthy`, `degraded`, `unavailable`, `retired` — matches `media_nodes.status`. Only `healthy` nodes outside `maintenance_mode` may receive new assignments.

### 4. Event media states

`eventMediaStates.values`: `scheduled`, `ready`, `live`, `interrupted`, `ending`, `finalizing`, `vod_ready`, `archiving`, `archived`, `cancelled` — matches `events.media_state` and `event_state_transitions.from_state`/`to_state`.

### 5. Stream session states

`streamSessionStates.values`: `starting`, `active`, `disconnected`, `finalized`, `failed` — matches `stream_sessions.status`. A reconnect always creates a new session row; it never reopens a prior one.

### 6. Media job states (and types)

`mediaJobStates.values`: `queued`, `running`, `paused`, `retry_wait`, `succeeded`, `failed_recoverable`, `cancelled` — matches `media_jobs.status`.

`mediaJobTypes.values`: `finalize_vod`, `create_mp4`, `archive_to_wasabi`, `restore_to_r2`, `delete_r2_hot_copy` — matches `media_jobs.type`. Included alongside job states because a job record is meaningless without both; both enums already exist in the applied migration, so listing the type enum here does not add a new contract concept.

## Versioning rules

`contracts.json.schemaVersion` follows semver against this file's *shape and values*:

- **MAJOR** — any rename, removal, or a required/optional flip of an existing field or enum value. Requires updating `go/contracts.go` and `typescript/contracts.ts` (and their validation tests) in the same change.
- **MINOR** — a backward-compatible addition: a new optional field, or a new enum value that has already been approved by an ADR and exists in an applied migration.
- **PATCH** — documentation-only edits (descriptions, comments) with no field or value change.

A new state or field must never be invented here. It must already exist in an approved architecture document (`03_DATA_MODEL_AND_API_CONTRACTS.md`, `05_DECISIONS.md`) or an applied Supabase migration before it is added to `contracts.json`. If the desired change isn't yet approved, it goes through the architecture change procedure (a new ADR) first, per [`../../09_CLAUDE_CODE_EXECUTION_RULES.md`](../../09_CLAUDE_CODE_EXECUTION_RULES.md) — code and contracts follow approval, they don't drive it.

## Validation

Both representations carry a test that reads `contracts.json` at run time and fails if it disagrees with the hand-written Go/TypeScript values (by field-name set and by enum-value set).

**Go** — `go/contracts_test.go`, run with:

```sh
cd packages/contracts/go
go test ./...
```

Requires a Go toolchain. Per this repository's workflow rules, Go validation for this package runs on the GCP VM via Docker, not on the local control workstation; the local workstation has no Go toolchain installed and none should be installed.

**TypeScript** — `typescript/validate.js`, run against the compiled output of `typescript/contracts.ts`:

```sh
tsc -p packages/contracts/typescript/tsconfig.json   # type-checks contracts.ts, emits typescript/dist/
node packages/contracts/typescript/validate.js       # compares typescript/dist/contracts.js against ../contracts.json
```

`typescript/dist/` is build output, not source; it is not committed (see `typescript/.gitignore`). This package adds no new npm dependency — validation borrows an already-installed `typescript` compiler and the Node.js runtime from whichever project toolchain is available; it does not install anything.

## Package layout

```text
packages/contracts/
  contracts.json           # language-neutral source of truth
  README.md                # this file
  go/
    go.mod                 # standalone module, no external dependencies
    contracts.go           # Go structs/constants
    contracts_test.go      # validates contracts.go against contracts.json
  typescript/
    tsconfig.json           # type-checks contracts.ts only
    contracts.ts            # TypeScript types/consts
    validate.js              # validates compiled contracts.ts against contracts.json
    .gitignore               # ignores the local dist/ build output
```
