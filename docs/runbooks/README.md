# Runbooks

Operational runbooks for Eventcast.pro. This is the index. Individual runbooks
are added as their procedures are validated; this slice adds only the index and
does not modify any existing files.

## Scope

Runbooks are **operational procedures** — how to respond to a situation — not
architecture. For architecture and decisions, see:

- [architecture-decisions.md](../architecture-decisions.md)
- [implementation-plan.md](../implementation-plan.md) ·
  [implementation-status.md](../implementation-status.md)
- [event-contract.md](../event-contract.md) ·
  [template-package-spec.md](../template-package-spec.md)
- [media-processing.md](../media-processing.md) ·
  [streaming-lifecycle.md](../streaming-lifecycle.md)
- [payments-ledger.md](../payments-ledger.md) · [test-plan.md](../test-plan.md)

## Planned runbooks (to be authored — not yet written)

Each entry below is a placeholder for a future runbook file in this directory.
No procedure here should invent thresholds, credentials, or capacity numbers;
those come from the owners/infra.

- **Live event on SRS + Media Agent** — provisioning an event, going live,
  ending, and confirming VOD finalization to B2. (`TBD`)
- **Media finalization / storage** — verifying a recording finalized from R2 to
  B2; handling a stuck or missing finalization. (`TBD`)
- **Legacy storage reconciliation** — safely assessing Wasabi and migration
  `0019` references before any migrate-or-remove decision. (`TBD`)
- **Payments incident** — a payment that succeeded at Razorpay but has no
  verified ledger entry, and reconciliation steps. (`TBD`)
- **Template release** — publishing a new immutable template version and
  rolling back by re-pinning a prior version. (`TBD`)
- **Auth / OTP** — diagnosing Supabase email + mobile OTP delivery/verification
  issues. (`TBD`)

## Conventions for future runbooks

- State the trigger/symptom, preconditions, steps, and verification.
- Never embed secrets; reference where credentials live, not their values.
- Prefer reversible steps; call out irreversible actions explicitly.
- Do not invent limits, capacities, or SLAs — mark unknowns `TBD`.
