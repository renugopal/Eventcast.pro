# Media Processing

How uploaded and recorded media flows through storage. This documents the
**locked storage model** for V1 and flags legacy references that need
reconciliation. It changes no pipeline code.

## Storage roles (locked)

| Store | Role | Lifetime |
| --- | --- | --- |
| Cloudflare **R2** | **Hot / temporary** uploads and working artifacts | Short-lived; not authoritative. |
| Backblaze **B2** | **Authoritative** store for **finalized recordings** in **V1** | Durable / long-term source of truth. |
| **Wasabi** | **Legacy / superseded**, pending reconciliation | To be decided (keep-migrate-or-drop). |
| Migration **`0019`** references | **Legacy / superseded**, pending reconciliation | To be decided. |

Key rule: R2 holds media while it is being uploaded/processed; the **finalized**
recording's authoritative copy for V1 lives in **B2**. Wasabi and `0019` are not
part of the V1 authoritative path and must be reconciled before they are relied
on or removed.

## Lifecycle (target)

1. **Ingest** — client/agent uploads land in **R2** (hot path).
2. **Process** — any transform/packaging operates on the R2 working copy.
3. **Finalize** — the finished recording is written to **B2** as the
   authoritative copy for V1.
4. **Cleanup** — temporary R2 objects are eligible for removal once the B2 copy
   is confirmed. Retention windows are `TBD` (not invented here).

## Reconciliation backlog (must be resolved, not invented)

- **Wasabi:** determine whether any authoritative data currently resides there;
  if so, define a migration to B2 or an explicit decision to retain. Until then,
  treat Wasabi paths as legacy read-only.
- **Migration `0019`:** identify what it introduced, whether any of it is still
  referenced, and whether it is superseded by the R2/B2 model. Mark superseded
  parts for removal in a separate, reviewed migration change (not part of this
  documentation slice).

## Relationship to streaming

Live capture and its transition to VOD are covered in
[streaming-lifecycle.md](streaming-lifecycle.md). The finalized VOD recording is
what lands in B2 per the model above.

## Open items

- R2 retention / cleanup window — **TBD**.
- Object key / path conventions across R2 and B2 — **TBD** (document existing
  conventions before standardizing; do not invent).
- Final disposition of Wasabi and `0019` — **TBD**.
- No size, bandwidth, or cost figures are asserted here.
