# packages/contracts

Shared API and state contracts between the EventCast control plane and the Media Agent: internal control-plane API request/response shapes, SRS callback payload shapes, error-code enum, and manifest/archive-manifest schemas. Source of truth for the semantics is `../../03_DATA_MODEL_AND_API_CONTRACTS.md`; this package is where those contracts get expressed as shared types/schemas once implementation starts (e.g. TypeScript types for the control plane, matching Go structs for the Media Agent).

Required error-code categories: `AUTH_INVALID`, `ASSIGNMENT_MISMATCH`, `PUBLISH_WINDOW_CLOSED`, `DUPLICATE_PUBLISHER`, `SPOOL_FILE_MISSING`, `SPOOL_FILE_UNSTABLE`, `R2_AUTH`, `R2_RETRYABLE`, `R2_OBJECT_MISMATCH`, `MANIFEST_GAP`, `MANIFEST_PUBLISH_FAILED`, `YOUTUBE_RELAY_FAILED`, `WASABI_AUTH`, `WASABI_RETRYABLE`, `ARCHIVE_MISMATCH`, `DISK_PRESSURE`, `STATE_CONFLICT`.

No contract definitions exist yet — placeholder created during the Phase 0 repository baseline.
