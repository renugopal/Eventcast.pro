@AGENTS.md

# EventCast Admin — Project Direction

Before any EventCast admin implementation task, read
`../docs/admin-baseline-v2.1/00_READ_ME_FIRST.md` and whichever baseline
files in that directory are relevant to the active task.

- The **Version 2.1 Master Baseline** (`01_...Product_Architecture_and_V1_Scope_Baseline_v2.1.md`)
  and **Decision Register** (`02_...Decision_Register_v2.1.md`) are the
  product/architecture authority, unless a later explicit user decision
  supersedes them.
- The **Current-State Gap Map** (`03_...`) and **Schema Preflight** (`04_...`)
  are dated evidence snapshots, not permanent truth — re-check only a
  specific mutable fact when a bounded task actually depends on it.
- Implementation proceeds **one coherent feature package at a time** — the
  full locally-completable capability (targeted reads, schema/migration
  design, backend/API, UI, Worker/renderer integration, directly-related
  fixes found along the way, focused tests, TypeScript checks) in one pass,
  not a separate task per file/route/migration/test. Keep the same session
  through all of that. Stop only at a hard boundary: an unresolved
  decision that can't be safely inferred, a remote migration
  apply/deploy/production mutation, secret access, a destructive action, or
  a genuinely different workstream. Do not perform repeated broad audits.
- The existing `eventcast-admin` Next.js App Router application is
  retained. Admin V2 is a **route-based selective rebuild inside that
  application**, not a second application.
- The legacy admin UI remains **frozen** as a reference during the V2
  build, unless a separately approved critical fix requires touching it.
- Reuse proven authentication, tenant ownership, RLS, public Worker, R2
  delivery, SRS + Media Agent, and other safe backend foundations.
- **Restreamer is retired** from the target architecture and must not be
  reintroduced.
- Do not treat old code behavior, old audits, old handoffs, or AI memory as
  higher authority than the V2.1 baseline.
- No commit, push, deploy, migration application, reset, stash, checkout,
  destructive action, secret access/rotation, production change, or remote
  infrastructure modification without explicit approval.

Phase-specific implementation details do not belong here — they live in the
current Active Task/prompt.
